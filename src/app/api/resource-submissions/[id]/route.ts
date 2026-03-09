import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import {
  getResourceSubmissionDetailForActor,
  getResourceSubmissionDetailForPublic,
  isResourceSubmissionStatusEditable,
  projectApprovedResourceSubmission,
  saveResourceSubmissionDraft,
  setResourceSubmissionReviewerNotes,
  submitResourceSubmission,
  type ResourceSubmissionDetail,
} from '@/services/resourceSubmissions/service';
import { acquireLock, advance, applySla, assignSubmission } from '@/services/workflow/engine';
import type { SubmissionStatus, SubmissionType } from '@/domain/types';
import {
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';

type RouteContext = { params: Promise<{ id: string }> };

const UpdateResourceSubmissionSchema = z.object({
  action: z.enum(['save', 'submit', 'start_review', 'approve', 'deny', 'return', 'escalate']),
  title: z.string().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  reviewerNotes: z.string().max(5000).nullable().optional(),
  draft: z.unknown().optional(),
}).superRefine((value, ctx) => {
  if ((value.action === 'deny' || value.action === 'return') && !value.reviewerNotes?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewerNotes'],
      message: 'Reviewer notes are required when denying or returning a resource submission.',
    });
  }
});

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

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

async function ensureReviewClaim(detail: ResourceSubmissionDetail, reviewerUserId: string, reviewerRole: string) {
  if (detail.instance.assigned_to_user_id !== reviewerUserId) {
    await assignSubmission(detail.instance.submission_id, reviewerUserId, reviewerUserId, reviewerRole);
  }
  await acquireLock(detail.instance.submission_id, reviewerUserId);
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid resource submission ID' }, { status: 400 });
  }

  const rl = checkRateLimit(`resource-submissions:item:read:${getIp(req)}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
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

  const rl = checkRateLimit(`resource-submissions:item:write:${getIp(req)}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
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

    if (saveRequested) {
      await saveResourceSubmissionDraft(detail.instance.id, {
        title: parsed.data.title ?? undefined,
        notes: parsed.data.notes ?? undefined,
        draft: parsed.data.draft,
      });
    }

    if (parsed.data.reviewerNotes !== undefined) {
      await setResourceSubmissionReviewerNotes(detail.instance.submission_id, parsed.data.reviewerNotes ?? null);
    }

    await ensureReviewClaim(detail, authCtx.userId, authCtx.role);

    if (parsed.data.action === 'start_review') {
      let reviewTransition: { success: boolean; error?: string } | null = null;
      if (detail.instance.status !== 'under_review') {
        reviewTransition = await advance({
          submissionId: detail.instance.submission_id,
          toStatus: 'under_review',
          actorUserId: authCtx.userId,
          actorRole: authCtx.role,
          reason: parsed.data.reviewerNotes ?? 'Resource submission claimed for review',
          metadata: { form_instance_id: detail.instance.id },
        });
        if (!reviewTransition.success) {
          return NextResponse.json({ error: reviewTransition.error ?? 'Unable to start review.' }, { status: 409 });
        }
      }

      const refreshed = await getResourceSubmissionDetailForActor(authCtx, id);
      return NextResponse.json({ detail: refreshed, transition: reviewTransition });
    }

    if (detail.instance.status !== 'under_review') {
      const startReview = await advance({
        submissionId: detail.instance.submission_id,
        toStatus: 'under_review',
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: 'Resource submission opened for review',
        metadata: { form_instance_id: detail.instance.id },
      });
      if (!startReview.success) {
        return NextResponse.json({ error: startReview.error ?? 'Unable to start review.' }, { status: 409 });
      }
    }

    const targetStatus: Record<'approve' | 'deny' | 'return' | 'escalate', SubmissionStatus> = {
      approve: 'approved',
      deny: 'denied',
      return: 'returned',
      escalate: 'escalated',
    };

    const transition = await advance({
      submissionId: detail.instance.submission_id,
      toStatus: targetStatus[parsed.data.action as 'approve' | 'deny' | 'return' | 'escalate'],
      actorUserId: authCtx.userId,
      actorRole: authCtx.role,
      reason: parsed.data.reviewerNotes ?? `Resource submission ${parsed.data.action}`,
      metadata: { form_instance_id: detail.instance.id },
    });
    if (!transition.success) {
      return NextResponse.json({ error: transition.error ?? 'Unable to update resource status.' }, { status: 409 });
    }

    if (parsed.data.action === 'approve') {
      await projectApprovedResourceSubmission(id, authCtx.userId);
    }

    const refreshed = await getResourceSubmissionDetailForActor(authCtx, id);
    return NextResponse.json({ detail: refreshed, transition });
  } catch (error) {
    await captureException(error, { feature: 'api_resource_submissions_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
