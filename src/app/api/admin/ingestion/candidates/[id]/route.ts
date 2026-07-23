/**
 * GET    /api/admin/ingestion/candidates/[id] — Get candidate detail.
 * PATCH  /api/admin/ingestion/candidates/[id] — Update candidate status / fields.
 *
 * ORAN-admin or community_admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS } from '@/services/ingestion/candidateApprovals';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const UpdateCandidateSchema = z.object({
  reviewStatus: z
    .enum(['pending', 'in_review', 'verified', 'rejected', 'escalated', 'published', 'archived'])
    .optional(),
}).strict();

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

    // Fetch related data in parallel
    const [
      tags, checks, links, assignments, tagConfirmations, suggestions,
      currentUserAssignmentRows, assignmentProgressRows,
    ] = await Promise.all([
      stores.tags.listFor(id, 'candidate'),
      stores.checks.listFor(id),
      stores.links.listForCandidate(id),
      stores.assignments.listForCandidate(id),
      stores.tagConfirmations.listForCandidate(id),
      stores.llmSuggestions.listForCandidate(id),
      executeQuery<{
        id: string;
        status: string;
        outcome: string | null;
        expires_at: string | null;
      }>(
        `SELECT assignment.id,
                assignment.status,
                CASE WHEN assignment.status = 'completed' THEN assignment.outcome END AS outcome,
                assignment.expires_at
         FROM public.candidate_admin_assignments assignment
         JOIN public.admin_review_profiles reviewer
           ON reviewer.id = assignment.admin_profile_id
         WHERE assignment.candidate_id = $1
           AND reviewer.user_id = $2`,
        [id, authCtx.userId],
      ),
      executeQuery<{
        completed_review_count: number;
        open_review_count: number;
      }>(
        `SELECT count(*) FILTER (WHERE status = 'completed')::integer AS completed_review_count,
                count(*) FILTER (WHERE status IN ('pending', 'claimed'))::integer AS open_review_count
         FROM public.candidate_admin_assignments
         WHERE candidate_id = $1`,
        [id],
      ),
    ]);

    return NextResponse.json({
      candidate,
      tags,
      checks,
      links,
      // Peer assignment rows expose reviewer identity + outcome, which would
      // let a reviewer anchor on a colleague's decision. Blind independent
      // review: only oran_admin (the oversight portal) receives them.
      ...(requireMinRole(authCtx, 'oran_admin') ? { assignments } : {}),
      tagConfirmations,
      suggestions,
      currentUserAssignment: currentUserAssignmentRows[0] ?? null,
      assignmentProgress: {
        completedReviewCount: assignmentProgressRows[0]?.completed_review_count ?? 0,
        openReviewCount: assignmentProgressRows[0]?.open_review_count ?? 0,
        requiredMatchingReviewCount: REQUIRED_INDEPENDENT_CANDIDATE_APPROVALS,
      },
    });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function PATCH(
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
    if (!requireMinRole(authCtx, 'community_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const { id } = await params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid candidate ID.' }, { status: 400 });
    }

    const body = await req.json();
    const parsed = UpdateCandidateSchema.safeParse(body);
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

    if (parsed.data.reviewStatus) {
      await stores.candidates.updateReviewStatus(
        id,
        parsed.data.reviewStatus,
        authCtx.userId
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
