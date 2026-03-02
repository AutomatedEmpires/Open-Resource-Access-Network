/**
 * GET /api/services
 *
 * Batch fetch services by IDs. Returns services matching the provided IDs.
 * Max 50 IDs per request. Public endpoint (no auth required).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ServiceSearchEngine } from '@/services/search/engine';
import { executeCount, executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// CONSTANTS
// ============================================================

const SERVICES_RATE_LIMIT_MAX = 30;
const MAX_IDS = 50;

// ============================================================
// QUERY PARAM SCHEMA
// ============================================================

const IdsParamSchema = z
  .string()
  .min(1, 'ids parameter is required')
  .transform((val) => val.split(',').filter(Boolean))
  .pipe(
    z
      .array(z.string().uuid('Each ID must be a valid UUID'))
      .min(1, 'At least one ID is required')
      .max(MAX_IDS, `Maximum ${MAX_IDS} IDs allowed per request`)
  );

// ============================================================
// DB EXECUTOR
// ============================================================

const engine = new ServiceSearchEngine({
  executeQuery,
  executeCount,
});

// ============================================================
// HANDLER
// ============================================================

export async function GET(req: NextRequest) {
  // Check database configuration
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Service lookup is temporarily unavailable (database not configured).' },
      { status: 503 }
    );
  }

  // Rate limiting
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = checkRateLimit(`services:ip:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: SERVICES_RATE_LIMIT_MAX,
  });
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before making more requests.' },
      { status: 429 }
    );
  }

  // Parse and validate ids parameter
  const { searchParams } = req.nextUrl;
  const idsParam = searchParams.get('ids');

  if (!idsParam) {
    return NextResponse.json(
      { error: 'ids parameter is required' },
      { status: 400 }
    );
  }

  const parsed = IdsParamSchema.safeParse(idsParam);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const ids = parsed.data;

  try {
    const results = await engine.searchByIds(ids);
    return NextResponse.json(
      { results: results.map((r) => r.service) },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    await captureException(error, {
      feature: 'api_services',
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
