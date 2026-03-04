/**
 * GET    /api/host/services/[id] — Fetch a single service with org + locations.
 * PUT    /api/host/services/[id] — Update service fields.
 * DELETE /api/host/services/[id] — Soft-delete a service (status = 'defunct').
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext, shouldEnforceAuth, requireOrgAccess, isOranAdmin } from '@/services/auth';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import type { Service } from '@/domain/types';

// ============================================================
// SCHEMAS
// ============================================================

const UpdateServiceSchema = z.object({
  name:                  z.string().min(1).max(500).optional(),
  description:           z.string().max(5000).optional(),
  url:                   z.string().url().max(2000).optional(),
  email:                 z.string().email().max(500).optional(),
  status:                z.enum(['active', 'inactive', 'defunct']).optional(),
  interpretationServices: z.string().max(1000).optional(),
  applicationProcess:    z.string().max(2000).optional(),
  waitTime:              z.string().max(500).optional(),
  fees:                  z.string().max(1000).optional(),
  accreditations:        z.string().max(1000).optional(),
  licenses:              z.string().max(1000).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'At least one field required' });

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

type RouteContext = { params: Promise<{ id: string }> };

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
    const svcCheck = await executeQuery<{ organization_id: string }>(
      'SELECT organization_id FROM services WHERE id = $1',
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
    status: 'status',
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

  params.push(id);

  try {
    const rows = await executeQuery<Service>(
      `UPDATE services SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params,
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch (error) {
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
    const svcCheck = await executeQuery<{ organization_id: string }>(
      'SELECT organization_id FROM services WHERE id = $1 AND status != \'defunct\'',
      [id],
    );
    if (svcCheck.length === 0) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }
    if (authCtx && !requireOrgAccess(authCtx, svcCheck[0].organization_id)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // Soft-delete: mark as defunct instead of hard delete
    const rows = await executeQuery<{ id: string }>(
      `UPDATE services
       SET status = 'defunct', updated_at = now(), updated_by_user_id = $2
       WHERE id = $1 AND status != 'defunct'
       RETURNING id`,
      [id, authCtx?.userId ?? null],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Service not found' }, { status: 404 });
    }

    return NextResponse.json({ archived: true, id: rows[0].id });
  } catch (error) {
    await captureException(error, { feature: 'api_host_svc_delete' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
