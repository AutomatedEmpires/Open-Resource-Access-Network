/**
 * GET  /api/community/queue — List verification queue entries.
 * POST /api/community/queue — Assign a queue entry to self (claim for review).
 *
 * Sorted by oldest pending first. Supports status filter and pagination.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  status: z
    .enum(['pending', 'in_review', 'verified', 'rejected', 'escalated'])
    .optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const AssignSchema = z.object({
  queueEntryId: z.string().uuid('queueEntryId must be a valid UUID'),
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

  const ip = getIp(req);
  const rl = checkRateLimit(`community:queue:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
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

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
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

  const { status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      conditions.push(`vq.status = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count FROM verification_queue vq ${where}`,
      params,
    );
    const total = countRows[0]?.count ?? 0;

    params.push(limit, offset);
    const rows = await executeQuery<{
      id: string;
      service_id: string;
      status: string;
      submitted_by_user_id: string;
      assigned_to_user_id: string | null;
      notes: string | null;
      created_at: string;
      updated_at: string;
      service_name: string;
      service_status: string;
      organization_id: string;
      organization_name: string;
    }>(
      `SELECT vq.id, vq.service_id, vq.status,
              vq.submitted_by_user_id, vq.assigned_to_user_id, vq.notes,
              vq.created_at, vq.updated_at,
              s.name AS service_name, s.status AS service_status,
              o.id AS organization_id, o.name AS organization_name
       FROM verification_queue vq
       JOIN services s ON s.id = vq.service_id
       JOIN organizations o ON o.id = s.organization_id
       ${where}
       ORDER BY vq.created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_community_queue_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`community:queue:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
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

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = AssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { queueEntryId } = parsed.data;

  try {
    // Only allow assigning 'pending' entries → 'in_review'
    const rows = await executeQuery<{ id: string }>(
      `UPDATE verification_queue
       SET status = 'in_review', assigned_to_user_id = $1, updated_at = now()
       WHERE id = $2 AND status = 'pending'
       RETURNING id`,
      [authCtx.userId, queueEntryId],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Queue entry not found or already assigned' },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true, id: rows[0].id }, { status: 200 });
  } catch (error) {
    await captureException(error, { feature: 'api_community_queue_assign' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
