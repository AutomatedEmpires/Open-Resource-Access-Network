import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import { mergeSourceFeedState } from '../../state';
import { getIp } from '@/services/security/ip';

const ReplaySourceFeedSchema = z.object({
  replayFromCursor: z.string().min(1).optional(),
}).strict();
async function requireAdmin(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const rl = await checkRateLimitShared(getIp(req), {
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const session = await getAuthContext();
  if (!session) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(session, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  return null;
}

async function loadStores() {
  const { createIngestionStores } = await import('@/agents/ingestion/persistence/storeFactory');
  const { getDrizzle } = await import('@/services/db/drizzle');
  return createIngestionStores(getDrizzle());
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) ?? {};
    const parsed = ReplaySourceFeedSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const stores = await loadStores();
    const sourceFeed = await stores.sourceFeeds.getById(id);
    if (!sourceFeed) {
      return NextResponse.json({ error: 'Source feed not found.' }, { status: 404 });
    }

    const existingState = await stores.sourceFeedStates.getByFeedId(id);
    const replayFromCursor =
      parsed.data.replayFromCursor
      ?? existingState?.checkpointCursor
      ?? existingState?.replayFromCursor
      ?? '0';

    await stores.sourceFeedStates.upsert(
      mergeSourceFeedState(id, existingState, { replayFromCursor }),
    );

    return NextResponse.json({ queued: true, replayFromCursor });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
