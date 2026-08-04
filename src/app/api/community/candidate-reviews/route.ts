import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import { requireRole } from '@/services/auth/guards';
import { getAuthContext } from '@/services/auth/session';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { getIp } from '@/services/security/ip';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';

const ListParamsSchema = z.object({
  status: z.enum(['open', 'pending', 'claimed']).default('open'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(DEFAULT_PAGE_SIZE),
}).strict();

interface CandidateReviewInboxRow {
  candidate_id: string;
  assignment_id: string;
  assignment_status: 'pending' | 'claimed';
  expires_at: string | null;
  organization_name: string;
  service_name: string;
  description: string | null;
  website_url: string | null;
  jurisdiction_state: string | null;
  jurisdiction_county: string | null;
  jurisdiction_city: string | null;
  confidence_tier: string | null;
  confidence_score: number | null;
  candidate_updated_at: string;
}

/**
 * List only the signed-in reviewer's open candidate assignments.
 * Other reviewer identities, notes, outcomes, and timestamps are never
 * selected, preserving blind independent review.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rateLimit = await checkRateLimitShared(`community:candidate-reviews:read:${ip}`, {
    maxRequests: COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rateLimit.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable.' },
      { status: 503, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const auth = await getAuthContext();
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireRole(auth, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = ListParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters.', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;
  const assignmentStatusClause = status === 'open'
    ? "assignment.status IN ('pending', 'claimed')"
    : 'assignment.status = $2';
  const baseParams: unknown[] = [auth.userId];
  if (status !== 'open') baseParams.push(status);

  try {
    const countRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM public.candidate_admin_assignments assignment
       JOIN public.admin_review_profiles reviewer
         ON reviewer.id = assignment.admin_profile_id
       JOIN public.user_profiles account
         ON account.user_id = reviewer.user_id
       JOIN public.extracted_candidates candidate
         ON candidate.candidate_id = assignment.candidate_id
       WHERE reviewer.user_id = $1
         AND reviewer.is_active IS TRUE
         AND COALESCE(account.account_status, 'active') = 'active'
         AND account.role = 'community_admin'
         AND ${assignmentStatusClause}
         AND (assignment.expires_at IS NULL OR assignment.expires_at > NOW())
         AND candidate.published_service_id IS NULL
         AND candidate.review_status IN ('pending', 'in_review', 'escalated')`,
      baseParams,
    );
    const total = countRows[0]?.count ?? 0;

    const rows = await executeQuery<CandidateReviewInboxRow>(
      `SELECT candidate.candidate_id,
              assignment.id AS assignment_id,
              assignment.status AS assignment_status,
              assignment.expires_at,
              candidate.organization_name,
              candidate.service_name,
              candidate.description,
              candidate.website_url,
              candidate.jurisdiction_state,
              candidate.jurisdiction_county,
              candidate.jurisdiction_city,
              candidate.confidence_tier,
              candidate.confidence_score,
              candidate.updated_at AS candidate_updated_at
       FROM public.candidate_admin_assignments assignment
       JOIN public.admin_review_profiles reviewer
         ON reviewer.id = assignment.admin_profile_id
       JOIN public.user_profiles account
         ON account.user_id = reviewer.user_id
       JOIN public.extracted_candidates candidate
         ON candidate.candidate_id = assignment.candidate_id
       WHERE reviewer.user_id = $1
         AND reviewer.is_active IS TRUE
         AND COALESCE(account.account_status, 'active') = 'active'
         AND account.role = 'community_admin'
         AND ${assignmentStatusClause}
         AND (assignment.expires_at IS NULL OR assignment.expires_at > NOW())
         AND candidate.published_service_id IS NULL
         AND candidate.review_status IN ('pending', 'in_review', 'escalated')
       ORDER BY CASE WHEN assignment.status = 'claimed' THEN 0 ELSE 1 END,
                assignment.expires_at ASC,
                candidate.updated_at DESC,
                candidate.candidate_id ASC
       LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`,
      [...baseParams, limit, offset],
    );

    return NextResponse.json(
      {
        results: rows,
        total,
        page,
        hasMore: offset + rows.length < total,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
