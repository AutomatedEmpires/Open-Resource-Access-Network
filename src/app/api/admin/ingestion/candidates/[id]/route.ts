/**
 * GET    /api/admin/ingestion/candidates/[id] — Get candidate detail.
 * PATCH  /api/admin/ingestion/candidates/[id] — Update candidate status / fields.
 *
 * ORAN-admin or community_admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
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

const UpdateCandidateSchema = z.object({}).strict();

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
  const rl = await checkRateLimitShared(`admin:ingestion:candidates:read:${ip}`, { maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
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

    // Community reviewers must remain blind to other reviewers' identities,
    // notes, and outcomes. Full assignment evidence is reserved for ORAN
    // oversight; every reviewer receives only their own assignment and counts.
    const oversightAssignments = authCtx.role === 'oran_admin'
      ? stores.assignments.listForCandidate(id)
      : Promise.resolve(undefined);

    // Fetch related data in parallel
    const [
      tags,
      checks,
      links,
      tagConfirmations,
      suggestions,
      currentUserAssignments,
      assignmentProgressRows,
      assignments,
    ] =
      await Promise.all([
        stores.tags.listFor(id, 'candidate'),
        stores.checks.listFor(id),
        stores.links.listForCandidate(id),
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
                  assignment.outcome,
                  assignment.expires_at
           FROM public.candidate_admin_assignments assignment
           JOIN public.admin_review_profiles reviewer
             ON reviewer.id = assignment.admin_profile_id
           WHERE assignment.candidate_id = $1
             AND reviewer.user_id = $2
             AND assignment.status IN ('pending', 'claimed', 'completed')
           ORDER BY assignment.created_at DESC, assignment.id DESC
           LIMIT 1`,
          [id, authCtx.userId],
        ),
        executeQuery<{
          completed_review_count: number;
          open_review_count: number;
        }>(
          `SELECT count(DISTINCT CASE
                    WHEN assignment.status = 'completed' THEN reviewer.user_id
                  END)::integer AS completed_review_count,
                  count(DISTINCT CASE
                    WHEN assignment.status IN ('pending', 'claimed') THEN reviewer.user_id
                  END)::integer AS open_review_count
           FROM public.candidate_admin_assignments assignment
           JOIN public.admin_review_profiles reviewer
             ON reviewer.id = assignment.admin_profile_id
           WHERE assignment.candidate_id = $1`,
          [id],
        ),
        oversightAssignments,
      ]);

    return NextResponse.json({
      candidate,
      tags,
      checks,
      links,
      tagConfirmations,
      suggestions,
      currentUserAssignment: currentUserAssignments[0] ?? null,
      assignmentProgress: {
        completedReviewCount: assignmentProgressRows[0]?.completed_review_count ?? 0,
        openReviewCount: assignmentProgressRows[0]?.open_review_count ?? 0,
        requiredMatchingReviewCount: 2,
      },
      ...(assignments ? { assignments } : {}),
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
  const rl = await checkRateLimitShared(`admin:ingestion:candidates:write:${ip}`, { maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
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
    if (
      body
      && typeof body === 'object'
      && Object.prototype.hasOwnProperty.call(body, 'reviewStatus')
    ) {
      return NextResponse.json(
        { error: 'Candidate status decisions must use the assigned approval workflow.' },
        { status: 409 },
      );
    }
    const parsed = UpdateCandidateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input.', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
