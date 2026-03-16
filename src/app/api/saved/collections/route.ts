import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { getAuthContext } from '@/services/auth/session';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';

const SAVED_COLLECTIONS_RATE_LIMIT_MAX = 40;

const CreateCollectionSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

interface SavedCollectionJoinRow {
  collection_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  service_id: string | null;
}

function checkSavedCollectionsRateLimit(ip: string) {
  return checkRateLimitShared(`saved-collections:ip:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: SAVED_COLLECTIONS_RATE_LIMIT_MAX,
  });
}

async function requireAuthAndCapacity(req: NextRequest) {
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

  return authCtx;
}

export async function GET(req: NextRequest) {
  const authCtxOrResponse = await requireAuthAndCapacity(req);
  if (authCtxOrResponse instanceof NextResponse) return authCtxOrResponse;

  try {
    const rows = await executeQuery<SavedCollectionJoinRow>(
      `SELECT sc.id AS collection_id,
              sc.name,
              sc.created_at,
              sc.updated_at,
              scs.service_id
       FROM saved_collections sc
       LEFT JOIN saved_collection_services scs
         ON scs.collection_id = sc.id
       WHERE sc.user_id = $1
       ORDER BY sc.created_at ASC, scs.saved_at ASC NULLS LAST`,
      [authCtxOrResponse.userId],
    );

    const collections = new Map<string, { id: string; name: string; createdAt: string; updatedAt: string }>();
    const serviceAssignments: Record<string, string[]> = {};

    for (const row of rows) {
      if (!collections.has(row.collection_id)) {
        collections.set(row.collection_id, {
          id: row.collection_id,
          name: row.name,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }

      if (row.service_id) {
        serviceAssignments[row.service_id] = [...(serviceAssignments[row.service_id] ?? []), row.collection_id];
      }
    }

    return NextResponse.json({
      collections: Array.from(collections.values()),
      serviceAssignments,
    });
  } catch (error) {
    await captureException(error, {
      feature: 'api_saved_collections_get',
      userId: authCtxOrResponse.userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authCtxOrResponse = await requireAuthAndCapacity(req);
  if (authCtxOrResponse instanceof NextResponse) return authCtxOrResponse;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateCollectionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
  }

  try {
    const normalizedName = parsed.data.name.trim();
    const duplicate = await executeQuery<{ id: string }>(
      `SELECT id
       FROM saved_collections
       WHERE user_id = $1
         AND lower(name) = lower($2)
       LIMIT 1`,
      [authCtxOrResponse.userId, normalizedName],
    );
    if (duplicate.length > 0) {
      return NextResponse.json({ error: 'Collection name already exists.' }, { status: 409 });
    }

    const created = await executeQuery<{ id: string; name: string; created_at: string; updated_at: string }>(
      `INSERT INTO saved_collections (user_id, name)
       VALUES ($1, $2)
       RETURNING id, name, created_at, updated_at`,
      [authCtxOrResponse.userId, normalizedName],
    );

    const collection = created[0];
    return NextResponse.json({
      collection: {
        id: collection.id,
        name: collection.name,
        createdAt: collection.created_at,
        updatedAt: collection.updated_at,
      },
    }, { status: 201 });
  } catch (error) {
    await captureException(error, {
      feature: 'api_saved_collections_post',
      userId: authCtxOrResponse.userId,
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
