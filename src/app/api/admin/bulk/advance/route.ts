/**
 * POST /api/admin/bulk/advance — Bulk advance submissions.
 *
 * ORAN-admin or community_admin. Wraps WorkflowEngine.bulkAdvance()
 * with auth, rate limiting, and validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getCommunityAdminScope } from '@/services/community/scope';
import {
  advanceInTransaction,
  sendTerminalStatusEmail,
  type AdvanceResult,
} from '@/services/workflow/engine';
import { lockBulkReviewSubmissions } from '@/services/queue/bulkReviewGuard';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';
import { getIp } from '@/services/security/ip';
import { acquireLivePublicationGateShared } from '@/services/publication/liveEntityMerge';

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
}).strict();

class BulkAdvanceConflict extends Error {
  constructor(
    readonly submissionId: string,
    readonly clientMessage: string,
  ) {
    super(clientMessage);
    this.name = 'BulkAdvanceConflict';
  }
}

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// POST
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:bulk:advance:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
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

    const { toStatus, reason } = parsed.data;
    const submissionIds = [...new Set(parsed.data.submissionIds)];
    const scope = await getCommunityAdminScope(authCtx.userId);
    const outcome = await withTransaction(async (client) => {
      // Regression-bearing submissions are live-publication signals. Serialize
      // with publication/merge writers, then lock and re-read every submission.
      await acquireLivePublicationGateShared(client);
      const preflight = await lockBulkReviewSubmissions(
        client,
        submissionIds,
        scope,
        authCtx.role === 'oran_admin',
        authCtx.userId,
      );

      if (preflight.inaccessibleIds.length > 0) {
        return { kind: 'scope_denied' as const, ids: preflight.inaccessibleIds };
      }

      if (preflight.reviewOwnershipConflictIds.length > 0) {
        return { kind: 'ownership_denied' as const, ids: preflight.reviewOwnershipConflictIds };
      }

      if (preflight.structuredFreshnessIds.length > 0) {
        return { kind: 'freshness_blocked' as const, ids: preflight.structuredFreshnessIds };
      }

      if (toStatus === 'approved' && preflight.individualReviewRequiredIds.length > 0) {
        return {
          kind: 'individual_review_required' as const,
          ids: preflight.individualReviewRequiredIds,
        };
      }

      const results: AdvanceResult[] = [];
      for (const submissionId of submissionIds) {
        const result = await advanceInTransaction(client, {
          submissionId,
          toStatus,
          actorUserId: authCtx.userId,
          actorRole: authCtx.role,
          reason,
        });
        if (!result.success) {
          throw new BulkAdvanceConflict(
            submissionId,
            result.error ?? 'Cannot apply this transition',
          );
        }
        results.push(result);
      }

      return { kind: 'success' as const, results };
    });

    if (outcome.kind === 'scope_denied') {
      return NextResponse.json(
        {
          error: 'One or more submissions are outside your assigned community scope',
          inaccessibleIds: outcome.ids,
        },
        { status: 403 },
      );
    }

    if (outcome.kind === 'freshness_blocked') {
      return NextResponse.json(
        {
          error: 'Structured freshness reviews require individual evidence review',
          blockedIds: outcome.ids,
        },
        { status: 409 },
      );
    }

    if (outcome.kind === 'individual_review_required') {
      return NextResponse.json(
        {
          error: 'Bulk approval is unavailable for submissions with dedicated review effects',
          blockedIds: outcome.ids,
        },
        { status: 409 },
      );
    }

    if (outcome.kind === 'ownership_denied') {
      return NextResponse.json(
        {
          error: 'Every submission must be claimed and locked by you before a bulk transition',
          blockedIds: outcome.ids,
        },
        { status: 409 },
      );
    }

    const { results } = outcome;

    for (const result of results) {
      await sendTerminalStatusEmail(result.submissionId, result.toStatus);
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return NextResponse.json({
      total: results.length,
      succeeded,
      failed,
      results,
    });
  } catch (err) {
    if (err instanceof BulkAdvanceConflict) {
      return NextResponse.json(
        {
          error: 'Bulk transition failed; no changes were applied',
          failedSubmissionId: err.submissionId,
          reason: err.clientMessage,
        },
        { status: 409 },
      );
    }
    captureException(err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
