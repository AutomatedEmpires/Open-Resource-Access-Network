/**
 * POST /api/admin/bulk/advance — Bulk advance submissions.
 *
 * ORAN-admin or community_admin. Wraps WorkflowEngine.bulkAdvance()
 * with auth, rate limiting, and validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { bulkAdvance } from '@/services/workflow/engine';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';

// ============================================================
// SCHEMAS
// ============================================================

const BulkAdvanceSchema = z.object({
  submissionIds: z
    .array(z.string().uuid('Each submissionId must be a valid UUID'))
    .min(1, 'At least one submissionId required')
    .max(100, 'Maximum 100 submissions per batch'),
  toStatus: z.string().min(1) as z.ZodType<SubmissionStatus>,
  reason: z.string().max(5000).optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// POST
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`admin:bulk:advance:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
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
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = BulkAdvanceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { submissionIds, toStatus, reason } = parsed.data;

    const results = await bulkAdvance(
      submissionIds,
      toStatus,
      authCtx.userId,
      authCtx.role,
      reason,
    );

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return NextResponse.json({
      total: results.length,
      succeeded,
      failed,
      results,
    });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
