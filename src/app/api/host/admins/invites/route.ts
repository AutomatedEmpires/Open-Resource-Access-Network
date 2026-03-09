/**
 * GET /api/host/admins/invites
 *
 * List pending organization invites for the authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthContext, shouldEnforceAuth } from '@/services/auth';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { getIp } from '@/services/security/ip';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';

const RATE_LIMIT_WINDOW_MS = 60_000;
const HOST_READ_RATE_LIMIT_MAX_REQUESTS = 60;

interface PendingInviteRow {
  id: string;
  organization_id: string;
  organization_name: string;
  role: 'host_member' | 'host_admin';
  status: string | null;
  created_at: string;
  updated_at: string | null;
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:admins:invites:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const auth = await getAuthContext();
  if (shouldEnforceAuth() && !auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const invites = await executeQuery<PendingInviteRow>(
      `SELECT om.id,
              om.organization_id,
              o.name AS organization_name,
              om.role,
              om.status,
              om.created_at,
              om.updated_at
       FROM organization_members om
       INNER JOIN organizations o ON o.id = om.organization_id
       WHERE om.user_id = $1
         AND om.status = 'pending_invite'
         AND (o.status IS NULL OR o.status != 'defunct')
       ORDER BY om.created_at DESC`,
      [auth.userId],
    );

    return NextResponse.json(
      { invites },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_host_admins_pending_invites' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
