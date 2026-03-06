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
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getTriageSummary } from '@/services/triage/triage';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const authCtx = await getAuthContext();
  const authError = requireMinRole(authCtx, 'oran_admin');
  if (authError) return authError;

  const limited = await checkRateLimit(
    `triage:summary:${authCtx!.userId}`,
    ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_MS,
  );
  if (limited) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
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
