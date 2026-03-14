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
import { mergeSourceFeedState, SourceFeedStatePatchSchema } from '../state';

const BulkUpdateSourceFeedsSchema = z.object({
  feedIds: z.array(z.string().min(1)).min(1).max(200),
  isActive: z.boolean().optional(),
  state: SourceFeedStatePatchSchema.optional(),
  useCheckpointAsReplay: z.boolean().optional(),
}).strict();

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

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

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (guard) return guard;

  try {
    const session = await getAuthContext();
    const body = await req.json();
    const parsed = BulkUpdateSourceFeedsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const stores = await loadStores();
    const feeds = await Promise.all(parsed.data.feedIds.map((id) => stores.sourceFeeds.getById(id)));
    const missingFeedIds = parsed.data.feedIds.filter((_, index) => !feeds[index]);
    if (missingFeedIds.length > 0) {
      return NextResponse.json(
        { error: 'Source feeds not found.', missingFeedIds },
        { status: 404 },
      );
    }

    for (const feedId of parsed.data.feedIds) {
      if (parsed.data.isActive !== undefined) {
        await stores.sourceFeeds.update(feedId, { isActive: parsed.data.isActive });
      }

      if (parsed.data.state || parsed.data.useCheckpointAsReplay) {
        const existingState = await stores.sourceFeedStates.getByFeedId(feedId);
        const replayFromCursor = parsed.data.useCheckpointAsReplay
          ? (existingState?.checkpointCursor ?? existingState?.replayFromCursor ?? '0')
          : parsed.data.state?.replayFromCursor;

        await stores.sourceFeedStates.upsert(
          mergeSourceFeedState(feedId, existingState, {
            ...(parsed.data.state ?? {}),
            replayFromCursor,
          }, { actorId: session?.userId ?? null }),
        );
      }
    }

    return NextResponse.json({ updated: parsed.data.feedIds.length });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
