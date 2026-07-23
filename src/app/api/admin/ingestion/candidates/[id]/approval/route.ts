import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import { requireMinRole } from '@/services/auth/guards';
import { getAuthContext } from '@/services/auth/session';
import { isDatabaseConfigured } from '@/services/db/postgres';
import {
  CandidateApprovalConflict,
  claimCandidateApproval,
  decideCandidateApproval,
  isCandidateApprovalEvidenceProvisioned,
} from '@/services/ingestion/candidateApprovals';
import { getIp } from '@/services/security/ip';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ClaimActionSchema = z.object({
  action: z.literal('claim'),
  assignmentId: z.string().uuid(),
}).strict();

const DecideActionSchema = z.object({
  action: z.literal('decide'),
  assignmentId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'escalated']),
  notes: z.string().trim().max(4_000).optional(),
}).strict().superRefine((value, context) => {
  if (
    value.decision !== 'approved'
    && (!value.notes || value.notes.length < 20)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['notes'],
      message: 'Rejection and escalation notes must contain at least 20 characters.',
    });
  }
});

const ApprovalActionSchema = z.union([
  ClaimActionSchema,
  DecideActionSchema,
]);

/**
 * Claim or decide one assigned candidate review.
 *
 * Authorization is deliberately checked twice: the route requires an admin
 * role, and the transactional service locks the exact assignment and active
 * reviewer profile before mutating approval evidence.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rateLimit = await checkRateLimitShared(`admin:ingestion:candidate-approval:write:${ip}`, {
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rateLimit.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      {
        status: 503,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    );
  }
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  try {
    const auth = await getAuthContext();
    if (!auth) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!requireMinRole(auth, 'community_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Dark landing: claim would mutate assignment state under a schema whose
    // completion trigger is not installed, and decide would fail on the
    // missing decision_reviewer_user_id column. Unreachable until migration
    // 0077 provisions the evidence schema.
    if (!(await isCandidateApprovalEvidenceProvisioned())) {
      return NextResponse.json(
        { error: 'Candidate approval evidence schema is not provisioned.' },
        { status: 503 },
      );
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid candidate ID.' }, { status: 400 });
    }

    const parsed = ApprovalActionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid approval action.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = parsed.data.action === 'claim'
      ? await claimCandidateApproval({
          candidateId: id,
          assignmentId: parsed.data.assignmentId,
          actorUserId: auth.userId,
        })
      : await decideCandidateApproval({
          candidateId: id,
          assignmentId: parsed.data.assignmentId,
          actorUserId: auth.userId,
          decision: parsed.data.decision,
          notes: parsed.data.notes,
        });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof CandidateApprovalConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
