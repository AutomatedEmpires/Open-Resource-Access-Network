/**
 * GET    /api/host/locations/[id] — Fetch a single location with address.
 * PUT    /api/host/locations/[id] — Update location + address fields.
 * DELETE /api/host/locations/[id] — Soft-delete a location.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext, shouldEnforceAuth, requireOrgAccess } from '@/services/auth';
import { createHostPortalSourceAssertion } from '@/services/ingestion/hostPortalIntake';
import {
  acquireFreshnessSensitiveAuthoritativeMutationGates,
  assertAuthoritativeEntitiesMutable,
  ProtectedAuthoritativeMutationConflict,
} from '@/services/publication/protectedAuthoritativeMutation';
import type { PoolClient } from 'pg';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import type { Location } from '@/domain/types';
import { getIp } from '@/services/security/ip';

// ============================================================
// SCHEMAS
// ============================================================

const PhoneInputSchema = z.object({
  number:      z.string().min(7, 'Phone number too short').max(30),
  extension:   z.string().max(10).optional(),
  type:        z.enum(['voice', 'fax', 'text', 'hotline', 'tty']).default('voice'),
  description: z.string().max(200).optional(),
}).strict();

const DayScheduleInputSchema = z.object({
  day:    z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  opens:  z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  closes: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  closed: z.boolean().default(false),
}).strict();

const UpdateLocationSchema = z.object({
  name:           z.string().min(1).max(500).optional(),
  alternateName:  z.string().max(500).optional(),
  description:    z.string().max(5000).optional(),
  transportation: z.string().max(1000).optional(),
  latitude:       z.number().min(-90).max(90).optional(),
  longitude:      z.number().min(-180).max(180).optional(),
  address1:       z.string().max(500).optional(),
  address2:       z.string().max(500).optional(),
  city:           z.string().max(200).optional(),
  stateProvince:  z.string().max(200).optional(),
  postalCode:     z.string().max(20).optional(),
  country:        z.string().max(100).optional(),
  phones:         z.array(PhoneInputSchema).max(10).optional(),
  schedule:       z.array(DayScheduleInputSchema).min(7).max(7).optional(),
}).strict().refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

// ============================================================
// HELPERS
// ============================================================
type RouteContext = { params: Promise<{ id: string }> };

async function lockLocationMutationTargets(client: PoolClient, locationId: string) {
  const preliminaryRows = await client.query<{
    organization_id: string;
    service_ids: string[] | null;
  }>(
    `SELECT location.organization_id,
            array_agg(sal.service_id ORDER BY sal.service_id)
              FILTER (WHERE sal.service_id IS NOT NULL) AS service_ids
     FROM locations location
     LEFT JOIN service_at_location sal ON sal.location_id = location.id
     WHERE location.id = $1
     GROUP BY location.organization_id`,
    [locationId],
  );
  const preliminary = preliminaryRows.rows[0];
  if (!preliminary) return null;
  const serviceIds = preliminary.service_ids ?? [];

  await assertAuthoritativeEntitiesMutable(client, {
    organizationIds: [preliminary.organization_id],
    serviceIds,
  });

  const organizationRows = await client.query<{ id: string }>(
    `SELECT id
     FROM organizations
     WHERE id = $1
       AND status IS DISTINCT FROM 'defunct'
     FOR UPDATE`,
    [preliminary.organization_id],
  );
  if (!organizationRows.rows[0]) {
    throw Object.assign(new Error('state_changed'), { code: 'state_changed' });
  }

  if (serviceIds.length > 0) {
    const serviceRows = await client.query<{ id: string }>(
      `SELECT id
       FROM services
       WHERE id = ANY($1::uuid[])
         AND status IS DISTINCT FROM 'defunct'
       ORDER BY id
       FOR UPDATE`,
      [serviceIds],
    );
    if (serviceRows.rows.length !== serviceIds.length) {
      throw Object.assign(new Error('state_changed'), { code: 'state_changed' });
    }
  }

  const locationRows = await client.query<{ id: string; organization_id: string }>(
    `SELECT id, organization_id
     FROM locations
     WHERE id = $1
     FOR UPDATE`,
    [locationId],
  );
  const location = locationRows.rows[0];
  if (!location || location.organization_id !== preliminary.organization_id) {
    throw Object.assign(new Error('state_changed'), { code: 'state_changed' });
  }

  return { ...location, serviceIds };
}

// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid location ID' }, { status: 400 });
  }

  // Auth check
  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`host:locations:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  try {
    const rows = await executeQuery<Location & {
      address_id?: string | null;
      address_1?: string | null;
      address_2?: string | null;
      city?: string | null;
      region?: string | null;
      state_province?: string | null;
      postal_code?: string | null;
      country?: string | null;
      organization_name?: string | null;
      organization_id: string;
    }>(
      `SELECT l.*,
              a.id AS address_id, a.address_1, a.address_2, a.city, a.region,
              a.state_province, a.postal_code, a.country,
              o.name AS organization_name
       FROM locations l
       LEFT JOIN addresses a ON a.location_id = l.id
       JOIN organizations o ON o.id = l.organization_id
       WHERE l.id = $1`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    // Authorization: user must have access to the location's org
    if (authCtx && !requireOrgAccess(authCtx, rows[0].organization_id)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json(rows[0], {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_host_loc_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid location ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`host:locations:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  // Auth check
  const auth = await getAuthContext();
  if (shouldEnforceAuth() && !auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdateLocationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const d = parsed.data;

  try {
    // All updates in a transaction to ensure consistency
    const result = await withTransaction(async (client) => {
      await acquireFreshnessSensitiveAuthoritativeMutationGates(client);
      const lockedTarget = await lockLocationMutationTargets(client, id);
      if (!lockedTarget) {
        return null; // signal 404
      }

      // Verify user has access to this location's org
      const orgId = lockedTarget.organization_id;
      if (auth && !requireOrgAccess(auth, orgId)) {
        return { forbidden: true };
      }

      // Update location fields (if any provided)
      const locFieldMap: Record<string, string> = {
        name: 'name',
        alternateName: 'alternate_name',
        description: 'description',
        transportation: 'transportation',
        latitude: 'latitude',
        longitude: 'longitude',
      };

      const locClauses: string[] = [];
      const locParams: unknown[] = [];

      for (const [tsKey, dbCol] of Object.entries(locFieldMap)) {
        if (tsKey in d) {
          let val = (d as Record<string, unknown>)[tsKey] ?? null;
          // Round coordinates to 3 decimal places (~111m) for privacy
          if ((tsKey === 'latitude' || tsKey === 'longitude') && typeof val === 'number') {
            val = Math.round(val * 1000) / 1000;
          }
          locParams.push(val);
          locClauses.push(`${dbCol} = $${locParams.length}`);
        }
      }

      if (locClauses.length > 0) {
        locParams.push(id);
        await client.query(
          `UPDATE locations SET ${locClauses.join(', ')} WHERE id = $${locParams.length}`,
          locParams,
        );
      }

      // Update address fields (if any provided)
      const addrFieldMap: Record<string, string> = {
        address1: 'address_1',
        address2: 'address_2',
        city: 'city',
        stateProvince: 'state_province',
        postalCode: 'postal_code',
        country: 'country',
      };

      const addrClauses: string[] = [];
      const addrParams: unknown[] = [];
      let hasAddrUpdate = false;

      for (const [tsKey, dbCol] of Object.entries(addrFieldMap)) {
        if (tsKey in d) {
          hasAddrUpdate = true;
          addrParams.push((d as Record<string, unknown>)[tsKey] ?? null);
          addrClauses.push(`${dbCol} = $${addrParams.length}`);
        }
      }

      if (hasAddrUpdate) {
        addrParams.push(id);
        const updated = await client.query<{ id: string }>(
          `UPDATE addresses SET ${addrClauses.join(', ')} WHERE location_id = $${addrParams.length} RETURNING id`,
          addrParams,
        );
        if (updated.rows.length === 0) {
          // No existing address — insert only the provided fields
          await client.query(
            `INSERT INTO addresses (location_id, address_1, address_2, city, state_province, postal_code, country)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              id,
              d.address1 ?? null,
              d.address2 ?? null,
              d.city ?? null,
              d.stateProvince ?? null,
              d.postalCode ?? null,
              d.country ?? 'US',
            ],
          );
        }
      }

      // Return updated location with address
      // Replace phones if provided
      if (d.phones !== undefined) {
        await client.query('DELETE FROM phones WHERE location_id = $1', [id]);
        for (const ph of d.phones) {
          await client.query(
            `INSERT INTO phones (location_id, number, extension, type, description)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, ph.number, ph.extension ?? null, ph.type === 'text' ? 'sms' : ph.type, ph.description ?? null],
          );
        }
      }

      // Replace schedule if provided
      if (d.schedule !== undefined) {
        await client.query('DELETE FROM schedules WHERE location_id = $1', [id]);
        for (const ds of d.schedule) {
          if (ds.closed) continue;
          await client.query(
            `INSERT INTO schedules (location_id, days, opens_at, closes_at)
             VALUES ($1, $2, $3, $4)`,
            [id, [ds.day], ds.opens, ds.closes],
          );
        }
      }

      const finalResult = await client.query<Location>(
        `SELECT l.*, a.address_1, a.address_2, a.city, a.state_province, a.postal_code, a.country,
                o.name AS organization_name
         FROM locations l
         LEFT JOIN addresses a ON a.location_id = l.id
         JOIN organizations o ON o.id = l.organization_id
         WHERE l.id = $1`,
        [id],
      );

      await createHostPortalSourceAssertion(client, {
        actorUserId: auth?.userId ?? 'system',
        actorRole: auth?.role ?? null,
        recordType: 'host_location_update',
        recordId: id,
        canonicalSourceUrl: `oran://host-portal/locations/${id}`,
        payload: {
          organizationId: orgId,
          locationId: id,
          requestedChanges: d,
        },
      });

      return finalResult.rows[0];
    });

    if (result === null) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }

    if ('forbidden' in result) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProtectedAuthoritativeMutationConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (
      error instanceof Error
      && (error as NodeJS.ErrnoException & { code?: string }).code === 'state_changed'
    ) {
      return NextResponse.json({ error: 'Location changed. Refresh and try again.' }, { status: 409 });
    }
    await captureException(error, { feature: 'api_host_loc_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid location ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`host:locations:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  // Auth check
  const auth = await getAuthContext();
  if (shouldEnforceAuth() && !auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const deletionResult = await withTransaction(async (client) => {
      await acquireFreshnessSensitiveAuthoritativeMutationGates(client);
      const lockedLocation = await lockLocationMutationTargets(client, id);
      if (!lockedLocation) return null;
      if (auth && !requireOrgAccess(auth, lockedLocation.organization_id)) {
        return { forbidden: true } as const;
      }

      try {
        const softDeleteResult = await client.query<{ id: string }>(
          `UPDATE locations SET status = 'defunct' WHERE id = $1 RETURNING id`,
          [id],
        );

        if (softDeleteResult.rows.length === 0) {
          return null;
        }

        await createHostPortalSourceAssertion(client, {
          actorUserId: auth?.userId ?? 'system',
          actorRole: auth?.role ?? null,
          recordType: 'host_location_archive',
          recordId: id,
          canonicalSourceUrl: `oran://host-portal/locations/${id}`,
          payload: {
            organizationId: lockedLocation.organization_id,
            locationId: id,
            status: 'defunct',
            archiveMode: 'soft_delete',
          },
        });

        return { id: softDeleteResult.rows[0].id };
      } catch (e: unknown) {
        if (!(e instanceof Error) || !e.message.includes('column "status" of relation "locations"')) {
          throw e;
        }

        const hardDeleteResult = await client.query<{ id: string }>(
          'DELETE FROM locations WHERE id = $1 RETURNING id',
          [id],
        );

        if (hardDeleteResult.rows.length === 0) {
          return null;
        }

        await createHostPortalSourceAssertion(client, {
          actorUserId: auth?.userId ?? 'system',
          actorRole: auth?.role ?? null,
          recordType: 'host_location_archive',
          recordId: id,
          canonicalSourceUrl: `oran://host-portal/locations/${id}`,
          payload: {
            organizationId: lockedLocation.organization_id,
            locationId: id,
            status: 'defunct',
            archiveMode: 'hard_delete',
          },
        });

        return { id: hardDeleteResult.rows[0].id };
      }
    });

    if (!deletionResult) {
      return NextResponse.json({ error: 'Location not found' }, { status: 404 });
    }
    if ('forbidden' in deletionResult) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json({ deleted: true, id: deletionResult.id });
  } catch (error) {
    if (error instanceof ProtectedAuthoritativeMutationConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (
      error instanceof Error
      && (error as NodeJS.ErrnoException & { code?: string }).code === 'state_changed'
    ) {
      return NextResponse.json({ error: 'Location changed. Refresh and try again.' }, { status: 409 });
    }
    await captureException(error, { feature: 'api_host_loc_delete' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
