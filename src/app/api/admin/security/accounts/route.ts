import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import {
  DEFAULT_PAGE_SIZE,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';

const ListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['active', 'frozen', '']).default(''),
  role: z.enum(['seeker', 'host_member', 'host_admin', 'community_admin', 'oran_admin', '']).default(''),
  search: z.string().trim().max(200).optional(),
});

const DecisionSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  action: z.enum(['freeze', 'restore']),
  note: z.string().trim().min(5).max(1000),
});

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const rl = await checkRateLimitShared(`admin:security:read:${getIp(req)}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } });
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const parsed = ListParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const { page, limit, role, status, search } = parsed.data;
  const offset = (page - 1) * limit;
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (status) {
    params.push(status);
    conditions.push(`up.account_status = $${params.length}`);
  }
  if (role) {
    params.push(role);
    conditions.push(`up.role = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(`(
      LOWER(up.user_id) LIKE $${params.length}
      OR LOWER(COALESCE(up.display_name, '')) LIKE $${params.length}
      OR LOWER(COALESCE(up.email, '')) LIKE $${params.length}
      OR LOWER(COALESCE(up.username, '')) LIKE $${params.length}
    )`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const [rows, counts] = await Promise.all([
      executeQuery<{
        user_id: string;
        display_name: string | null;
        email: string | null;
        role: string;
        account_status: 'active' | 'frozen';
        security_note: string | null;
        suspended_at: string | null;
        restored_at: string | null;
        organization_count: number;
        updated_at: string;
      }>(
        `SELECT up.user_id,
                up.display_name,
                up.email,
                up.role,
                up.account_status,
                up.security_note,
                up.suspended_at,
                up.restored_at,
                COUNT(DISTINCT om.organization_id)::int AS organization_count,
                up.updated_at
         FROM user_profiles up
         LEFT JOIN organization_members om
           ON om.user_id = up.user_id
          AND om.status = 'active'
         ${where}
         GROUP BY up.user_id, up.display_name, up.email, up.role, up.account_status,
                  up.security_note, up.suspended_at, up.restored_at, up.updated_at
         ORDER BY CASE WHEN up.account_status = 'frozen' THEN 0 ELSE 1 END,
                  up.updated_at DESC,
                  up.user_id ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      executeQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM user_profiles up ${where}`,
        params,
      ),
    ]);

    return NextResponse.json(
      {
        results: rows,
        total: parseInt(counts[0]?.count ?? '0', 10),
        page,
        hasMore: offset + rows.length < parseInt(counts[0]?.count ?? '0', 10),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_security_accounts_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const rl = await checkRateLimitShared(`admin:security:write:${getIp(req)}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } });
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'oran_admin')) {
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
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { userId, action, note } = parsed.data;
  if (action === 'freeze' && userId === authCtx.userId) {
    return NextResponse.json({ error: 'You cannot freeze your own account.' }, { status: 400 });
  }

  try {
    const result = await withTransaction(async (client) => {
      const target = await client.query<{
        user_id: string;
        role: string;
        account_status: 'active' | 'frozen';
      }>(
        `SELECT user_id, role, account_status
         FROM user_profiles
         WHERE user_id = $1
         FOR UPDATE`,
        [userId],
      );

      const row = target.rows[0];
      if (!row) {
        return { error: 'Account not found', status: 404 } as const;
      }

      if (action === 'freeze' && row.role === 'oran_admin') {
        const remainingAdmins = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM user_profiles
           WHERE role = 'oran_admin'
             AND account_status = 'active'
             AND user_id <> $1`,
          [userId],
        );
        if (parseInt(remainingAdmins.rows[0]?.count ?? '0', 10) === 0) {
          return { error: 'At least one active ORAN admin must remain.', status: 409 } as const;
        }
      }

      const nextStatus = action === 'freeze' ? 'frozen' : 'active';
      await client.query(
        `UPDATE user_profiles
         SET account_status = $2,
             security_note = $3,
             suspended_at = CASE WHEN $2 = 'frozen' THEN NOW() ELSE suspended_at END,
             suspended_by_user_id = CASE WHEN $2 = 'frozen' THEN $4 ELSE suspended_by_user_id END,
             restored_at = CASE WHEN $2 = 'active' THEN NOW() ELSE restored_at END,
             restored_by_user_id = CASE WHEN $2 = 'active' THEN $4 ELSE restored_by_user_id END,
             updated_at = NOW(),
             updated_by_user_id = $4
         WHERE user_id = $1`,
        [userId, nextStatus, note, authCtx.userId],
      );

      await client.query(
        `INSERT INTO scope_audit_log
           (actor_user_id, actor_role, action, target_type, target_id, before_state, after_state, justification)
         VALUES ($1, $2, $3, 'user_profile', $4, $5, $6, $7)`,
        [
          authCtx.userId,
          authCtx.role,
          action === 'freeze' ? 'account_frozen' : 'account_restored',
          userId,
          JSON.stringify({ account_status: row.account_status }),
          JSON.stringify({ account_status: nextStatus }),
          note,
        ],
      );

      await client.query(
        `INSERT INTO notification_events
           (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
         VALUES ($1, 'account_security_changed', $2, $3, 'user', $1, '/profile', $4)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          userId,
          action === 'freeze' ? 'Your account has been frozen' : 'Your account has been restored',
          note,
          `${action}_${userId}_${Date.now()}`,
        ],
      );

      return { status: 200, nextStatus } as const;
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      success: true,
      userId,
      accountStatus: result.nextStatus,
      message: action === 'freeze' ? 'Account frozen successfully.' : 'Account restored successfully.',
    });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_security_accounts_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
