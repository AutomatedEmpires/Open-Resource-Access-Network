/**
 * POST /api/admin/ingestion/candidates/[id]/publish — Publish a candidate to live DB.
 *
 * ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import {
  CandidateApprovalConflict,
  assertCandidatePublishApprovalEvidence,
} from '@/services/ingestion/candidateApprovals';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:ingestion:candidates:publish:write:${ip}`, {
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
    );
  }
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
    if (!requireMinRole(authCtx, 'oran_admin')) {
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

    // Check readiness
    const isReady = await stores.publishReadiness.meetsThreshold(id);
    if (!isReady) {
      const readiness = await stores.publishReadiness.getReadiness(id);
      return NextResponse.json(
        {
          error: 'Candidate does not meet publish threshold.',
          readiness,
        },
        { status: 422 }
      );
    }

    // The 0077 migration only expands the evidence schema. The 0078 activation
    // makes completed decisions immutable; livePublish then re-locks and
    // transactionally re-evaluates two independent approvals with no rejection.
    await assertCandidatePublishApprovalEvidence(id);

    const { publishCandidateToLiveService } = await import(
      '@/agents/ingestion/livePublish'
    );

    const { geocode, isConfigured: isGeocodingConfigured } = await import(
      '@/services/geocoding/nominatim'
    );

    const published = await publishCandidateToLiveService({
      stores,
      candidateId: id,
      publishedByUserId: authCtx.userId,
      geocode: isGeocodingConfigured() ? geocode : undefined,
    });

    return NextResponse.json({ success: true, serviceId: published.serviceId });
  } catch (error) {
    if (error instanceof CandidateApprovalConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
