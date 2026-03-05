/**
 * GET /api/search
 *
 * Service search API. Pure SQL retrieval — no LLM, no ML.
 * Supports radius, bbox, and text queries with filters and pagination.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ServiceSearchEngine } from '@/services/search/engine';
import type { SearchQuery } from '@/services/search/types';
import { SORT_OPTIONS } from '@/services/search/types';
import { cachedSearch } from '@/services/search/cache';
import { executeCount, executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import {
  DEFAULT_SEARCH_RADIUS_METERS,
  DEFAULT_PAGE_SIZE,
  RATE_LIMIT_WINDOW_MS,
  SEARCH_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// QUERY PARAM SCHEMA
// ============================================================

const SearchParamsSchema = z.object({
  q:              z.string().max(500).optional(),
  lat:            z.coerce.number().min(-90).max(90).optional(),
  lng:            z.coerce.number().min(-180).max(180).optional(),
  radius:         z.coerce.number().min(1).max(500_000).default(DEFAULT_SEARCH_RADIUS_METERS),
  minLat:         z.coerce.number().min(-90).max(90).optional(),
  minLng:         z.coerce.number().min(-180).max(180).optional(),
  maxLat:         z.coerce.number().min(-90).max(90).optional(),
  maxLng:         z.coerce.number().min(-180).max(180).optional(),
  status:         z.enum(['active', 'inactive', 'defunct']).default('active'),
  /** Preferred (0-100) */
  minConfidenceScore: z.coerce.number().min(0).max(100).optional(),
  /** Legacy (0-1) */
  minConfidence:  z.coerce.number().min(0).max(1).optional(),
  taxonomyIds:    z.string().optional(),
  organizationId: z.string().uuid().optional(),
  sortBy:         z.enum(SORT_OPTIONS).default('relevance'),
  page:           z.coerce.number().int().min(1).default(1),
  limit:          z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

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
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Search is temporarily unavailable (database not configured).' },
      { status: 503 }
    );
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimit = checkRateLimit(`search:ip:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: SEARCH_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before searching again.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      }
    );
  }

  const { searchParams } = req.nextUrl;

  const rawParams: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    rawParams[key] = value;
  });

  const parsed = SearchParamsSchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query parameters', details: parsed.error.issues },
      { status: 400 }
    );
  }

  const params = parsed.data;

  const minConfidenceScore =
    params.minConfidenceScore ??
    (params.minConfidence !== undefined ? params.minConfidence * 100 : undefined);

  const taxonomyTermIds = params.taxonomyIds
    ? params.taxonomyIds.split(',').filter(Boolean)
    : undefined;

  if (taxonomyTermIds) {
    const invalid = taxonomyTermIds.find((id) => !z.string().uuid().safeParse(id).success);
    if (invalid) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: [{ message: 'taxonomyIds must be UUIDs' }] },
        { status: 400 }
      );
    }
  }

  // Build structured query
  const query: SearchQuery = {
    filters: {
      status: params.status,
      minConfidenceScore,
      organizationId: params.organizationId,
      taxonomyTermIds: taxonomyTermIds as undefined | string[],
    },
    pagination: {
      page: params.page,
      limit: params.limit,
    },
    sortBy: params.sortBy,
  };

  // Determine geo query type
  if (params.lat !== undefined && params.lng !== undefined) {
    query.geo = {
      type: 'radius',
      lat: params.lat,
      lng: params.lng,
      radiusMeters: params.radius,
    };
  } else if (
    params.minLat !== undefined &&
    params.minLng !== undefined &&
    params.maxLat !== undefined &&
    params.maxLng !== undefined
  ) {
    query.geo = {
      type: 'bbox',
      minLat: params.minLat,
      minLng: params.minLng,
      maxLat: params.maxLat,
      maxLng: params.maxLng,
    };
  }

  if (params.q) {
    query.text = params.q;
  }

  try {
    const results = await cachedSearch(engine, query);
    return NextResponse.json(results, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, {
      feature: 'api_search',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
