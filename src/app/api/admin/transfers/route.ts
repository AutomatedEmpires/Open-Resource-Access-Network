/**
 * GET  /api/admin/transfers — List ownership transfer requests.
 * POST /api/admin/transfers — Approve, reject, or execute a transfer.
 *
 * Community-admin / ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
import {
  approveTransfer,
  rejectTransfer,
  executeTransfer,
} from '@/services/ownershipTransfer/service';
import { executeQuery } from '@/services/db/postgres';
import { getIp } from '@/services/security/ip';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  status: z
    .enum(['pending', 'verified', 'approved', 'completed', 'rejected', 'cancelled'])
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const DecisionSchema = z.object({
  transferId: z.string().uuid('transferId must be a valid UUID'),
  action: z.enum(['approve', 'reject', 'execute'], {
    message: 'action must be approve, reject, or execute',
  }),
  notes: z.string().max(5000).optional(),
  reason: z.string().max(2000).optional(),
}).strict();

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:transfers:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
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
      conditions.push(`ot.status = $${params.length + 1}`);
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await executeQuery<Record<string, unknown>>(
      `SELECT ot.*, s.name AS service_name, o.name AS organization_name
       FROM ownership_transfers ot
       LEFT JOIN services s ON s.id = ot.service_id
       LEFT JOIN organizations o ON o.id = ot.organization_id
       ${where}
       ORDER BY ot.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    const countRows = await executeQuery<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ownership_transfers ot ${where}`,
      params,
    );
    const total = parseInt(countRows[0]?.total ?? '0', 10);

    return NextResponse.json({
      transfers: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_transfers_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:transfers:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
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

  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { transferId, action, notes, reason } = parsed.data;

  try {
    let result: { success: boolean; error?: string };

    switch (action) {
      case 'approve':
        result = await approveTransfer(transferId, authCtx.userId, notes);
        break;
      case 'reject':
        result = await rejectTransfer(transferId, authCtx.userId, reason ?? 'No reason provided');
        break;
      case 'execute':
        result = await executeTransfer(transferId);
        break;
    }

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json({ success: true, action, transferId });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_transfers_action' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
