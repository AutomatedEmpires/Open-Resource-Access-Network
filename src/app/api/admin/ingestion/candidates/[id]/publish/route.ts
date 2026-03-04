/**
 * POST /api/admin/ingestion/candidates/[id]/publish — Publish a candidate to live DB.
 *
 * ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(ip, { maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
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

    // Generate a service ID for the published service
    const serviceId = crypto.randomUUID();

    // Mark candidate as published
    await stores.candidates.markPublished(id, serviceId, authCtx.userId);

    // Transfer links from candidate to service
    await stores.links.transferToService(id, serviceId);

    // Withdraw all remaining assignments
    await stores.assignments.withdrawAllForCandidate(id);

    // Audit event
    await stores.audit.append({
      eventId: crypto.randomUUID(),
      correlationId: crypto.randomUUID(),
      eventType: 'publish.approved',
      actorType: 'human',
      actorId: authCtx.userId,
      targetType: 'candidate',
      targetId: id,
      timestamp: new Date().toISOString(),
      inputs: {},
      outputs: { serviceId },
      evidenceRefs: [],
    });

    return NextResponse.json({ success: true, serviceId });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
