/**
 * GET /api/admin/triage/summary — Per-queue counts and average priority.
 *
 * Returns a summary for all queue types: total items, high-priority count,
 * critical count, and average priority.
 *
 * ORAN-admin only. Suitable for dashboard overview panel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getTriageSummary } from '@/services/triage/triage';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

export async function GET(_req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  const limited = await checkRateLimitShared(
    `admin:triage:read:${authCtx.userId}`,
    { maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS },
  );
  if (limited.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }
  if (limited.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSeconds) } },
    );
  }

  try {
    const summary = await getTriageSummary();
    return NextResponse.json(
      { summary },
      { headers: { 'Cache-Control': 'private, max-age=30' } },
    );
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Failed to load triage summary.' }, { status: 500 });
  }
}
