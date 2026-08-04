/**
 * GET /api/admin/ingestion/candidates/[id] — Get candidate detail.
 *
 * Governed review mutations use the assignment-bound /approval route.
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS } from '@/services/ingestion/candidateApprovals';
import {
  getCandidateReviewReadAccess,
  redactCandidateAssignmentMetadata,
  redactPeerReviewMetadata,
} from '@/services/ingestion/candidateReviewAccess';
import { getPeerBlindCandidateReviewReadiness } from '@/services/ingestion/candidateReviewReadiness';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// HELPERS
// ============================================================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============================================================
// HANDLERS
// ============================================================

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
      return NextResponse.json(
        { error: 'This candidate is not assigned to the current reviewer.' },
        { status: 403 },
      );
    }

    const { createIngestionStores } = await import(
      '@/agents/ingestion/persistence/storeFactory'
    );
    const { getDrizzle } = await import('@/services/db/drizzle');

    const db = getDrizzle();
    const stores = createIngestionStores(db);

    const candidate = await stores.candidates.getById(id);
    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found.' }, { status: 404 });
    }

    const readinessSnapshot = await getPeerBlindCandidateReviewReadiness(id);

    // Fetch related data in parallel
    const [
      tags, checks, links, assignments, tagConfirmations, suggestions,
      assignmentProgressRows,
    ] = await Promise.all([
      stores.tags.listFor(id, 'candidate'),
      stores.checks.listFor(id),
      stores.links.listForCandidate(id),
      hasOranOversight ? stores.assignments.listForCandidate(id) : Promise.resolve([]),
      stores.tagConfirmations.listForCandidate(id),
      stores.llmSuggestions.listForCandidate(id),
      hasOranOversight ? executeQuery<{
        completed_review_count: number;
        open_review_count: number;
      }>(
        `SELECT count(*) FILTER (WHERE status = 'completed')::integer AS completed_review_count,
                count(*) FILTER (WHERE status IN ('pending', 'claimed'))::integer AS open_review_count
         FROM public.candidate_admin_assignments
         WHERE candidate_id = $1`,
        [id],
      ) : Promise.resolve([]),
    ]);

    return NextResponse.json({
      candidate: hasOranOversight ? candidate : redactCandidateAssignmentMetadata(candidate),
      tags: hasOranOversight ? tags : tags.map(redactPeerReviewMetadata),
      checks: hasOranOversight ? checks : checks.map(redactPeerReviewMetadata),
      links: hasOranOversight ? links : links.map(redactPeerReviewMetadata),
      // Peer assignment rows expose reviewer identity + outcome, which would
      // let a reviewer anchor on a colleague's decision. Blind independent
      // review: only oran_admin (the oversight portal) receives them.
      ...(hasOranOversight ? { assignments } : {}),
      tagConfirmations: hasOranOversight
        ? tagConfirmations
        : tagConfirmations.map(redactPeerReviewMetadata),
      suggestions: hasOranOversight
        ? suggestions
        : suggestions.map(redactPeerReviewMetadata),
      reviewReadiness: readinessSnapshot.reviewReadiness,
      currentUserAssignment: reviewAccess.assignment,
      canMutateEvidence: reviewAccess.assignment?.status === 'claimed'
        && readinessSnapshot.evidenceStillMutable,
      ...(hasOranOversight ? {
        assignmentProgress: {
          completedReviewCount: assignmentProgressRows[0]?.completed_review_count ?? 0,
          openReviewCount: assignmentProgressRows[0]?.open_review_count ?? 0,
          requiredMatchingReviewCount: REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS,
        },
      } : {}),
    });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
