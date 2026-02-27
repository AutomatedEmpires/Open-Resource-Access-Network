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
import { DEFAULT_SEARCH_RADIUS_METERS, DEFAULT_PAGE_SIZE } from '@/domain/constants';

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
  minConfidence:  z.coerce.number().min(0).max(1).optional(),
  taxonomyIds:    z.string().optional(),
  organizationId: z.string().uuid().optional(),
  page:           z.coerce.number().int().min(1).default(1),
  limit:          z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

// ============================================================
// MOCK DB EXECUTOR (replace with real Neon/pg connection in production)
// ============================================================

const mockEngine = new ServiceSearchEngine({
  executeQuery: async () => [],
  executeCount: async () => 0,
});

// ============================================================
// HANDLER
// ============================================================

export async function GET(req: NextRequest) {
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

  // Build structured query
  const query: SearchQuery = {
    filters: {
      status: params.status,
      minConfidenceScore: params.minConfidence,
      organizationId: params.organizationId,
      taxonomyTermIds: params.taxonomyIds
        ? params.taxonomyIds.split(',').filter(Boolean)
        : undefined,
    },
    pagination: {
      page: params.page,
      limit: params.limit,
    },
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
    const results = await mockEngine.search(query);
    return NextResponse.json(results);
  } catch (error) {
    console.error('[/api/search] Search error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
