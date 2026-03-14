/**
 * GET    /api/admin/ingestion/source-feeds/[id]
 * PUT    /api/admin/ingestion/source-feeds/[id]
 * DELETE /api/admin/ingestion/source-feeds/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import { mergeSourceFeedState, SourceFeedStatePatchSchema } from '../state';

const JurisdictionScopeSchema = z.object({
  kind: z.enum(['local', 'regional', 'statewide', 'national', 'virtual']).optional(),
  country: z.string().min(2).max(2).optional(),
  stateProvince: z.string().min(1).optional(),
  countyOrRegion: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  postalCode: z.string().min(1).optional(),
}).strict();

const UpdateSourceFeedSchema = z.object({
  feedName: z.string().min(1).max(200).optional(),
  feedType: z.string().min(1).max(100).optional(),
  feedHandler: z.enum(['none', 'hsds_api', 'ndp_211', 'azure_function']).optional(),
  baseUrl: z.string().url().nullable().optional(),
  healthcheckUrl: z.string().url().nullable().optional(),
  authType: z.string().min(1).max(50).nullable().optional(),
  profileUri: z.string().url().nullable().optional(),
  jurisdictionScope: JurisdictionScopeSchema.optional(),
  refreshIntervalHours: z.number().int().min(1).max(720).optional(),
  isActive: z.boolean().optional(),
  state: SourceFeedStatePatchSchema.optional(),
}).strict();

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

async function requireAdmin(req: NextRequest, maxRequests: number) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const rl = await checkRateLimitShared(getIp(req), { maxRequests, windowMs: RATE_LIMIT_WINDOW_MS });
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin(req, ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS);
  if (guard) return guard;

  try {
    const { id } = await params;
    const stores = await loadStores();
    const sourceFeed = await stores.sourceFeeds.getById(id);
    if (!sourceFeed) {
      return NextResponse.json({ error: 'Source feed not found.' }, { status: 404 });
    }

    const state = await stores.sourceFeedStates.getByFeedId(id);
    return NextResponse.json({ sourceFeed, state });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin(req, ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS);
  if (guard) return guard;

  try {
    const session = await getAuthContext();
    const { id } = await params;
    const body = await req.json();
    const parsed = UpdateSourceFeedSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const stores = await loadStores();
    const existing = await stores.sourceFeeds.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Source feed not found.' }, { status: 404 });
    }

    const { state, ...feedUpdates } = parsed.data;
    if (Object.keys(feedUpdates).length > 0) {
      await stores.sourceFeeds.update(id, feedUpdates);
    }
    if (state) {
      const existingState = await stores.sourceFeedStates.getByFeedId(id);
      await stores.sourceFeedStates.upsert(
        mergeSourceFeedState(id, existingState, state, { actorId: session?.userId ?? null }),
      );
    }

    return NextResponse.json({ updated: true });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdmin(req, ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS);
  if (guard) return guard;

  try {
    const { id } = await params;
    const stores = await loadStores();
    const existing = await stores.sourceFeeds.getById(id);
    if (!existing) {
      return NextResponse.json({ error: 'Source feed not found.' }, { status: 404 });
    }
    await stores.sourceFeeds.deactivate(id);
    return NextResponse.json({ deactivated: true });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
