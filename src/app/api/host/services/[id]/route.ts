/**
 * GET    /api/host/services/[id] — Fetch a single service with org + locations.
 * PUT    /api/host/services/[id] — Update service fields.
 * DELETE /api/host/services/[id] — Soft-delete a service (status = 'defunct').
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext, shouldEnforceAuth, requireOrgAccess, isOranAdmin } from '@/services/auth';
import { applySla } from '@/services/workflow/engine';
import {
  createHostPortalSourceAssertion,
  queueServiceVerificationSubmission,
  type HostPortalDayScheduleInput,
  type HostPortalPhoneInput,
  type HostServiceRequestedChanges,
} from '@/services/ingestion/hostPortalIntake';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import type { Service } from '@/domain/types';

// ============================================================
// SCHEMAS
// ============================================================

const PhoneInputSchema = z.object({
  number:      z.string().min(7, 'Phone number too short').max(30),
  extension:   z.string().max(10).optional(),
  type:        z.enum(['voice', 'fax', 'text', 'hotline', 'tty']).default('voice'),
  description: z.string().max(200).optional(),
});

const DayScheduleInputSchema = z.object({
  day:    z.enum(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']),
  opens:  z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  closes: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM'),
  closed: z.boolean().default(false),
});

const UpdateServiceSchema = z.object({
  name:                  z.string().min(1).max(500).optional(),
  description:           z.string().max(5000).optional(),
  url:                   z.string().url().max(2000).optional(),
  email:                 z.string().email().max(500).optional(),
  interpretationServices: z.string().max(1000).optional(),
  applicationProcess:    z.string().max(2000).optional(),
  waitTime:              z.string().max(500).optional(),
  fees:                  z.string().max(1000).optional(),
  accreditations:        z.string().max(1000).optional(),
  licenses:              z.string().max(1000).optional(),
  phones:                z.array(PhoneInputSchema).max(10).optional(),
  schedule:              z.array(DayScheduleInputSchema).min(7).max(7).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

type RouteContext = { params: Promise<{ id: string }> };

function buildRequestedChanges(
  input: {
    name?: string;
    description?: string;
    url?: string;
    email?: string;
    interpretationServices?: string;
    applicationProcess?: string;
    waitTime?: string;
    fees?: string;
    accreditations?: string;
    licenses?: string;
    phones?: HostPortalPhoneInput[];
    schedule?: HostPortalDayScheduleInput[];
  },
): HostServiceRequestedChanges {
  const requested: HostServiceRequestedChanges = {};

  if (input.name !== undefined) requested.name = input.name;
  if (input.description !== undefined) requested.description = input.description;
  if (input.url !== undefined) requested.url = input.url;
  if (input.email !== undefined) requested.email = input.email;
  if (input.interpretationServices !== undefined) requested.interpretationServices = input.interpretationServices;
  if (input.applicationProcess !== undefined) requested.applicationProcess = input.applicationProcess;
  if (input.waitTime !== undefined) requested.waitTime = input.waitTime;
  if (input.fees !== undefined) requested.fees = input.fees;
  if (input.accreditations !== undefined) requested.accreditations = input.accreditations;
  if (input.licenses !== undefined) requested.licenses = input.licenses;
  if (input.phones !== undefined) requested.phones = input.phones;
  if (input.schedule !== undefined) requested.schedule = input.schedule;

  return requested;
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
    return NextResponse.json({ error: 'Invalid service ID' }, { status: 400 });
  }

  // Auth check
  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:svc:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  try {
    // Exclude defunct unless oran_admin
    const statusFilter = authCtx && isOranAdmin(authCtx) ? '' : `AND s.status != 'defunct'`;
    const rows = await executeQuery<Service & { organization_name?: string; organization_id: string }>(
      `SELECT s.*, o.name AS organization_name
       FROM services s
       JOIN organizations o ON o.id = s.organization_id
       WHERE s.id = $1 ${statusFilter}`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    // Authorization: user must have access to the service's org
    if (authCtx && !requireOrgAccess(authCtx, rows[0].organization_id)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    return NextResponse.json(rows[0], {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_host_svc_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid service ID' }, { status: 400 });
  }

  // Auth check
  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:svc:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdateServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const d = parsed.data;

  // First verify service exists and check authorization
  try {
    const svcCheck = await executeQuery<{
      organization_id: string;
      status: Service['status'];
      name: string;
    }>(
      'SELECT organization_id, status, name FROM services WHERE id = $1',
      [id],
    );
    if (svcCheck.length === 0) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }
    if (authCtx && !requireOrgAccess(authCtx, svcCheck[0].organization_id)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  } catch (error) {
    await captureException(error, { feature: 'api_host_svc_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  const setClauses: string[] = [];
  const params: unknown[] = [];

  const fieldMap: Record<string, string> = {
    name: 'name',
    description: 'description',
    url: 'url',
    email: 'email',
    interpretationServices: 'interpretation_services',
    applicationProcess: 'application_process',
    waitTime: 'wait_time',
    fees: 'fees',
    accreditations: 'accreditations',
    licenses: 'licenses',
  };

  for (const [tsKey, dbCol] of Object.entries(fieldMap)) {
    if (tsKey in d) {
      params.push((d as Record<string, unknown>)[tsKey] ?? null);
      setClauses.push(`${dbCol} = $${params.length}`);
    }
  }

  // Add updated_by_user_id if authenticated
  if (authCtx) {
    params.push(authCtx.userId);
    setClauses.push(`updated_by_user_id = $${params.length}`);
  }

  const hasScalarChanges = setClauses.length > 0;
  const hasPhones = d.phones !== undefined;
  const hasSchedule = d.schedule !== undefined;
  const requestedChanges = buildRequestedChanges({
    name: d.name,
    description: d.description,
    url: d.url,
    email: d.email,
    interpretationServices: d.interpretationServices,
    applicationProcess: d.applicationProcess,
    waitTime: d.waitTime,
    fees: d.fees,
    accreditations: d.accreditations,
    licenses: d.licenses,
    phones: d.phones,
    schedule: d.schedule,
  });

  try {
    const svcRows = await executeQuery<{
      organization_id: string;
      status: Service['status'];
      name: string;
    }>(
      'SELECT organization_id, status, name FROM services WHERE id = $1',
      [id],
    );

    if (svcRows.length === 0) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    const currentService = svcRows[0];

    if (currentService.status === 'active') {
      const queued = await withTransaction(async (client) => {
        const assertion = await createHostPortalSourceAssertion(client, {
          actorUserId: authCtx?.userId ?? 'system',
          actorRole: authCtx?.role ?? null,
          recordType: 'host_service_update',
          recordId: id,
          canonicalSourceUrl: `oran://host-portal/services/${id}`,
          payload: {
            serviceId: id,
            organizationId: currentService.organization_id,
            currentStatus: currentService.status,
            requestedChanges,
          },
        });

        const submissionId = await queueServiceVerificationSubmission(client, {
          serviceId: id,
          submittedByUserId: authCtx?.userId ?? 'system',
          actorRole: authCtx?.role ?? 'host_admin',
          title: `Service change review: ${currentService.name}`,
          notes: 'Published service change submitted via host portal.',
          payload: {
            flow: 'host_portal',
            changeType: 'host_service_update',
            sourceRecordId: assertion.sourceRecordId,
            organizationId: currentService.organization_id,
            serviceId: id,
            currentStatus: currentService.status,
            requestedChanges,
          },
        });

        return {
          submissionId,
          sourceRecordId: assertion.sourceRecordId,
        };
      });

      try {
        await applySla(queued.submissionId, 'service_verification');
      } catch {
        // SLA is best-effort.
      }

      return NextResponse.json(
        {
          queuedForReview: true,
          serviceId: id,
          submissionId: queued.submissionId,
          sourceRecordId: queued.sourceRecordId,
          message: 'Changes submitted for review. The live listing will stay unchanged until approval.',
        },
        { status: 202 },
      );
    }

    const saved = await withTransaction<Service & { sourceRecordId: string }>(async (client) => {
      let service: Service;

      if (hasScalarChanges) {
        params.push(id);
        const rows = await client.query<Service>(
          `UPDATE services SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params,
        );
        if (rows.rows.length === 0) throw Object.assign(new Error('not_found'), { code: 'not_found' });
        service = rows.rows[0];
      } else {
        // Only phones/schedule changing — fetch current row for the response
        const rows = await client.query<Service>('SELECT * FROM services WHERE id = $1', [id]);
        if (rows.rows.length === 0) throw Object.assign(new Error('not_found'), { code: 'not_found' });
        service = rows.rows[0];
      }

      if (hasPhones) {
        await client.query('DELETE FROM phones WHERE service_id = $1', [id]);
        for (const ph of d.phones!) {
          await client.query(
            `INSERT INTO phones (service_id, number, extension, type, description)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, ph.number, ph.extension ?? null, ph.type === 'text' ? 'sms' : ph.type, ph.description ?? null],
          );
        }
      }

      if (hasSchedule) {
        await client.query('DELETE FROM schedules WHERE service_id = $1', [id]);
        for (const ds of d.schedule!) {
          if (ds.closed) continue;
          await client.query(
            `INSERT INTO schedules (service_id, days, opens_at, closes_at)
             VALUES ($1, $2, $3, $4)`,
            [id, [ds.day], ds.opens, ds.closes],
          );
        }
      }

      const assertion = await createHostPortalSourceAssertion(client, {
        actorUserId: authCtx?.userId ?? 'system',
        actorRole: authCtx?.role ?? null,
        recordType: 'host_service_update',
        recordId: id,
        canonicalSourceUrl: `oran://host-portal/services/${id}`,
        payload: {
          serviceId: id,
          organizationId: currentService.organization_id,
          currentStatus: service.status,
          requestedChanges,
        },
      });

      return { ...service, sourceRecordId: assertion.sourceRecordId };
    });

    return NextResponse.json(saved);
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException & { code?: string }).code === 'not_found') {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }
    await captureException(error, { feature: 'api_host_svc_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid service ID' }, { status: 400 });
  }

  // Auth check
  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:svc:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  try {
    // Check authorization
    const svcCheck = await executeQuery<{
      organization_id: string;
      status: Service['status'];
      name: string;
    }>(
      'SELECT organization_id, status, name FROM services WHERE id = $1 AND status != \'defunct\'',
      [id],
    );
    if (svcCheck.length === 0) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }
    if (authCtx && !requireOrgAccess(authCtx, svcCheck[0].organization_id)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (svcCheck[0].status === 'active') {
      const queued = await withTransaction(async (client) => {
        const assertion = await createHostPortalSourceAssertion(client, {
          actorUserId: authCtx?.userId ?? 'system',
          actorRole: authCtx?.role ?? null,
          recordType: 'host_service_archive',
          recordId: id,
          canonicalSourceUrl: `oran://host-portal/services/${id}`,
          payload: {
            serviceId: id,
            organizationId: svcCheck[0].organization_id,
            currentStatus: svcCheck[0].status,
          },
        });

        const submissionId = await queueServiceVerificationSubmission(client, {
          serviceId: id,
          submittedByUserId: authCtx?.userId ?? 'system',
          actorRole: authCtx?.role ?? 'host_admin',
          title: `Service archive review: ${svcCheck[0].name}`,
          notes: 'Published service archive submitted via host portal.',
          payload: {
            flow: 'host_portal',
            changeType: 'host_service_archive',
            sourceRecordId: assertion.sourceRecordId,
            organizationId: svcCheck[0].organization_id,
            serviceId: id,
            currentStatus: svcCheck[0].status,
          },
        });

        return {
          submissionId,
          sourceRecordId: assertion.sourceRecordId,
        };
      });

      try {
        await applySla(queued.submissionId, 'service_verification');
      } catch {
        // SLA is best-effort.
      }

      return NextResponse.json(
        {
          queuedForReview: true,
          archived: false,
          id,
          submissionId: queued.submissionId,
          sourceRecordId: queued.sourceRecordId,
          message: 'Archive request submitted for review. The live listing remains visible until approval.',
        },
        { status: 202 },
      );
    }

    const archived = await withTransaction<{ id: string; sourceRecordId: string }>(async (client) => {
      const rows = await client.query<{ id: string }>(
        `UPDATE services
         SET status = 'defunct', updated_at = now(), updated_by_user_id = $2
         WHERE id = $1 AND status != 'defunct'
         RETURNING id`,
        [id, authCtx?.userId ?? null],
      );

      if (rows.rows.length === 0) {
        throw Object.assign(new Error('not_found'), { code: 'not_found' });
      }

      const assertion = await createHostPortalSourceAssertion(client, {
        actorUserId: authCtx?.userId ?? 'system',
        actorRole: authCtx?.role ?? null,
        recordType: 'host_service_archive',
        recordId: id,
        canonicalSourceUrl: `oran://host-portal/services/${id}`,
        payload: {
          serviceId: id,
          organizationId: svcCheck[0].organization_id,
          currentStatus: 'defunct',
        },
      });

      return {
        id: rows.rows[0].id,
        sourceRecordId: assertion.sourceRecordId,
      };
    });

    return NextResponse.json({ archived: true, id: archived.id, sourceRecordId: archived.sourceRecordId });
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException & { code?: string }).code === 'not_found') {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }
    await captureException(error, { feature: 'api_host_svc_delete' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
