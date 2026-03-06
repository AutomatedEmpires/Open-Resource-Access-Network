/**
 * POST /api/admin/embeddings/reindex
 *
 * Batch-embeds services that are missing a pgvector embedding.
 * Processes up to `limit` services per call (default 100, max 500).
 * ORAN-admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured, executeQuery } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import {
  buildServiceEmbeddingText,
  embedForIndexing,
  getServicesNeedingEmbedding,
  updateServiceEmbedding,
} from '@/services/search/embeddings';

const ReindexSchema = z.object({
  limit: z.number().int().min(1).max(500).default(100),
});

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(ip, {
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  try {
    const session = await getAuthContext();
    if (!session) {
      return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    }
    if (!requireMinRole(session, 'oran_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = ReindexSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { limit } = parsed.data;
    const services = await getServicesNeedingEmbedding(limit, executeQuery);

    let reindexed = 0;
    let failed = 0;

    for (const svc of services) {
      const text = buildServiceEmbeddingText(svc);
      const embedding = await embedForIndexing(text);
      if (embedding) {
        await updateServiceEmbedding(svc.id, embedding, executeQuery);
        reindexed++;
      } else {
        failed++;
      }
    }

    return NextResponse.json({ reindexed, failed, total: services.length });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
