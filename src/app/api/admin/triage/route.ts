/**
 * GET  /api/admin/triage          — List triage queue for a given queue type.
 * POST /api/admin/triage          — Trigger (re-)scoring for all pending submissions.
 *
 * ORAN-admin only.
 *
 * Query params (GET):
 *   queue_type  — One of the QUEUE_TYPES values (required)
 *   limit       — Page size (default 25, max 100)
 *   offset      — Pagination offset (default 0)
 *   min_priority — Filter to items at or above this priority (default 0)
 *   sort_by     — 'priority' (default) or 'created_at'
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getTriageQueue, scoreAllPendingSubmissions } from '@/services/triage/triage';
import { QUEUE_TYPES } from '@/domain/triage';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const GetTriageSchema = z.object({
  queue_type:   z.enum(QUEUE_TYPES),
  limit:        z.coerce.number().int().min(1).max(100).default(25),
  offset:       z.coerce.number().int().min(0).default(0),
  min_priority: z.coerce.number().int().min(0).max(100).default(0),
  sort_by:      z.enum(['priority', 'created_at']).default('priority'),
});

// ============================================================
// GET — List triage queue
// ============================================================

export async function GET(req: NextRequest) {
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

  const limited = checkRateLimit(
    `triage:list:${authCtx.userId}`,
    { maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS },
  );
  if (limited.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  const parsed = GetTriageSchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters.', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { queue_type, limit, offset, min_priority, sort_by } = parsed.data;

  try {
    const { entries, total } = await getTriageQueue({
      queueType:   queue_type,
      limit,
      offset,
      minPriority: min_priority,
      sortBy:      sort_by,
    });

    return NextResponse.json(
      { entries, total, queue_type, limit, offset },
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Failed to load triage queue.' }, { status: 500 });
  }
}

// ============================================================
// POST — Trigger re-scoring for all pending submissions
// ============================================================

export async function POST(_req: NextRequest) {
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

  const limited = checkRateLimit(
    `triage:score:${authCtx.userId}`,
    { maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS },
  );
  if (limited.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  try {
    const count = await scoreAllPendingSubmissions();
    return NextResponse.json({ scored: count }, { status: 200 });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Failed to run triage scoring.' }, { status: 500 });
  }
}
