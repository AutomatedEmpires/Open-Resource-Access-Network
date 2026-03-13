/**
 * GET /api/admin/ingestion/candidates/[id]/ai-review
 *
 * Returns an AI-generated review of a candidate service record.
 * Advisory only — never triggers auto-approval.
 *
 * Requires: community_admin or oran_admin
 * Gated by: llm_admin_assist feature flag
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { flagService } from '@/services/flags/flags';
import {
  FEATURE_FLAGS,
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import {
  reviewCandidateWithLLM,
  isReviewAssistConfigured,
  type CandidateForReview,
} from '@/services/admin/reviewAssist';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`ai-review:${ip}`, {
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
  }

  // Feature flag gate
  const flagEnabled = await flagService.isEnabled(FEATURE_FLAGS.LLM_ADMIN_ASSIST);
  if (!flagEnabled) {
    return NextResponse.json({ error: 'AI review feature not enabled.' }, { status: 403 });
  }

  if (!isReviewAssistConfigured()) {
    return NextResponse.json({ error: 'AI review service not configured.' }, { status: 503 });
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid candidate ID.' }, { status: 400 });
  }

  try {
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

    // Build review input — service metadata only, no seeker PII
    const forReview: CandidateForReview = {
      id: candidate.candidateId,
      serviceName: candidate.fields.serviceName,
      description: candidate.fields.description,
      organizationName: candidate.fields.organizationName,
      phone: candidate.fields.phone ?? null,
      websiteUrl: candidate.fields.websiteUrl ?? null,
      addressLine1: candidate.fields.address?.line1 ?? null,
      addressCity: candidate.fields.address?.city ?? null,
      addressRegion: candidate.fields.address?.region ?? null,
      addressPostalCode: candidate.fields.address?.postalCode ?? null,
    };

    const result = await reviewCandidateWithLLM(forReview);

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, { feature: 'ai_review', extra: { candidateId: id } });
    return NextResponse.json({ error: 'AI review failed. Please try again.' }, { status: 500 });
  }
}
