/**
 * GET  /api/admin/scopes — List all platform scopes.
 * POST /api/admin/scopes — Create a new platform scope.
 *
 * ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const CreateScopeSchema = z.object({
  name:             z.string().min(1).max(255).regex(/^[a-z][a-z0-9_.]*$/, 'Scope name must be lowercase alphanumeric with dots/underscores'),
  description:      z.string().min(1).max(2000),
  risk_level:       z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  requires_approval: z.boolean().default(true),
}).strict();

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// GET — List all platform scopes
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:scopes:read:${ip}`, {
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

  try {
    const { page, limit } = parsed.data;
    const offset = (page - 1) * limit;

    const [rows, countResult] = await Promise.all([
      executeQuery<{
        id: string;
        name: string;
        description: string;
        risk_level: string;
        requires_approval: boolean;
        is_active: boolean;
        created_at: string;
      }>(
        `SELECT id, name, description, risk_level, requires_approval, is_active, created_at
         FROM platform_scopes
         ORDER BY name ASC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      executeQuery<{ count: string }>(
        `SELECT COUNT(*) AS count FROM platform_scopes`,
        [],
      ),
    ]);

    const total = parseInt(countResult[0]?.count ?? '0', 10);

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_scopes_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================
// POST — Create a new platform scope
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:scopes:write:${ip}`, {
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
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateScopeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const { name, description, risk_level, requires_approval } = parsed.data;

    const result = await executeQuery<{ id: string }>(
      `INSERT INTO platform_scopes (name, description, risk_level, requires_approval)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO NOTHING
       RETURNING id`,
      [name, description, risk_level, requires_approval],
    );

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'A scope with this name already exists' },
        { status: 409 },
      );
    }

    // Audit log
    await executeQuery(
      `INSERT INTO scope_audit_log
         (actor_user_id, action, target_type, target_id, after_state, justification)
       VALUES ($1, 'scope_created', 'platform_scope', $2, $3, 'Created via admin API')`,
      [authCtx.userId, result[0].id, JSON.stringify({ name, risk_level, requires_approval })],
    );

    return NextResponse.json(
      { id: result[0].id, name, description, risk_level, requires_approval },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_scopes_create' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
