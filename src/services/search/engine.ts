/**
 * ORAN Service Search Engine
 *
 * IMPORTANT: Pure SQL/retrieval only. No LLM. No vector similarity. No ML ranking.
 * Results are ordered by confidence_score DESC, distance ASC (for geo queries).
 */

import type {
  SearchQuery,
  SearchResult,
  WhereClause,
  BboxQuery,
  RadiusQuery,
  SearchResponse,
} from './types';
import type { SearchFilters } from './types';
import { CONFIDENCE_BANDS } from '@/domain/constants';

// ============================================================
// WHERE CLAUSE BUILDERS
// ============================================================

/**
 * Builds a PostGIS radius filter SQL fragment.
 * Uses ST_DWithin for efficient GiST index utilization.
 */
export function buildRadiusWhereClause(query: RadiusQuery, paramOffset = 1): WhereClause {
  return {
    sql: `ST_DWithin(
      l.geom::geography,
      ST_SetSRID(ST_MakePoint($${paramOffset + 1}, $${paramOffset}), 4326)::geography,
      $${paramOffset + 2}
    )`,
    params: [query.lat, query.lng, query.radiusMeters],
  };
}

/**
 * Builds a PostGIS bounding box filter SQL fragment.
 * Uses ST_MakeEnvelope for map viewport queries.
 */
export function buildBboxWhereClause(query: BboxQuery, paramOffset = 1): WhereClause {
  return {
    sql: `l.geom && ST_MakeEnvelope($${paramOffset}, $${paramOffset + 1}, $${paramOffset + 2}, $${paramOffset + 3}, 4326)`,
    params: [query.minLng, query.minLat, query.maxLng, query.maxLat],
  };
}

/**
 * Builds filter conditions from SearchFilters.
 * Returns SQL fragment and params array.
 */
export function buildFiltersWhereClause(
  filters: SearchFilters,
  paramOffset = 1
): WhereClause {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = paramOffset;

  // Status filter
  conditions.push(`s.status = $${idx++}`);
  params.push(filters.status);

  // Taxonomy filter (service must have at least one matching term)
  if (filters.taxonomyTermIds && filters.taxonomyTermIds.length > 0) {
    const placeholders = filters.taxonomyTermIds.map(() => `$${idx++}`).join(', ');
    conditions.push(`EXISTS (
      SELECT 1 FROM service_taxonomy st
      WHERE st.service_id = s.id
      AND st.taxonomy_term_id IN (${placeholders})
    )`);
    params.push(...filters.taxonomyTermIds);
  }

  // Confidence score filter
  if (filters.minConfidenceScore !== undefined) {
    conditions.push(`cs.score >= $${idx++}`);
    params.push(filters.minConfidenceScore);
  }

  // Confidence band filter
  if (filters.minConfidenceBand) {
    const band = CONFIDENCE_BANDS[filters.minConfidenceBand];
    conditions.push(`cs.score >= $${idx++}`);
    params.push(band.min);
  }

  // Organization filter
  if (filters.organizationId) {
    conditions.push(`s.organization_id = $${idx++}`);
    params.push(filters.organizationId);
  }

  return {
    sql: conditions.join(' AND '),
    params,
  };
}

/**
 * Builds full-text search WHERE clause.
 */
export function buildTextSearchWhereClause(q: string, paramOffset = 1): WhereClause {
  return {
    sql: `(
      to_tsvector('english', s.name || ' ' || coalesce(s.description, ''))
      @@ plainto_tsquery('english', $${paramOffset})
    )`,
    params: [q],
  };
}

// ============================================================
// FULL QUERY BUILDER
// ============================================================

export interface BuiltQuery {
  sql: string;
  params: unknown[];
  countSql: string;
  countParams: unknown[];
}

