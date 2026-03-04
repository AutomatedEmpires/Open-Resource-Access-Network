/**
 * POST /api/admin/ingestion/process — Trigger the ingestion pipeline for a URL.
 *
 * ORAN-admin only. Accepts a URL and runs the full pipeline.
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
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const ProcessSchema = z.object({
  sourceUrl: z.string().url('sourceUrl must be a valid URL'),
  forceReprocess: z.boolean().optional().default(false),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// HANDLERS
// ============================================================

export async function POST(req: NextRequest) {
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

    const body = await req.json();
    const parsed = ProcessSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input.', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Lazy import to avoid circular deps and keep route light
    const { createIngestionStores } = await import(
      '@/agents/ingestion/persistence/storeFactory'
    );
    const { createIngestionService } = await import(
      '@/agents/ingestion/service'
    );
    const { getDrizzle } = await import('@/services/db/drizzle');

    const db = getDrizzle();
    const stores = createIngestionStores(db);
    const service = createIngestionService(stores);

    const result = await service.runPipeline({
      sourceUrl: parsed.data.sourceUrl,
      forceReprocess: parsed.data.forceReprocess,
      triggeredBy: authCtx.userId,
    });

    return NextResponse.json({
      jobId: result.job.id,
      correlationId: result.pipeline.correlationId,
      status: result.pipeline.status,
      candidateId: result.pipeline.candidateId,
      confidenceScore: result.pipeline.confidenceScore,
      confidenceTier: result.pipeline.confidenceTier,
      stages: result.pipeline.stages.map((s) => ({
        stage: s.stage,
        status: s.status,
        durationMs: s.durationMs,
      })),
    });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
