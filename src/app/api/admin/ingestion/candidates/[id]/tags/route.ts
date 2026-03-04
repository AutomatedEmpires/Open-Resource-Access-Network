/**
 * GET  /api/admin/ingestion/candidates/[id]/tags — List tag confirmations.
 * PUT  /api/admin/ingestion/candidates/[id]/tags — Update a tag confirmation.
 *
 * Community-admin or ORAN-admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

const TagDecisionSchema = z.object({
  confirmationId: z.string().uuid(),
  status: z.enum(['confirmed', 'modified', 'rejected']),
  confirmedValue: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(ip, { maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS, windowMs: RATE_LIMIT_WINDOW_MS });
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

    const confirmations = await stores.tagConfirmations.listForCandidate(id);
    const pendingByTier = await stores.tagConfirmations.countPendingByTier(id);

    return NextResponse.json({ confirmations, pendingByTier });
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
    if (!requireMinRole(authCtx, 'community_admin')) {
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

    await stores.tagConfirmations.updateDecision(
      parsed.data.confirmationId,
      parsed.data.status,
      parsed.data.confirmedValue,
      undefined, // confirmedConfidence
      authCtx.userId,
      parsed.data.notes
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
