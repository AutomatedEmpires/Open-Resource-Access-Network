/**
 * GET  /api/admin/triage/[id]   — Get triage score for a single submission.
 * POST /api/admin/triage/[id]   — (Re-)score a single submission.
 *
 * ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getTriageScore, scoreSubmission } from '@/services/triage/triage';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

type Params = { params: Promise<{ id: string }> };

// ============================================================
// GET — Fetch stored triage score
// ============================================================

export async function GET(req: NextRequest, { params }: Params) {
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

  const { id } = await params;

  try {
    const score = await getTriageScore(id);
    if (!score) {
      return NextResponse.json({ error: 'No triage score found for this submission.' }, { status: 404 });
    }
    return NextResponse.json({ score });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Failed to fetch triage score.' }, { status: 500 });
  }
}

// ============================================================
// POST — (Re-)score a single submission
// ============================================================

export async function POST(req: NextRequest, { params }: Params) {
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
    `admin:triage:write:${authCtx.userId}`,
    { maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS },
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

  const { id } = await params;

  try {
    const score = await scoreSubmission(id);
    if (!score) {
      return NextResponse.json({ error: 'Submission not found.' }, { status: 404 });
    }
    return NextResponse.json({ score }, { status: 200 });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Failed to score submission.' }, { status: 500 });
  }
}
