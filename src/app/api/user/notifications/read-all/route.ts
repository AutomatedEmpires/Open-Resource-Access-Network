/**
 * PUT /api/user/notifications/read-all — Mark all notifications as read.
 *
 * Any authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { markAllRead } from '@/services/notifications/service';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  USER_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// PUT — Mark all notifications as read
// ============================================================

export async function PUT(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`user:notifications:read-all:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: USER_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
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
    const count = await markAllRead(authCtx.userId);

    return NextResponse.json(
      { markedRead: count },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_user_notifications_read_all' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
