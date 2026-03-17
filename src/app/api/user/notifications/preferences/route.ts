/**
 * GET /api/user/notifications/preferences — Get notification preferences.
 * PUT /api/user/notifications/preferences — Update notification preferences.
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
  getPreferences,
  setPreferences,
} from '@/services/notifications/service';
import {
  RATE_LIMIT_WINDOW_MS,
  USER_READ_RATE_LIMIT_MAX_REQUESTS,
  USER_WRITE_RATE_LIMIT_MAX_REQUESTS,
  NOTIFICATION_EVENT_TYPES,
} from '@/domain/constants';
import type { NotificationChannel, NotificationEventType } from '@/domain/types';
import { getIp } from '@/services/security/ip';

// ============================================================
// SCHEMAS
// ============================================================

const PreferenceItemSchema = z.object({
  eventType: z.enum(NOTIFICATION_EVENT_TYPES as unknown as [string, ...string[]]) as z.ZodType<NotificationEventType>,
  channel:   z.enum(['in_app', 'email']) as z.ZodType<NotificationChannel>,
  enabled:   z.boolean(),
}).strict();

const UpdatePreferencesSchema = z.object({
  preferences: z.array(PreferenceItemSchema).min(1).max(100),
}).strict();

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// GET — Get notification preferences
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`user:notification-prefs:read:${ip}`, {
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
    const preferences = await getPreferences(authCtx.userId);

    return NextResponse.json(
      { preferences },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_user_notification_prefs_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================
// PUT — Update notification preferences
// ============================================================

export async function PUT(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`user:notification-prefs:write:${ip}`, {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdatePreferencesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await setPreferences(authCtx.userId, parsed.data.preferences);

    return NextResponse.json(
      { updated: parsed.data.preferences.length },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_user_notification_prefs_set' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
