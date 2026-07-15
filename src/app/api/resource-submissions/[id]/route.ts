import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import {
  getResourceSubmissionDetailForActor,
  getResourceSubmissionDetailForPublic,
  isResourceSubmissionStatusEditable,
  projectApprovedResourceSubmission,
  projectApprovedResourceSubmissionInTransaction,
  ResourceProjectionRefreshConflict,
  saveResourceSubmissionDraft,
  saveResourceSubmissionDraftInTransaction,
  setResourceSubmissionReviewerNotesInTransaction,
  submitResourceSubmission,
  type ResourceSubmissionDetail,
} from '@/services/resourceSubmissions/service';
import {
  advance,
  advanceInTransaction,
  applySla,
  sendTerminalStatusEmail,
} from '@/services/workflow/engine';
import type { SubmissionStatus, SubmissionType } from '@/domain/types';
import { getIp } from '@/services/security/ip';
import {
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import {
  buildCommunitySubmissionScope,
  getCommunityAdminScope,
} from '@/services/community/scope';
import { acquireLivePublicationGateShared } from '@/services/publication/liveEntityMerge';
import {
  acquireFreshnessSensitiveAuthoritativeMutationGates,
  ProtectedAuthoritativeMutationConflict,
} from '@/services/publication/protectedAuthoritativeMutation';

type RouteContext = { params: Promise<{ id: string }> };

const UpdateResourceSubmissionSchema = z.object({
  action: z.enum(['save', 'submit', 'start_review', 'approve', 'deny', 'return', 'escalate']),
  title: z.string().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  reviewerNotes: z.string().max(5000).nullable().optional(),
  draft: z.unknown().optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.action === 'deny' || value.action === 'return') && !value.reviewerNotes?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewerNotes'],
      message: 'Reviewer notes are required when denying or returning a resource submission.',
    });
  }
});
function getPublicAccessToken(req: NextRequest): string | null {
  return req.headers.get('x-resource-submission-token')?.trim()
    || req.nextUrl.searchParams.get('token')?.trim()
    || null;
}

async function loadDetail(
  req: NextRequest,
  identifier: string,
): Promise<{ authCtx: Awaited<ReturnType<typeof getAuthContext>>; detail: ResourceSubmissionDetail | null }> {
  const authCtx = await getAuthContext();
  if (authCtx) {
    const detail = await getResourceSubmissionDetailForActor(authCtx, identifier);
    if (detail) {
      return { authCtx, detail };
    }
  }

  const token = getPublicAccessToken(req);
  if (!token) {
    return { authCtx, detail: null };
  }

  return {
    authCtx,
    detail: await getResourceSubmissionDetailForPublic(identifier, token),
  };
}

class ResourceReviewConflict extends Error {}

