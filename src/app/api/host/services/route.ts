/**
 * GET  /api/host/services — List services (optionally filtered by organizationId).
 * POST /api/host/services — Create a new service under an organization.
 *
 * Auth enforcement: GET filters to user's orgs; POST requires org access.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, withTransaction, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext, shouldEnforceAuth, isOranAdmin, requireOrgAccess } from '@/services/auth';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
import type { Service } from '@/domain/types';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  organizationId: z.string().uuid().optional(),
  status:         z.enum(['active', 'inactive', 'defunct']).optional(),
  page:           z.coerce.number().int().min(1).default(1),
  limit:          z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  q:              z.string().max(200).optional(),
});

const CreateServiceSchema = z.object({
  organizationId:        z.string().uuid('organizationId must be a valid UUID'),
  name:                  z.string().min(1, 'Name is required').max(500),
  description:           z.string().max(5000).optional(),
  url:                   z.string().url().max(2000).optional(),
  email:                 z.string().email().max(500).optional(),
  // New services default to 'inactive' — they must complete the verification
  // cycle before appearing as active in search results.
  status:                z.enum(['active', 'inactive', 'defunct']).default('inactive'),
  interpretationServices: z.string().max(1000).optional(),
  applicationProcess:    z.string().max(2000).optional(),
  waitTime:              z.string().max(500).optional(),
  fees:                  z.string().max(1000).optional(),
  accreditations:        z.string().max(1000).optional(),
  licenses:              z.string().max(1000).optional(),
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

  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => { raw[k] = v; });
  const parsed = ListParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { organizationId, status, page, limit, q } = parsed.data;
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
      conditions.push(`s.organization_id = ANY($${params.length})`);
    }

    // If specific org requested, verify access
    if (organizationId) {
      if (authCtx && !requireOrgAccess(authCtx, organizationId)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
      }
      params.push(organizationId);
      conditions.push(`s.organization_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    } else {
      // Exclude defunct services by default
      conditions.push(`s.status != 'defunct'`);
    }
    if (q) {
      params.push(q);
      conditions.push(`(to_tsvector('english', s.name) @@ plainto_tsquery('english', $${params.length})
        OR to_tsvector('english', coalesce(s.description, '')) @@ plainto_tsquery('english', $${params.length}))`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count FROM services s ${where}`,
      params,
    );
    const total = countRows[0]?.count ?? 0;

    params.push(limit, offset);
    const rows = await executeQuery<Service & { organization_name?: string }>(
      `SELECT s.id, s.organization_id, s.name, s.alternate_name, s.description,
              s.url, s.email, s.status, s.interpretation_services,
              s.application_process, s.wait_time, s.fees,
              s.accreditations, s.licenses, s.created_at, s.updated_at,
              o.name AS organization_name
       FROM services s
       JOIN organizations o ON o.id = s.organization_id
       ${where}
       ORDER BY s.name ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_host_services_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  // Auth check — required unconditionally because submitted_by_user_id is NOT NULL
  const authCtx = await getAuthContext();
  if (!authCtx) {
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

  const parsed = CreateServiceSchema.safeParse(body);
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
      return NextResponse.json({ error: 'Cannot add services to a defunct organization' }, { status: 400 });
    }

    const result = await withTransaction(async (client) => {
      // 1. Create the service
      const svcRows = await client.query<Service>(
        `INSERT INTO services
           (organization_id, name, description, url, email, status,
            interpretation_services, application_process, wait_time, fees,
            accreditations, licenses, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          d.organizationId,
          d.name,
          d.description ?? null,
          d.url ?? null,
          d.email ?? null,
          d.status,
          d.interpretationServices ?? null,
          d.applicationProcess ?? null,
          d.waitTime ?? null,
          d.fees ?? null,
          d.accreditations ?? null,
          d.licenses ?? null,
          authCtx.userId,
        ],
      );
      const service = svcRows.rows[0];

      // 2. Auto-enqueue service for verification via submissions table.
      //    Every service must pass the community admin review cycle before
      //    it can be marked active in search results.
      const subRows = await client.query(
        `INSERT INTO submissions
           (submission_type, status, target_type, target_id, service_id,
            submitted_by_user_id, title, submitted_at)
         VALUES ('service_verification', 'submitted', 'service', $1, $1, $2, $3, NOW())
         RETURNING id`,
        [service.id, authCtx.userId, `Service verification: ${service.name}`],
      );
      const submissionId = subRows.rows[0]?.id;

      // Notify admin pool of new service verification
      if (submissionId) {
        await client.query(
          `INSERT INTO notification_events
             (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
           SELECT up.user_id,
                  'submission_status_changed',
                  'New service submitted for verification',
                  $2,
                  'submission',
                  $1,
                  '/community/queue',
                  'new_service_' || $1 || '_' || up.user_id
           FROM user_profiles up
           WHERE up.role IN ('community_admin', 'oran_admin')
           ON CONFLICT (idempotency_key) DO NOTHING`,
          [submissionId, `Service: ${service.name}`],
        );
      }

      return service;
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    await captureException(error, { feature: 'api_host_services_create' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
