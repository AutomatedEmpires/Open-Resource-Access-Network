import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { getAuthContext } from '@/services/auth/session';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getIp } from '@/services/security/ip';

const SAVED_COLLECTIONS_RATE_LIMIT_MAX = 40;
const CollectionIdSchema = z.string().uuid('Collection id must be a valid UUID');
const UpdateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
}).strict();

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

  const ip = getIp(req);
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

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsedId = CollectionIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: 'Invalid collection id.' }, { status: 400 });
  }

  const authCtxOrResponse = await requireCollectionOwner(req, parsedId.data);
  if (authCtxOrResponse instanceof NextResponse) return authCtxOrResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdateCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const normalizedName = parsed.data.name.trim();
    const duplicate = await executeQuery<{ id: string }>(
      `SELECT id
       FROM saved_collections
       WHERE user_id = $1
         AND id != $2
         AND lower(name) = lower($3)
       LIMIT 1`,
      [authCtxOrResponse.userId, parsedId.data, normalizedName],
    );
    if (duplicate.length > 0) {
      return NextResponse.json({ error: 'Collection name already exists.' }, { status: 409 });
    }

    const updated = await executeQuery<{ id: string; name: string; created_at: string; updated_at: string }>(
      `UPDATE saved_collections
       SET name = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3
       RETURNING id, name, created_at, updated_at`,
      [normalizedName, parsedId.data, authCtxOrResponse.userId],
    );

    const collection = updated[0];
    return NextResponse.json({
      collection: {
        id: collection.id,
        name: collection.name,
        createdAt: collection.created_at,
        updatedAt: collection.updated_at,
      },
    });
  } catch (error) {
    await captureException(error, {
      feature: 'api_saved_collections_patch',
      userId: authCtxOrResponse.userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsedId = CollectionIdSchema.safeParse(id);
  if (!parsedId.success) {
    return NextResponse.json({ error: 'Invalid collection id.' }, { status: 400 });
  }

  const authCtxOrResponse = await requireCollectionOwner(req, parsedId.data);
  if (authCtxOrResponse instanceof NextResponse) return authCtxOrResponse;

  try {
    await executeQuery(
      `DELETE FROM saved_collections
       WHERE id = $1 AND user_id = $2`,
      [parsedId.data, authCtxOrResponse.userId],
    );
    return NextResponse.json({ removed: true, collectionId: parsedId.data });
  } catch (error) {
    await captureException(error, {
      feature: 'api_saved_collections_delete',
      userId: authCtxOrResponse.userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
