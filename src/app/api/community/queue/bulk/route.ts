/**
 * PATCH /api/community/queue/bulk — Apply a bulk decision (approved / denied)
 * to a list of submission IDs.
 *
 * Body: { ids: string[], decision: 'approved' | 'denied', notes?: string }
 * Returns: { succeeded: string[], failed: { id: string, error: string }[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getCommunityAdminScope } from '@/services/community/scope';
import { advanceInTransaction, sendTerminalStatusEmail } from '@/services/workflow/engine';
import { lockBulkReviewSubmissions } from '@/services/queue/bulkReviewGuard';
import {
  RATE_LIMIT_WINDOW_MS,
  COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';
import { getIp } from '@/services/security/ip';
import { acquireLivePublicationGateShared } from '@/services/publication/liveEntityMerge';

// ============================================================
// SCHEMA
// ============================================================

const BulkDecisionSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  decision: z.enum(['approved', 'denied']),
  notes: z.string().max(5000).optional(),
}).strict();

class BulkDecisionConflict extends Error {
  constructor(
    readonly submissionId: string,
    readonly clientMessage: string,
  ) {
    super(clientMessage);
    this.name = 'BulkDecisionConflict';
  }
}

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// HANDLER
// ============================================================

export async function PATCH(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`community:queue:bulk:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BulkDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { decision, notes } = parsed.data;
  const ids = [...new Set(parsed.data.ids)];

  try {
    const scope = await getCommunityAdminScope(authCtx.userId);
    const outcome = await withTransaction(async (client) => {
      await acquireLivePublicationGateShared(client);
      const preflight = await lockBulkReviewSubmissions(
        client,
        ids,
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

      if (decision === 'approved' && preflight.individualReviewRequiredIds.length > 0) {
        return {
          kind: 'individual_review_required' as const,
          ids: preflight.individualReviewRequiredIds,
        };
      }

      for (const id of ids) {
        if (notes) {
          await client.query(
            `UPDATE submissions SET reviewer_notes = $1, updated_at = NOW() WHERE id = $2`,
            [notes, id],
          );
        }

        const result = await advanceInTransaction(client, {
          submissionId: id,
          toStatus: decision as SubmissionStatus,
          actorUserId: authCtx.userId,
          actorRole: authCtx.role,
          reason: notes ?? `Bulk decision: ${decision}`,
        });

        if (!result.success) {
          throw new BulkDecisionConflict(
            id,
            result.error ?? 'Cannot apply this decision',
          );
        }
      }

      return { kind: 'success' as const };
    });

    if (outcome.kind === 'scope_denied') {
      return NextResponse.json(
        {
          error: 'One or more submissions are outside your assigned community scope',
          succeeded: [],
          failed: outcome.ids.map((id) => ({
            id,
            error: 'Submission is outside your assigned community scope',
          })),
        },
        { status: 403 },
      );
    }

    if (outcome.kind === 'freshness_blocked') {
      return NextResponse.json(
        {
          error: 'Structured freshness reviews require individual evidence review',
          blockedIds: outcome.ids,
          succeeded: [],
          failed: outcome.ids.map((id) => ({
            id,
            error: 'Individual structured evidence review required',
          })),
        },
        { status: 409 },
      );
    }

    if (outcome.kind === 'individual_review_required') {
      return NextResponse.json(
        {
          error: 'Bulk approval is unavailable for submissions with dedicated review effects',
          blockedIds: outcome.ids,
          succeeded: [],
          failed: outcome.ids.map((id) => ({
            id,
            error: 'Use the dedicated single-item review endpoint',
          })),
        },
        { status: 409 },
      );
    }

    if (outcome.kind === 'ownership_denied') {
      return NextResponse.json(
        {
          error: 'Every submission must be claimed and locked by you before a bulk decision',
          succeeded: [],
          failed: outcome.ids.map((id) => ({
            id,
            error: 'Submission is not assigned and locked by the acting reviewer',
          })),
        },
        { status: 409 },
      );
    }

    for (const id of ids) {
      await sendTerminalStatusEmail(id, decision as SubmissionStatus);
    }

    return NextResponse.json({ succeeded: ids, failed: [] });
  } catch (error) {
    if (error instanceof BulkDecisionConflict) {
      return NextResponse.json(
        {
          error: 'Bulk decision failed; no changes were applied',
          succeeded: [],
          failed: [{ id: error.submissionId, error: error.clientMessage }],
        },
        { status: 409 },
      );
    }
    await captureException(error, { feature: 'api_community_queue_bulk' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
