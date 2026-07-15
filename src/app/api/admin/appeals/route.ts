/**
 * GET  /api/admin/appeals        — List all appeals for review.
 * POST /api/admin/appeals        — Decide (approve/deny) an appeal.
 *
 * ORAN-admin + community_admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  buildCommunitySubmissionScope,
  getCommunityAdminScope,
} from '@/services/community/scope';
import { acquireLivePublicationGateShared } from '@/services/publication/liveEntityMerge';
import {
  advanceInTransaction,
  sendTerminalStatusEmail,
} from '@/services/workflow/engine';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';
import { getIp } from '@/services/security/ip';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['submitted', 'under_review', 'approved', 'denied', 'returned', '']).default(''),
});

const DecisionSchema = z.object({
  appealId:  z.string().uuid('appealId must be a valid UUID'),
  decision:  z.enum(['approved', 'denied', 'returned']),
  notes:     z.string().max(5000).optional(),
}).strict().refine(
  (data) => data.decision === 'approved' || (data.notes && data.notes.trim().length > 0),
  { message: 'Notes are required when denying or returning an appeal', path: ['notes'] },
);

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// GET — List appeals
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:appeals:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
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
    const { page, limit, status } = parsed.data;
    const offset = (page - 1) * limit;

    const conditions = [`s.submission_type = 'appeal'`];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (authCtx.role !== 'oran_admin') {
      const scope = await getCommunityAdminScope(authCtx.userId);
      const scopeCondition = buildCommunitySubmissionScope('s', scope, params);
      if (scopeCondition) conditions.push(scopeCondition);
      paramIdx = params.length + 1;
    }

    if (status) {
      conditions.push(`s.status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    const [rows, countResult] = await Promise.all([
      executeQuery<{
        id: string;
        status: SubmissionStatus;
        title: string | null;
        notes: string | null;
        reviewer_notes: string | null;
        submitted_by_user_id: string;
        assigned_to_user_id: string | null;
        priority: number;
        original_submission_id: string | null;
        original_submission_type: string | null;
        created_at: string;
        updated_at: string;
        service_id: string | null;
      }>(
        `SELECT s.id, s.status, s.title, s.notes, s.reviewer_notes,
                s.submitted_by_user_id, s.assigned_to_user_id, s.priority,
                s.payload->>'original_submission_id' AS original_submission_id,
                s.payload->>'original_submission_type' AS original_submission_type,
                s.created_at, s.updated_at, s.service_id
         FROM submissions s
         WHERE ${where}
         ORDER BY s.priority DESC, s.created_at ASC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      ),
      executeQuery<{ count: string }>(
        `SELECT COUNT(*) AS count FROM submissions s WHERE ${where}`,
        [...params],
      ),
    ]);

    const total = parseInt(countResult[0]?.count ?? '0', 10);

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_appeals_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================
// POST — Decide an appeal
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:appeals:write:${ip}`, {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { appealId, decision, notes } = parsed.data;

  try {
    const scope = authCtx.role === 'oran_admin'
      ? null
      : await getCommunityAdminScope(authCtx.userId);
    const atomicResult = await withTransaction(async (client) => {
      await acquireLivePublicationGateShared(client);
      // Resolve the typed lane under a row lock before changing the logical
      // review lock, notes, workflow state, or original submission.
      const appealParams: unknown[] = [appealId];
      const appealScope = scope
        ? buildCommunitySubmissionScope('appeal', scope, appealParams)
        : null;
      const appealRows = await client.query<{
        payload: Record<string, unknown> | null;
        status: SubmissionStatus;
      }>(
        `SELECT appeal.payload, appeal.status
         FROM submissions appeal
         WHERE appeal.id = $1
           AND appeal.submission_type = 'appeal'
           ${appealScope ? `AND ${appealScope}` : ''}
         FOR UPDATE OF appeal`,
        appealParams,
      );
      const appeal = appealRows.rows[0];
      if (!appeal) return { kind: 'not_found' } as const;
      if (!['submitted', 'returned', 'needs_review', 'under_review'].includes(appeal.status)) {
        return { kind: 'invalid_state', status: appeal.status } as const;
      }

      const originalId = appeal.payload?.original_submission_id;
      let originalToReopen: string | null = null;

      if (decision === 'approved' && typeof originalId === 'string') {
        // Serialize against the scanner so an appeal cannot race a new
        // freshness finding onto the original submission after this check.
        await client.query(
          `SELECT pg_catalog.pg_advisory_xact_lock(
             pg_catalog.hashtextextended('oran:resource-freshness-scan', 0)
           )`,
        );
        const originalRows = await client.query<{
          status: string;
          has_resource_freshness_packet: boolean;
          has_resource_freshness_finding: boolean;
        }>(
          `SELECT original.status,
                  coalesce(original.payload, '{}'::jsonb) ? 'resourceFreshness'
                    AS has_resource_freshness_packet,
                  EXISTS (
                    SELECT 1
                    FROM oran_internal.resource_freshness_findings finding
                    WHERE finding.submission_id = original.id
                  ) AS has_resource_freshness_finding
           FROM submissions original
           WHERE original.id = $1
           FOR UPDATE OF original`,
          [originalId],
        );
        const original = originalRows.rows[0];
        if (
          original?.has_resource_freshness_packet
          || original?.has_resource_freshness_finding
        ) {
          return { kind: 'freshness_original' } as const;
        }
        if (original?.status === 'denied') originalToReopen = originalId;
      }

      const lockRows = await client.query<{ id: string }>(
        `UPDATE submissions
         SET is_locked = true, locked_at = NOW(), locked_by_user_id = $1,
             assigned_to_user_id = $1, updated_at = NOW()
         WHERE id = $2
           AND submission_type = 'appeal'
           AND (is_locked = false OR locked_by_user_id = $1)
           AND (assigned_to_user_id IS NULL OR assigned_to_user_id = $1)
         RETURNING id`,
        [authCtx.userId, appealId],
      );
      if (lockRows.rows.length === 0) return { kind: 'locked' } as const;

      if (notes) {
        await client.query(
          `UPDATE submissions
           SET reviewer_notes = $1, updated_at = NOW()
           WHERE id = $2 AND submission_type = 'appeal'`,
          [notes, appealId],
        );
      }

      // Appeals are created in submitted and may be returned for more
      // information. Route them through the same auditable review states as
      // every other manual decision before applying a terminal outcome.
      const routing: Partial<Record<SubmissionStatus, SubmissionStatus>> = {
        returned: 'submitted',
        submitted: 'needs_review',
        needs_review: 'under_review',
      };
      let currentStatus = appeal.status;
      while (currentStatus !== 'under_review') {
        const nextStatus = routing[currentStatus];
        if (!nextStatus) {
          return { kind: 'invalid_state', status: currentStatus } as const;
        }
        const routed = await advanceInTransaction(client, {
          submissionId: appealId,
          toStatus: nextStatus,
          actorUserId: authCtx.userId,
          actorRole: authCtx.role,
          reason: 'Appeal routed for manual decision',
          metadata: { appealReviewRouting: true },
        });
        if (!routed.success) {
          await client.query(
            `UPDATE submissions
             SET is_locked = false, locked_at = NULL, locked_by_user_id = NULL,
                 updated_at = NOW()
             WHERE id = $1
               AND submission_type = 'appeal'
               AND locked_by_user_id = $2`,
            [appealId, authCtx.userId],
          );
          return { kind: 'transition_failed', result: routed } as const;
        }
        currentStatus = nextStatus;
      }

      const result = await advanceInTransaction(client, {
        submissionId: appealId,
        toStatus: decision as SubmissionStatus,
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: notes ?? `Appeal ${decision}`,
        metadata: { decision },
      });

      if (!result.success) {
        await client.query(
          `UPDATE submissions
           SET is_locked = false, locked_at = NULL, locked_by_user_id = NULL,
               updated_at = NOW()
           WHERE id = $1
             AND submission_type = 'appeal'
             AND locked_by_user_id = $2`,
          [appealId, authCtx.userId],
        );
        return { kind: 'transition_failed', result } as const;
      }

      // Re-opening is a projection of the appeal decision, so it must commit
      // atomically with the appeal transition and its audit record.
      if (originalToReopen) {
        const reopened = await client.query<{ id: string }>(
          `UPDATE submissions
           SET status = 'needs_review',
               reviewer_notes = 'Re-opened after successful appeal',
               updated_at = NOW()
           WHERE id = $1 AND status = 'denied'
           RETURNING id`,
          [originalToReopen],
        );
        if (reopened.rows.length === 0) {
          throw new Error('Original submission could not be re-opened atomically');
        }

        await client.query(
          `INSERT INTO submission_transitions
             (submission_id, from_status, to_status, actor_user_id, actor_role,
              reason, gates_checked, gates_passed, metadata)
           VALUES ($1, 'denied', 'needs_review', $2, $3, $4, '[]', true, $5)`,
          [
            originalToReopen,
            authCtx.userId,
            authCtx.role,
            'Re-opened after appeal approved',
            JSON.stringify({ appeal_id: appealId }),
          ],
        );
      }

      return { kind: 'success', result } as const;
    });

    if (atomicResult.kind === 'not_found') {
      return NextResponse.json({ error: 'Appeal not found' }, { status: 404 });
    }
    if (atomicResult.kind === 'freshness_original') {
      return NextResponse.json(
        { error: 'Resource freshness decisions cannot be re-opened through appeals' },
        { status: 409 },
      );
    }
    if (atomicResult.kind === 'invalid_state') {
      return NextResponse.json(
        { error: `Appeal cannot be decided from status ${atomicResult.status}` },
        { status: 409 },
      );
    }
    if (atomicResult.kind === 'locked') {
      return NextResponse.json(
        { error: 'Appeal is currently being reviewed by another admin' },
        { status: 409 },
      );
    }
    if (atomicResult.kind === 'transition_failed') {
      return NextResponse.json(
        { error: atomicResult.result.error ?? 'Cannot apply this decision' },
        { status: 409 },
      );
    }

    const { result } = atomicResult;
    await sendTerminalStatusEmail(result.submissionId, result.toStatus);

    return NextResponse.json(
      {
        success: true,
        appealId,
        decision,
        fromStatus: result.fromStatus,
        toStatus: result.toStatus,
        transitionId: result.transitionId,
        message: `Appeal ${decision} successfully`,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_appeals_decide' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
