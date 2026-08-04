/**
 * GET /api/admin/ingestion/candidates/[id]/readiness — Get publish readiness.
 *
 * ORAN-admin or community_admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getCandidateReviewReadAccess } from '@/services/ingestion/candidateReviewAccess';
import { getPeerBlindCandidateReviewReadiness } from '@/services/ingestion/candidateReviewReadiness';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
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

    const readiness = await stores.publishReadiness.getReadiness(id);
    if (!readiness) {
      return NextResponse.json(
        { error: 'Readiness data not found for candidate.' },
        { status: 404 }
      );
    }

    if (hasOranOversight) {
      return NextResponse.json({ readiness });
    }
    const peerBlindReadiness = await getPeerBlindCandidateReviewReadiness(id);
    return NextResponse.json({ readiness: peerBlindReadiness.reviewReadiness });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
