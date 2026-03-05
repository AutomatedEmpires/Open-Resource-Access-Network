/**
 * GET /api/user/scopes — List the authenticated user's active scope grants.
 *
 * Any authenticated user. Returns both direct grants and role-based grants.
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import {
  RATE_LIMIT_WINDOW_MS,
  USER_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// GET — Current user's active scopes
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`user:scopes:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: USER_READ_RATE_LIMIT_MAX_REQUESTS,
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

  try {
    // Direct scope grants
    const directGrants = await executeQuery<{
      id: string;
      scope_name: string;
      scope_description: string;
      organization_id: string | null;
      granted_at: string;
      expires_at: string | null;
      source: string;
    }>(
      `SELECT usg.id, ps.name AS scope_name, ps.description AS scope_description,
              usg.organization_id, usg.created_at AS granted_at, usg.expires_at,
              'direct' AS source
       FROM user_scope_grants usg
       JOIN platform_scopes ps ON ps.id = usg.scope_id
       WHERE usg.user_id = $1
         AND usg.is_active = true
         AND (usg.expires_at IS NULL OR usg.expires_at > NOW())
       ORDER BY ps.name ASC`,
      [authCtx.userId],
    );

    // Role-based scope grants
    const roleGrants = await executeQuery<{
      scope_name: string;
      scope_description: string;
      source: string;
    }>(
      `SELECT DISTINCT ps.name AS scope_name, ps.description AS scope_description,
              'role' AS source
       FROM user_profiles up
       JOIN platform_roles pr ON pr.name = up.role AND pr.is_active = true
       JOIN role_scope_assignments rsa ON rsa.role_id = pr.id
       JOIN platform_scopes ps ON ps.id = rsa.scope_id AND ps.is_active = true
       WHERE up.user_id = $1
       ORDER BY ps.name ASC`,
      [authCtx.userId],
    );

    return NextResponse.json(
      { directGrants, roleGrants },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_user_scopes' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