export async function GET(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid resource submission ID' }, { status: 400 });
  }

  const rl = await checkRateLimitShared(`resource-submissions:item:read:${getIp(req)}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
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

  try {
    const { detail } = await loadDetail(req, id);
    if (!detail) {
      return NextResponse.json({ error: 'Resource submission not found.' }, { status: 404 });
    }

    return NextResponse.json({ detail }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_resource_submissions_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid resource submission ID' }, { status: 400 });
  }

  const rl = await checkRateLimitShared(`resource-submissions:item:write:${getIp(req)}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdateResourceSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { authCtx, detail } = await loadDetail(req, id);
    if (!detail) {
      return NextResponse.json({ error: 'Resource submission not found.' }, { status: 404 });
    }

    const isReviewerAction = ['start_review', 'approve', 'deny', 'return', 'escalate'].includes(parsed.data.action);
    if (isReviewerAction) {
      if (!authCtx || !requireMinRole(authCtx, 'community_admin')) {
        return NextResponse.json({ error: 'Reviewer permissions required.' }, { status: 403 });
      }
    }

    if (!isReviewerAction && !authCtx && !getPublicAccessToken(req)) {
      return NextResponse.json({ error: 'Authentication or public access token required.' }, { status: 401 });
    }

    const saveRequested = parsed.data.draft !== undefined
      || parsed.data.title !== undefined
      || parsed.data.notes !== undefined;

    if (parsed.data.action === 'save') {
      if (!isReviewerAction && !authCtx && !isResourceSubmissionStatusEditable(detail.instance.status)) {
        return NextResponse.json({ error: 'Draft is no longer editable.' }, { status: 409 });
      }

      if (!authCtx && !isResourceSubmissionStatusEditable(detail.instance.status)) {
        return NextResponse.json({ error: 'Draft is no longer editable.' }, { status: 409 });
      }

      if (authCtx && !isReviewerAction && !isResourceSubmissionStatusEditable(detail.instance.status)) {
        return NextResponse.json({ error: 'Draft is no longer editable.' }, { status: 409 });
      }

      await saveResourceSubmissionDraft(detail.instance.id, {
        title: parsed.data.title ?? undefined,
        notes: parsed.data.notes ?? undefined,
        draft: parsed.data.draft,
      });

      const refreshed = authCtx
        ? await getResourceSubmissionDetailForActor(authCtx, id)
        : await getResourceSubmissionDetailForPublic(id, getPublicAccessToken(req)!);

      return NextResponse.json({ detail: refreshed });
    }

    if (parsed.data.action === 'submit') {
      if (!isResourceSubmissionStatusEditable(detail.instance.status)) {
        return NextResponse.json({ error: 'Submission is not editable in its current status.' }, { status: 409 });
      }

      if (saveRequested) {
        await saveResourceSubmissionDraft(detail.instance.id, {
          title: parsed.data.title ?? undefined,
          notes: parsed.data.notes ?? undefined,
          draft: parsed.data.draft,
        });
      }

      const actorUserId = authCtx?.userId ?? detail.instance.submitted_by_user_id;
      const actorRole = authCtx?.role ?? 'seeker';

      await submitResourceSubmission(detail.instance.id, actorUserId, actorRole);

      const submitted = await advance({
        submissionId: detail.instance.submission_id,
        toStatus: 'submitted',
        actorUserId,
        actorRole,
        reason: 'Resource submission submitted',
        metadata: { form_instance_id: detail.instance.id },
      });
      if (!submitted.success) {
        return NextResponse.json({ error: submitted.error ?? 'Unable to submit resource.' }, { status: 409 });
      }

      try {
        await applySla(detail.instance.submission_id, detail.instance.submission_type as SubmissionType);
      } catch {
        // SLA application is best-effort.
      }

      const queued = await advance({
        submissionId: detail.instance.submission_id,
        toStatus: 'needs_review',
        actorUserId,
        actorRole,
        reason: 'Resource submission queued for review',
        metadata: { form_instance_id: detail.instance.id },
      });
      if (!queued.success) {
        return NextResponse.json({ error: queued.error ?? 'Unable to queue resource for review.' }, { status: 409 });
      }

      const refreshed = authCtx
        ? await getResourceSubmissionDetailForActor(authCtx, id)
        : await getResourceSubmissionDetailForPublic(id, getPublicAccessToken(req)!);

      return NextResponse.json({ detail: refreshed, submitted, queued });
    }

    if (!authCtx) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }

    if (parsed.data.action === 'approve' && detail.instance.status === 'approved') {
      if (saveRequested) {
        return NextResponse.json(
          { error: 'Approved submission content cannot be changed during projection repair.' },
          { status: 409 },
        );
      }

      const projection = await projectApprovedResourceSubmission(id, authCtx.userId);
      const refreshed = await getResourceSubmissionDetailForActor(authCtx, id);
      return NextResponse.json({
        detail: refreshed,
        transition: null,
        projection,
        projectionRepair: true,
      });
    }

    const targetStatus: Record<'approve' | 'deny' | 'return' | 'escalate', SubmissionStatus> = {
      approve: 'approved',
      deny: 'denied',
      return: 'returned',
      escalate: 'escalated',
    };

    const scope = await getCommunityAdminScope(authCtx.userId);
    const reviewOutcome = await withTransaction(async (client) => {
      if (parsed.data.action === 'approve') {
        await acquireFreshnessSensitiveAuthoritativeMutationGates(client);
      } else {
        await acquireLivePublicationGateShared(client);
      }
      const params: unknown[] = [detail.instance.id, detail.instance.submission_id];
      const scopeCondition = authCtx.role === 'oran_admin'
        ? null
        : buildCommunitySubmissionScope('sub', scope, params);
      const lockedRows = await client.query<{
        form_instance_id: string;
        submission_id: string;
        status: SubmissionStatus;
        assigned_to_user_id: string | null;
        is_locked: boolean;
        locked_by_user_id: string | null;
      }>(
        `SELECT fi.id AS form_instance_id,
                sub.id AS submission_id,
                sub.status,
                sub.assigned_to_user_id,
                sub.is_locked,
                sub.locked_by_user_id
         FROM form_instances fi
         JOIN submissions sub ON sub.id = fi.submission_id
         WHERE fi.id = $1
           AND sub.id = $2
           ${scopeCondition ? `AND ${scopeCondition}` : ''}
         FOR UPDATE OF fi, sub`,
        params,
      );
      const locked = lockedRows.rows[0];
      if (!locked) return { kind: 'not_found' as const };

      let currentStatus = locked.status;
      let ownsReview = locked.assigned_to_user_id === authCtx.userId
        && locked.is_locked
        && locked.locked_by_user_id === authCtx.userId;

      if (currentStatus === 'under_review' && !ownsReview) {
        if (authCtx.role !== 'oran_admin') {
          throw new ResourceReviewConflict('Submission is already owned by another reviewer.');
        }
        const takeover = await client.query<{ id: string }>(
          `UPDATE submissions
           SET assigned_to_user_id = $1,
               is_locked = true,
               locked_at = NOW(),
               locked_by_user_id = $1,
               updated_at = NOW()
           WHERE id = $2
             AND status = 'under_review'
             AND assigned_to_user_id IS NOT DISTINCT FROM $3
             AND is_locked = $4
             AND locked_by_user_id IS NOT DISTINCT FROM $5
           RETURNING id`,
          [
            authCtx.userId,
            locked.submission_id,
            locked.assigned_to_user_id,
            locked.is_locked,
            locked.locked_by_user_id,
          ],
        );
        if (!takeover.rows[0]) {
          throw new ResourceReviewConflict('Review ownership changed; refresh and try again.');
        }
        await client.query(
          `INSERT INTO submission_transitions
             (submission_id, from_status, to_status, actor_user_id, actor_role,
              reason, gates_checked, gates_passed, metadata)
           VALUES ($1, 'under_review', 'under_review', $2, 'oran_admin',
                   'ORAN administrator review takeover', $3::jsonb, true, $4::jsonb)`,
          [
            locked.submission_id,
            authCtx.userId,
            JSON.stringify([{
              gate: 'oran_admin_takeover',
              passed: true,
              message: 'Explicit ORAN administrator takeover',
            }]),
            JSON.stringify({
              previousAssignedToUserId: locked.assigned_to_user_id,
              previousLockedByUserId: locked.locked_by_user_id,
            }),
          ],
        );
        ownsReview = true;
      }

      if (currentStatus === 'pending_second_approval' && !ownsReview) {
        const secondClaim = await client.query<{ id: string }>(
          `UPDATE submissions sub
           SET assigned_to_user_id = $1,
               is_locked = true,
               locked_at = NOW(),
               locked_by_user_id = $1,
               updated_at = NOW()
           WHERE sub.id = $2
             AND sub.status = 'pending_second_approval'
             AND sub.is_locked = false
             AND sub.assigned_to_user_id IS NULL
             AND NOT EXISTS (
               SELECT 1
               FROM submission_transitions prior_review
               WHERE prior_review.submission_id = sub.id
                 AND prior_review.actor_user_id = $1
                 AND prior_review.gates_passed = true
                 AND prior_review.to_status IN ('under_review', 'pending_second_approval')
             )
           RETURNING sub.id`,
          [authCtx.userId, locked.submission_id],
        );
        if (!secondClaim.rows[0]) {
          throw new ResourceReviewConflict(
            'Second approval must be claimed by a different authorized reviewer.',
          );
        }
        ownsReview = true;
      }

      if (['submitted', 'needs_review', 'escalated'].includes(currentStatus)) {
        if (currentStatus === 'escalated' && authCtx.role !== 'oran_admin') {
          throw new ResourceReviewConflict('Escalated submissions require an ORAN administrator.');
        }
        const claim = await client.query<{ id: string }>(
          `UPDATE submissions
           SET assigned_to_user_id = $1,
               is_locked = true,
               locked_at = NOW(),
               locked_by_user_id = $1,
               updated_at = NOW()
           WHERE id = $2
             AND status = $3
             AND (assigned_to_user_id IS NULL OR assigned_to_user_id = $1)
             AND (is_locked = false OR locked_by_user_id = $1)
           RETURNING id`,
          [authCtx.userId, locked.submission_id, currentStatus],
        );
        if (!claim.rows[0]) {
          throw new ResourceReviewConflict('Submission is already owned by another reviewer.');
        }
        ownsReview = true;

        if (currentStatus === 'submitted') {
          const queued = await advanceInTransaction(client, {
            submissionId: locked.submission_id,
            toStatus: 'needs_review',
            actorUserId: authCtx.userId,
            actorRole: authCtx.role,
            reason: 'Resource submission claimed for review',
            metadata: { form_instance_id: locked.form_instance_id },
          });
          if (!queued.success) {
            throw new ResourceReviewConflict(queued.error ?? 'Unable to queue review.');
          }
          currentStatus = 'needs_review';
        }

        const opened = await advanceInTransaction(client, {
          submissionId: locked.submission_id,
          toStatus: 'under_review',
          actorUserId: authCtx.userId,
          actorRole: authCtx.role,
          reason: parsed.data.reviewerNotes ?? 'Resource submission claimed for review',
          metadata: { form_instance_id: locked.form_instance_id },
        });
        if (!opened.success) {
          throw new ResourceReviewConflict(opened.error ?? 'Unable to start review.');
        }
        currentStatus = 'under_review';
      }

      if (!ownsReview || !['under_review', 'pending_second_approval'].includes(currentStatus)) {
        throw new ResourceReviewConflict('Claim and lock this submission before reviewing it.');
      }

      // Reviewer edits are intentionally after the guarded claim. Any failed
      // ownership check rolls back without changing draft content or notes.
      if (saveRequested) {
        await saveResourceSubmissionDraftInTransaction(client, locked.form_instance_id, {
          title: parsed.data.title ?? undefined,
          notes: parsed.data.notes ?? undefined,
          draft: parsed.data.draft,
        });
      }
      if (parsed.data.reviewerNotes !== undefined) {
        await setResourceSubmissionReviewerNotesInTransaction(
          client,
          locked.submission_id,
          parsed.data.reviewerNotes ?? null,
        );
      }

      if (parsed.data.action === 'start_review') {
        return { kind: 'success' as const, transition: null, projection: null };
      }

      const toStatus = targetStatus[
        parsed.data.action as 'approve' | 'deny' | 'return' | 'escalate'
      ];
      const transition = await advanceInTransaction(client, {
        submissionId: locked.submission_id,
        toStatus,
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: parsed.data.reviewerNotes ?? `Resource submission ${parsed.data.action}`,
        metadata: { form_instance_id: locked.form_instance_id },
      });
      if (!transition.success) {
        throw new ResourceReviewConflict(
          transition.error ?? 'Unable to update resource status.',
        );
      }

      const projection = parsed.data.action === 'approve'
        ? await projectApprovedResourceSubmissionInTransaction(client, id, authCtx.userId)
        : null;
      return { kind: 'success' as const, transition, projection };
    });

    if (reviewOutcome.kind === 'not_found') {
      return NextResponse.json(
        { error: 'Resource submission is no longer available in your review scope.' },
        { status: 404 },
      );
    }

    if (reviewOutcome.transition) {
      await sendTerminalStatusEmail(
        detail.instance.submission_id,
        reviewOutcome.transition.toStatus,
      );
    }

    const refreshed = await getResourceSubmissionDetailForActor(authCtx, id);
    return NextResponse.json({
      detail: refreshed,
      transition: reviewOutcome.transition,
      projection: reviewOutcome.projection,
    });
  } catch (error) {
    if (
      error instanceof ResourceReviewConflict
      || error instanceof ResourceProjectionRefreshConflict
      || error instanceof ProtectedAuthoritativeMutationConflict
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    await captureException(error, { feature: 'api_resource_submissions_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
