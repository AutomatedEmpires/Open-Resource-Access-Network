/**
 * GET  /api/admin/ingestion/candidates/[id]/tags — List tag confirmations.
 * PUT  /api/admin/ingestion/candidates/[id]/tags — Update a tag confirmation.
 *
 * Community-admin or ORAN-admin may read; only community-admin reviewers may decide.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole, requireRole } from '@/services/auth/guards';
import {
  getCandidateReviewReadAccess,
  redactPeerReviewMetadata,
} from '@/services/ingestion/candidateReviewAccess';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

const TagDecisionSchema = z.object({
  confirmationId: z.string().uuid(),
  status: z.enum(['confirmed', 'modified', 'rejected']),
  confirmedValue: z.string().trim().min(1).max(2000).optional(),
  notes: z.string().max(2000).optional(),
}).strict().superRefine((decision, context) => {
  if (decision.status === 'modified' && !decision.confirmedValue) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmedValue'],
      message: 'A modified tag requires a confirmed value.',
    });
  }
  if (decision.status !== 'modified' && decision.confirmedValue !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['confirmedValue'],
      message: 'Only a modified tag may supply a different confirmed value.',
    });
  }
});
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(ip, { maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const authCtx = await getAuthContext();
    if (!authCtx) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!requireMinRole(authCtx, 'community_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid candidate ID.' }, { status: 400 });
    }
    const hasOranOversight = requireMinRole(authCtx, 'oran_admin');
    const reviewAccess = await getCandidateReviewReadAccess({
      candidateId: id,
      actorUserId: authCtx.userId,
      hasOranOversight,
    });
    if (!reviewAccess.allowed) {
      return NextResponse.json({ error: 'Candidate review access denied.' }, { status: 403 });
    }

    const { createIngestionStores } = await import(
      '@/agents/ingestion/persistence/storeFactory'
    );
    const { getDrizzle } = await import('@/services/db/drizzle');

    const db = getDrizzle();
    const stores = createIngestionStores(db);

    const confirmations = await stores.tagConfirmations.listForCandidate(id);
    const pendingByTier = await stores.tagConfirmations.countPendingByTier(id);

    return NextResponse.json({
      confirmations: hasOranOversight
        ? confirmations
        : confirmations.map(redactPeerReviewMetadata),
      pendingByTier,
    });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(ip, { maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const authCtx = await getAuthContext();
    if (!authCtx) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!requireRole(authCtx, 'community_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid candidate ID.' }, { status: 400 });
    }

    const body = await req.json();
    const parsed = TagDecisionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input.', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { createIngestionStores } = await import(
      '@/agents/ingestion/persistence/storeFactory'
    );
    const { getDrizzle } = await import('@/services/db/drizzle');

    const db = getDrizzle();
    const stores = createIngestionStores(db);

    const decisionResult = await stores.tagConfirmations.updateDecision(
      id,
      parsed.data.confirmationId,
      parsed.data.status,
      parsed.data.confirmedValue,
      undefined, // confirmedConfidence
      authCtx.userId,
      parsed.data.notes
    );
    if (decisionResult !== 'updated') {
      return NextResponse.json(
        { error: 'Decision can no longer be applied. Refresh the candidate and try again.' },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
