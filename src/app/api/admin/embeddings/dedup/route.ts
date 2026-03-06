/**
 * POST /api/admin/embeddings/dedup
 *
 * Identifies near-duplicate services using pgvector cosine similarity.
 * For each service sampled, finds its top-K neighbors and groups those
 * with similarity ≥ DEDUP_THRESHOLD (0.92) into candidate clusters.
 * Returns clusters for admin review — no automatic merging is performed.
 *
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
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import { buildVectorTopKQuery } from '@/services/search/vectorSearch';
import type { VectorSimilarityRow } from '@/services/search/vectorSearch';

const DEDUP_THRESHOLD = 0.92;
const NEIGHBORS_PER_PROBE = 5;

const DedupSchema = z.object({
  /** Max number of services to probe. Keep low for interactive use. */
  probeLimit: z.number().int().min(1).max(200).default(50),
  /** Similarity threshold (0–1). Pairs above this are flagged as duplicates. */
  threshold: z.number().min(0.5).max(1.0).default(DEDUP_THRESHOLD),
});

interface ServiceProbe {
  id: string;
  name: string;
  embedding: string; // raw vector literal from DB
}

interface DedupCluster {
  ids: string[];
  similarity: number;
}

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(ip, {
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
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
    const parsed = DedupSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { probeLimit, threshold } = parsed.data;

    // Load probe services (those with embeddings)
    const probes = await executeQuery<ServiceProbe>(
      `SELECT id, name, embedding::text AS embedding
       FROM services
       WHERE embedding IS NOT NULL AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT $1`,
      [probeLimit],
    );

    // For each probe, find nearest neighbors using the HNSW index
    // Track seen pairs to avoid duplicates in output
    const seenPairs = new Set<string>();
    const clusters: DedupCluster[] = [];

    for (const probe of probes) {
      // Parse stored vector literal "[0.1,0.2,...]" → number[]
      let embeddingArr: number[];
      try {
        embeddingArr = JSON.parse(probe.embedding) as number[];
      } catch {
        continue;
      }

      const { sql, params } = buildVectorTopKQuery(
        embeddingArr,
        NEIGHBORS_PER_PROBE + 1, // +1 because the probe itself will appear
      );

      const neighborRows = await executeQuery<VectorSimilarityRow>(sql, params);
      const neighbors = neighborRows.filter(
        (row: VectorSimilarityRow) => row.id !== probe.id && row.similarity >= threshold,
      );

      for (const neighbor of neighbors) {
        const pairKey = [probe.id, neighbor.id].sort().join('|');
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        clusters.push({
          ids: [probe.id, neighbor.id],
          similarity: Math.round(neighbor.similarity * 1000) / 1000,
        });
      }
    }

    // Sort by descending similarity so the most likely duplicates appear first
    clusters.sort((a, b) => b.similarity - a.similarity);

    return NextResponse.json({
      clusters,
      probesScanned: probes.length,
      threshold,
    });
  } catch (err) {
    captureException(err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
