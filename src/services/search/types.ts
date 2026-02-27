/**
 * Search Service Types
 */

import { z } from 'zod';
import type { EnrichedService } from '@/domain/types';
import { DEFAULT_SEARCH_RADIUS_METERS, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@/domain/constants';

// ============================================================
// SEARCH QUERY TYPES
// ============================================================

export const PaginationParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationParams = z.infer<typeof PaginationParamsSchema>;

export const SearchFiltersSchema = z.object({
  status: z.enum(['active', 'inactive', 'defunct']).default('active'),
  taxonomyTermIds: z.array(z.string().uuid()).optional(),
  minConfidenceScore: z.coerce.number().min(0).max(1).optional(),
  /** Only return records with a confidence band at or above this level */
  minConfidenceBand: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNVERIFIED']).optional(),
  organizationId: z.string().uuid().optional(),
});

export type SearchFilters = z.infer<typeof SearchFiltersSchema>;

export const RadiusQuerySchema = z.object({
  type: z.literal('radius'),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().min(1).max(500_000).default(DEFAULT_SEARCH_RADIUS_METERS),
});

export type RadiusQuery = z.infer<typeof RadiusQuerySchema>;

export const BboxQuerySchema = z.object({
  type: z.literal('bbox'),
  minLat: z.coerce.number().min(-90).max(90),
  minLng: z.coerce.number().min(-180).max(180),
  maxLat: z.coerce.number().min(-90).max(90),
  maxLng: z.coerce.number().min(-180).max(180),
});

export type BboxQuery = z.infer<typeof BboxQuerySchema>;

export const TextQuerySchema = z.object({
  type: z.literal('text'),
  q: z.string().max(500),
});

export type TextQuery = z.infer<typeof TextQuerySchema>;

export const SearchQuerySchema = z.intersection(
  z.union([RadiusQuerySchema, BboxQuerySchema, TextQuerySchema]).and(
    z.object({
      type: z.enum(['radius', 'bbox', 'text']),
    })
  ),
  PaginationParamsSchema.merge(SearchFiltersSchema)
);

export type SearchQuery = {
  geo?: RadiusQuery | BboxQuery;
  text?: string;
  filters: SearchFilters;
  pagination: PaginationParams;
};

// ============================================================
// SEARCH RESULT TYPES
// ============================================================

export interface SearchResult {
  service: EnrichedService;
  /** Distance in meters from query point (only present for radius queries) */
  distanceMeters?: number;
  /** Full-text search relevance score (only present for text queries) */
  textScore?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// ============================================================
// SQL FRAGMENT TYPES (for query builder)
// ============================================================

export interface WhereClause {
  sql: string;
  params: unknown[];
}

export interface OrderByClause {
  sql: string;
}
