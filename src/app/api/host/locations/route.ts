/**
 * GET  /api/host/locations — List locations (optionally filtered by organizationId).
 * POST /api/host/locations — Create a new location under an organization.
 *
 * Auth enforcement: GET filters to user's orgs; POST requires org access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext, isAuthConfigured, isOranAdmin, requireOrgAccess } from '@/services/auth';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
import type { Location } from '@/domain/types';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  organizationId: z.string().uuid().optional(),
  page:           z.coerce.number().int().min(1).default(1),
  limit:          z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const CreateLocationSchema = z.object({
  organizationId: z.string().uuid('organizationId must be a valid UUID'),
  name:           z.string().min(1, 'Name is required').max(500),
  alternateName:  z.string().max(500).optional(),
  description:    z.string().max(5000).optional(),
  transportation: z.string().max(1000).optional(),
  latitude:       z.number().min(-90).max(90).optional(),
  longitude:      z.number().min(-180).max(180).optional(),
  // Address fields (created alongside the location)
  address1:       z.string().max(500).optional(),
  address2:       z.string().max(500).optional(),
  city:           z.string().max(200).optional(),
  stateProvince:  z.string().max(200).optional(),
  postalCode:     z.string().max(20).optional(),
  country:        z.string().max(100).default('US'),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  // Auth check
  const authCtx = await getAuthContext();
  if (!authCtx && isAuthConfigured()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:loc:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => { raw[k] = v; });
  const parsed = ListParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { organizationId, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    // Filter to user's organizations unless oran_admin
    if (authCtx && !isOranAdmin(authCtx)) {
      if (authCtx.orgIds.length === 0) {
        return NextResponse.json(
          { results: [], total: 0, page, hasMore: false },
          { headers: { 'Cache-Control': 'private, no-store' } },
        );
      }
      params.push(authCtx.orgIds);
      conditions.push(`l.organization_id = ANY($${params.length})`);
    }

    if (organizationId) {
      if (authCtx && !requireOrgAccess(authCtx, organizationId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      params.push(organizationId);
      conditions.push(`l.organization_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count FROM locations l ${where}`,
      params,
    );
    const total = countRows[0]?.count ?? 0;

    params.push(limit, offset);
    const rows = await executeQuery<Location & {
      address_1?: string | null;
      city?: string | null;
      state_province?: string | null;
      postal_code?: string | null;
      organization_name?: string | null;
    }>(
      `SELECT l.id, l.organization_id, l.name, l.alternate_name, l.description,
              l.transportation, l.latitude, l.longitude,
              l.created_at, l.updated_at,
              a.address_1, a.city, a.state_province, a.postal_code,
              o.name AS organization_name
       FROM locations l
       LEFT JOIN addresses a ON a.location_id = l.id
       JOIN organizations o ON o.id = l.organization_id
       ${where}
       ORDER BY l.name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_host_locations_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  // Auth check
  const authCtx = await getAuthContext();
  if (!authCtx && isAuthConfigured()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:loc:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateLocationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const d = parsed.data;

  // Authorization: user must have write access to the target organization
  if (authCtx && !requireOrgAccess(authCtx, d.organizationId)) {
    return NextResponse.json({ error: 'Access denied to this organization' }, { status: 403 });
  }

  try {
    // Verify org exists and isn't defunct
    const orgCheck = await executeQuery<{ id: string; status?: string }>(
      'SELECT id, status FROM organizations WHERE id = $1',
      [d.organizationId],
    );
    if (orgCheck.length === 0) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    if (orgCheck[0].status === 'defunct') {
      return NextResponse.json({ error: 'Cannot add locations to a defunct organization' }, { status: 400 });
    }

    // Insert location + optional address in a transaction
    const location = await withTransaction(async (client) => {
      const locResult = await client.query<Location>(
        `INSERT INTO locations
           (organization_id, name, alternate_name, description, transportation, latitude, longitude, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          d.organizationId,
          d.name,
          d.alternateName ?? null,
          d.description ?? null,
          d.transportation ?? null,
          d.latitude ?? null,
          d.longitude ?? null,
          authCtx?.userId ?? null,
        ],
      );

      const loc = locResult.rows[0];

      // If any address field provided, insert address row
      const hasAddress = d.address1 || d.city || d.stateProvince || d.postalCode;
      if (hasAddress) {
        await client.query(
          `INSERT INTO addresses
             (location_id, address_1, address_2, city, state_province, postal_code, country)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            loc.id,
            d.address1 ?? null,
            d.address2 ?? null,
            d.city ?? null,
            d.stateProvince ?? null,
            d.postalCode ?? null,
            d.country,
          ],
        );
      }

      return loc;
    });

    return NextResponse.json(location, { status: 201 });
  } catch (error) {
    await captureException(error, { feature: 'api_host_locations_create' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
