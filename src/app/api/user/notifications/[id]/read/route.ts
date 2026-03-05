/**
 * PUT /api/user/notifications/[id]/read — Mark a single notification as read.
 *
 * Any authenticated user (restricted to own notifications).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { markRead } from '@/services/notifications/service';
import {
  RATE_LIMIT_WINDOW_MS,
  USER_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const UuidSchema = z.string().uuid('Invalid notification ID format');

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// PUT — Mark notification as read
// ============================================================

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`user:notifications:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: USER_WRITE_RATE_LIMIT_MAX_REQUESTS,
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

  const { id } = await params;
  const idParsed = UuidSchema.safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json(
      { error: 'Invalid notification ID', details: idParsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const updated = await markRead(idParsed.data, authCtx.userId);

    if (!updated) {
      return NextResponse.json(
        { error: 'Notification not found or already read' },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { read: true },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_user_notifications_read' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
