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
import { getSearchPreset, mergePresetFilters } from '@/services/search/presets';
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
  /**
   * Attribute filters as JSON: {"delivery":["virtual"],"cost":["free"]}.
   * Each key is a taxonomy dimension, values are tags within it.
   * Services must match at least one tag per specified dimension.
   */
  attributes:     z.string().max(2000).optional(),
  /** Composite search preset ID (e.g., 'low_cost_dental'). Merges preset
   *  text + attribute filters; user params take precedence. */
  preset:         z.string().max(50).optional(),
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

  // Parse attribute filters (JSON string → Record<string, string[]>)
  let attributeFilters: Record<string, string[]> | undefined;
  if (params.attributes) {
    try {
      const parsed = JSON.parse(params.attributes);
      // Validate: must be a plain object with string[] values, bounded key/value lengths
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        Object.entries(parsed).every(
          ([k, v]) =>
            typeof k === 'string' &&
            k.length <= 50 &&
            Array.isArray(v) &&
            v.length > 0 &&
            v.every((t: unknown) => typeof t === 'string' && (t as string).length <= 100),
        )
      ) {
        attributeFilters = parsed as Record<string, string[]>;
      } else {
        return NextResponse.json(
          { error: 'Invalid query parameters', details: [{ message: 'attributes must be a JSON object mapping taxonomy names to tag arrays' }] },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: [{ message: 'attributes must be valid JSON' }] },
        { status: 400 },
      );
    }
  }

  // Apply composite search preset (merges text + attribute filters)
  let presetText: string | undefined;
  if (params.preset) {
    const preset = getSearchPreset(params.preset);
    if (!preset) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: [{ message: `Unknown preset: ${params.preset}` }] },
        { status: 400 },
      );
    }
    // Preset text is used only if user didn't supply their own query
    if (!params.q && preset.text) {
      presetText = preset.text;
    }
    // Merge preset attribute filters; user-selected filters take precedence
    attributeFilters = mergePresetFilters(preset, attributeFilters);
  }

  // Build structured query
  const query: SearchQuery = {
    filters: {
      status: params.status,
      minConfidenceScore,
      organizationId: params.organizationId,
      taxonomyTermIds: taxonomyTermIds as undefined | string[],
      attributeFilters,
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
  } else if (presetText) {
    query.text = presetText;
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
