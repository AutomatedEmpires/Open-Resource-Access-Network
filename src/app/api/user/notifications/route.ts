/**
 * GET /api/user/notifications — List notifications for the authenticated user (paginated).
 *
 * Query params:
 *   page  (default 1)
 *   limit (default 20, max 100)
 *   unread (optional, "true" to filter unread only)
 *
 * Any authenticated user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import {
  listNotifications,
  getUnread,
  getUnreadCount,
} from '@/services/notifications/service';
import {
  RATE_LIMIT_WINDOW_MS,
  USER_READ_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  unread: z.enum(['true', 'false']).optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// GET — List notifications
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`user:notifications:read:${ip}`, {
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
    const { page, limit, unread } = parsed.data;

    if (unread === 'true') {
      const notifications = await getUnread(authCtx.userId, limit);
      const count = await getUnreadCount(authCtx.userId);
      return NextResponse.json(
        { results: notifications, total: count, page: 1, unreadCount: count },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const { notifications, total } = await listNotifications(authCtx.userId, page, limit);
    const unreadCount = await getUnreadCount(authCtx.userId);

    return NextResponse.json(
      {
        results: notifications,
        total,
        page,
        hasMore: (page - 1) * limit + notifications.length < total,
        unreadCount,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_user_notifications_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
