/**
 * GET /api/admin/audit — Fetch audit log entries.
 *
 * ORAN-admin only. Reads from the audit_log table.
 * Supports action filter and pagination.
 * No PII is returned — user IDs are pseudonymised hashes.
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
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const AUDIT_ACTIONS = [
  'create', 'update', 'delete',
  'approve', 'deny', 'escalate',
  'login', 'logout',
  'flag_change',
] as const;

const ListParamsSchema = z.object({
  action:    z.enum(AUDIT_ACTIONS).optional(),
  tableName: z.string().max(100).optional(),
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// HANDLER
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`admin:audit:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
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
  if (!requireMinRole(authCtx, 'oran_admin')) {
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

  const { action, tableName, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (action) {
      params.push(action);
      conditions.push(`al.action = $${params.length}`);
    }
    if (tableName) {
      params.push(tableName);
      conditions.push(`al.table_name = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_log al ${where}`,
      params,
    );
    const total = countRows[0]?.count ?? 0;

    params.push(limit, offset);
    const rows = await executeQuery<{
      id: string;
      action: string;
      table_name: string;
      record_id: string;
      user_id: string | null;
      old_data: string | null;
      new_data: string | null;
      ip_address: string | null;
      created_at: string;
    }>(
      `SELECT al.id, al.action, al.table_name, al.record_id,
              al.user_id, al.old_data, al.new_data, al.ip_address,
              al.created_at
       FROM audit_log al
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_audit_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