export function buildSearchQuery(query: SearchQuery): BuiltQuery {
  const conditions: string[] = [];
  const params: unknown[] = [];

  let paramIdx = 1;

  // Base filters always applied
  const filterClause = buildFiltersWhereClause(query.filters, paramIdx);
  if (filterClause.sql) {
    conditions.push(filterClause.sql);
    params.push(...filterClause.params);
    paramIdx += filterClause.params.length;
  }

  // Geo filter
  let distanceExpr = 'NULL::float';
  if (query.geo) {
    if (query.geo.type === 'radius') {
      const geoClause = buildRadiusWhereClause(query.geo, paramIdx);
      conditions.push(geoClause.sql);
      params.push(...geoClause.params);
      distanceExpr = `ST_Distance(
        l.geom::geography,
        ST_SetSRID(ST_MakePoint($${paramIdx + 1}, $${paramIdx}), 4326)::geography
      )`;
      paramIdx += geoClause.params.length;
    } else if (query.geo.type === 'bbox') {
      const geoClause = buildBboxWhereClause(query.geo, paramIdx);
      conditions.push(geoClause.sql);
      params.push(...geoClause.params);
      paramIdx += geoClause.params.length;
    }
  }

  // Text search
  if (query.text && query.text.trim()) {
    const textClause = buildTextSearchWhereClause(query.text, paramIdx);
    conditions.push(textClause.sql);
    params.push(...textClause.params);
    paramIdx += textClause.params.length;
  }

  const whereStr = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const offset = (query.pagination.page - 1) * query.pagination.limit;

  const sql = `
    SELECT
      s.*,
      o.name AS organization_name,
      o.description AS organization_description,
      l.latitude, l.longitude,
      a.address_1, a.city, a.state_province, a.postal_code,
      cs.score AS confidence_score,
      ${distanceExpr} AS distance_meters
    FROM services s
    JOIN organizations o ON o.id = s.organization_id
    LEFT JOIN service_at_location sal ON sal.service_id = s.id
    LEFT JOIN locations l ON l.id = sal.location_id
    LEFT JOIN addresses a ON a.location_id = l.id
    LEFT JOIN confidence_scores cs ON cs.service_id = s.id
    ${whereStr}
    ORDER BY cs.score DESC NULLS LAST, distance_meters ASC NULLS LAST
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
  `;

  const countSql = `
    SELECT COUNT(DISTINCT s.id)
    FROM services s
    JOIN organizations o ON o.id = s.organization_id
    LEFT JOIN service_at_location sal ON sal.service_id = s.id
    LEFT JOIN locations l ON l.id = sal.location_id
    LEFT JOIN addresses a ON a.location_id = l.id
    LEFT JOIN confidence_scores cs ON cs.service_id = s.id
    ${whereStr}
  `;

  return {
    sql,
    params: [...params, query.pagination.limit, offset],
    countSql,
    countParams: params,
  };
}

// ============================================================
// SEARCH ENGINE CLASS
// ============================================================

export interface SearchEngineDeps {
  /** Execute a parameterized SQL query — must NOT be an LLM call */
  executeQuery: <T>(sql: string, params: unknown[]) => Promise<T[]>;
  executeCount: (sql: string, params: unknown[]) => Promise<number>;
}

/**
 * ServiceSearchEngine
 *
 * Executes structured SQL queries against the ORAN database.
 * No LLM, no ML, no vector similarity — pure relational retrieval.
 */
export class ServiceSearchEngine {
  constructor(private readonly deps: SearchEngineDeps) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    const built = buildSearchQuery(query);

    const [rows, total] = await Promise.all([
      this.deps.executeQuery<Record<string, unknown>>(built.sql, built.params),
      this.deps.executeCount(built.countSql, built.countParams),
    ]);

    const results: SearchResult[] = rows.map((row) => ({
      service: {
        service: {
          id: row.id as string,
          organizationId: row.organization_id as string,
          name: row.name as string,
          description: row.description as string | null,
          status: (row.status ?? 'active') as 'active' | 'inactive' | 'defunct',
          updatedAt: row.updated_at as Date,
          createdAt: row.created_at as Date,
        },
        organization: {
          id: row.organization_id as string,
          name: (row.organization_name ?? '') as string,
          updatedAt: row.updated_at as Date,
          createdAt: row.created_at as Date,
        },
        phones: [],
        schedules: [],
        taxonomyTerms: [],
        confidenceScore: row.confidence_score != null
          ? {
              id: '',
              serviceId: row.id as string,
              score: row.confidence_score as number,
              dataCompleteness: 0,
              verificationRecency: 0,
              communityFeedback: 0,
              hostResponsiveness: 0,
              sourceAuthority: 0,
              computedAt: new Date(),
            }
          : null,
      },
      distanceMeters: row.distance_meters != null ? (row.distance_meters as number) : undefined,
    }));

    return {
      results,
      total,
      page: query.pagination.page,
      limit: query.pagination.limit,
      hasMore: total > query.pagination.page * query.pagination.limit,
    };
  }
}
