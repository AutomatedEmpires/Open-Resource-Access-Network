import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { getAuthContext } from '@/services/auth/session';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';

const SAVED_COLLECTIONS_RATE_LIMIT_MAX = 50;
const CollectionIdSchema = z.string().uuid('Collection id must be a valid UUID');
const CollectionServiceSchema = z.object({
  serviceId: z.string().uuid('serviceId must be a valid UUID'),
});

function checkSavedCollectionsRateLimit(ip: string) {
  return checkRateLimitShared(`saved-collections:ip:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: SAVED_COLLECTIONS_RATE_LIMIT_MAX,
  });
}

async function requireCollectionOwner(req: NextRequest, id: string) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Saved collections unavailable.' }, { status: 503 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = await checkSavedCollectionsRateLimit(ip);
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before making more requests.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ownership = await executeQuery<{ id: string }>(
    `SELECT id
     FROM saved_collections
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [id, authCtx.userId],
  );
  if (ownership.length === 0) {
    return NextResponse.json({ error: 'Collection not found.' }, { status: 404 });
  }

  return authCtx;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsedId = CollectionIdSchema.safeParse(id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid collection id.' }, { status: 400 });

  const authCtxOrResponse = await requireCollectionOwner(req, parsedId.data);
  if (authCtxOrResponse instanceof NextResponse) return authCtxOrResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CollectionServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  try {
    await executeQuery(
      `INSERT INTO saved_collection_services (collection_id, service_id)
       VALUES ($1, $2)
       ON CONFLICT (collection_id, service_id) DO NOTHING`,
      [parsedId.data, parsed.data.serviceId],
    );
    return NextResponse.json({ saved: true, collectionId: parsedId.data, serviceId: parsed.data.serviceId });
  } catch (error) {
    await captureException(error, {
      feature: 'api_saved_collection_services_post',
      userId: authCtxOrResponse.userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsedId = CollectionIdSchema.safeParse(id);
  if (!parsedId.success) return NextResponse.json({ error: 'Invalid collection id.' }, { status: 400 });

  const authCtxOrResponse = await requireCollectionOwner(req, parsedId.data);
  if (authCtxOrResponse instanceof NextResponse) return authCtxOrResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CollectionServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  try {
    await executeQuery(
      `DELETE FROM saved_collection_services
       WHERE collection_id = $1 AND service_id = $2`,
      [parsedId.data, parsed.data.serviceId],
    );
    return NextResponse.json({ removed: true, collectionId: parsedId.data, serviceId: parsed.data.serviceId });
  } catch (error) {
    await captureException(error, {
      feature: 'api_saved_collection_services_delete',
      userId: authCtxOrResponse.userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
