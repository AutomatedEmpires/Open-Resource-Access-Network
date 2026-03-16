/**
 * ORAN Service Search Engine
 *
 * Pure SQL/retrieval + optional pgvector re-ranking.
 * No LLM. Trust-based ordering. Vector similarity only re-ranks, never replaces.
 */

import { buildVectorSimilarityQuery, reRankWithVectorSimilarity } from './vectorSearch';
import type { VectorSimilarityRow } from './vectorSearch';

import type {
  SearchQuery,
  SearchResult,
  WhereClause,
  BboxQuery,
  RadiusQuery,
  SearchResponse,
  SortBy,
  SearchPreferenceSignals,
} from './types';
import type { SearchFilters } from './types';
import { CONFIDENCE_BANDS } from '@/domain/constants';
import { buildPublishedServicePredicate } from './publication';

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

  if (filters.publishedOnly) {
    conditions.push(buildPublishedServicePredicate('s', 'o'));
  }

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

  // Trust (verification confidence) filter
  if (filters.minConfidenceScore !== undefined) {
    conditions.push(`cs.verification_confidence >= $${idx++}`);
    params.push(filters.minConfidenceScore);
  }

  // Trust band filter
  if (filters.minConfidenceBand) {
    const band = CONFIDENCE_BANDS[filters.minConfidenceBand];
    conditions.push(`cs.verification_confidence >= $${idx++}`);
    params.push(band.min);
  }

  // Organization filter
  if (filters.organizationId) {
    conditions.push(`s.organization_id = $${idx++}`);
    params.push(filters.organizationId);
  }

  // Service attribute filters (e.g. { delivery: ['virtual'], cost: ['free'] })
  if (filters.attributeFilters) {
    for (const [taxonomy, tags] of Object.entries(filters.attributeFilters)) {
      if (!tags || tags.length === 0) continue;
      const placeholders = tags.map(() => `$${idx++}`).join(', ');
      conditions.push(`EXISTS (
        SELECT 1 FROM service_attributes sa
        WHERE sa.service_id = s.id
          AND sa.taxonomy = $${idx++}
          AND sa.tag IN (${placeholders})
      )`);
      // Push tags first, then taxonomy (matching placeholder order)
      params.push(...tags, taxonomy);
    }
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

/**
 * City coordinates for distance-based sorting.
 */
export interface CityCoords {
  lat: number;
  lng: number;
}

/**
 * Builds the ORDER BY clause based on the requested sort option.
 * Defaults to the trust-first relevance sort.
 */
export function buildOrderByClause(sortBy: SortBy | undefined, sortDistanceExpr: string): string {
  switch (sortBy) {
    case 'trust':
      return 'cs.verification_confidence DESC NULLS LAST, profile_match_score DESC, cs.score DESC NULLS LAST';
    case 'distance':
      return `${sortDistanceExpr} ASC NULLS LAST, cs.verification_confidence DESC NULLS LAST, profile_match_score DESC, cs.score DESC NULLS LAST`;
    case 'name_asc':
      return 's.name ASC';
    case 'name_desc':
      return 's.name DESC';
    case 'relevance':
    default:
      return `cs.verification_confidence DESC NULLS LAST, profile_match_score DESC, cs.score DESC NULLS LAST, ${sortDistanceExpr} ASC NULLS LAST`;
  }
}

export function buildProfileBoostExpression(
  signals: SearchPreferenceSignals | undefined,
  paramOffset = 1
): WhereClause {
  if (!signals) {
    return { sql: '0', params: [] };
  }

  const params: unknown[] = [];
  const clauses: string[] = [];
  let idx = paramOffset;

  const weightedSignals: Array<{ taxonomy: string; tags?: string[]; weight: number }> = [
    { taxonomy: 'population', tags: signals.populationTags, weight: 18 },
    { taxonomy: 'situation', tags: signals.situationTags, weight: 14 },
    { taxonomy: 'access', tags: signals.accessTags, weight: 10 },
    { taxonomy: 'delivery', tags: signals.deliveryTags, weight: 8 },
    { taxonomy: 'culture', tags: signals.cultureTags, weight: 8 },
  ];

  for (const signal of weightedSignals) {
    if (!signal.tags || signal.tags.length === 0) {
      continue;
    }

    clauses.push(`CASE WHEN EXISTS (
      SELECT 1 FROM service_attributes sa
      WHERE sa.service_id = s.id
        AND sa.taxonomy = $${idx++}
        AND sa.tag = ANY($${idx++}::text[])
    ) THEN ${signal.weight} ELSE 0 END`);
    params.push(signal.taxonomy, signal.tags);
  }

  return {
    sql: clauses.length > 0 ? clauses.join(' + ') : '0',
    params,
  };
}

export function buildSearchQuery(query: SearchQuery, cityCoords?: CityCoords): BuiltQuery {
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
  let cityBiasDistanceExpr = 'NULL::float';

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
      const bboxCenterLat = (query.geo.minLat + query.geo.maxLat) / 2;
      const bboxCenterLng = (query.geo.minLng + query.geo.maxLng) / 2;
      distanceExpr = `ST_Distance(
        l.geom::geography,
        ST_SetSRID(ST_MakePoint($${paramIdx + geoClause.params.length + 2}, $${paramIdx + geoClause.params.length + 1}), 4326)::geography
      )`;
      params.push(bboxCenterLat, bboxCenterLng);
      paramIdx += 2;
      paramIdx += geoClause.params.length;
    }
  }

  // City bias for sorting (does NOT filter, only affects sort order)
  if (cityCoords && !query.geo) {
    // If there's no explicit geo query, use cityCoords for distance-based sorting
    cityBiasDistanceExpr = `ST_Distance(
      l.geom::geography,
      ST_SetSRID(ST_MakePoint($${paramIdx + 1}, $${paramIdx}), 4326)::geography
    )`;
    params.push(cityCoords.lat, cityCoords.lng);
    paramIdx += 2;
  }

  // Use cityBias distance for sorting if available, otherwise use geo distance
  const sortDistanceExpr = cityCoords && !query.geo ? cityBiasDistanceExpr : distanceExpr;

  // Text search
  if (query.text && query.text.trim()) {
    const textClause = buildTextSearchWhereClause(query.text, paramIdx);
    conditions.push(textClause.sql);
    params.push(...textClause.params);
    paramIdx += textClause.params.length;
  }

  const profileBoostClause = buildProfileBoostExpression(query.profileSignals, paramIdx);
  params.push(...profileBoostClause.params);
  paramIdx += profileBoostClause.params.length;

  const whereStr = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const offset = (query.pagination.page - 1) * query.pagination.limit;

  const sql = `
    SELECT
      s.*,
      o.name AS organization_name,
      o.description AS organization_description,
      o.created_at AS organization_created_at,
      o.updated_at AS organization_updated_at,
      l.id AS location_id,
      l.organization_id AS location_organization_id,
      l.name AS location_name,
      l.latitude, l.longitude,
      l.created_at AS location_created_at,
      l.updated_at AS location_updated_at,
      a.id AS address_id,
      a.location_id AS address_location_id,
      a.address_1, a.address_2, a.city, a.region, a.state_province, a.postal_code, a.country,
      a.created_at AS address_created_at,
      a.updated_at AS address_updated_at,
      cs.id AS confidence_id,
      cs.score AS confidence_score,
      cs.verification_confidence,
      cs.eligibility_match,
      cs.constraint_fit,
      cs.computed_at AS confidence_computed_at,
      ${distanceExpr} AS distance_meters,
      ${sortDistanceExpr} AS sort_distance,
      ${profileBoostClause.sql} AS profile_match_score
    FROM services s
    JOIN organizations o ON o.id = s.organization_id
    LEFT JOIN service_at_location sal ON sal.service_id = s.id
    LEFT JOIN locations l ON l.id = sal.location_id
    LEFT JOIN addresses a ON a.location_id = l.id
    LEFT JOIN confidence_scores cs ON cs.service_id = s.id
    ${whereStr}
    ORDER BY ${buildOrderByClause(query.sortBy, sortDistanceExpr)}
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
 * Executes the canonical structured SQL retrieval path against the ORAN database.
 * The default search flow is deterministic SQL/PostGIS. Supplemental hybrid/vector
 * helpers are exposed separately and must not replace the canonical path.
 */
export class ServiceSearchEngine {
  constructor(private readonly deps: SearchEngineDeps) {}

  /**
   * Look up approximate coordinates for a city by querying the addresses table.
   * Returns null if city is not found.
   */
  async lookupCityCoords(cityName: string): Promise<CityCoords | null> {
    try {
      const result = await this.deps.executeQuery<{ lat: number; lng: number }>(
        `SELECT
           AVG(l.latitude) AS lat,
           AVG(l.longitude) AS lng
         FROM addresses a
         JOIN locations l ON l.id = a.location_id
         WHERE LOWER(a.city) = LOWER($1)
           AND l.latitude IS NOT NULL
           AND l.longitude IS NOT NULL
         GROUP BY LOWER(a.city)
         LIMIT 1`,
        [cityName]
      );
      if (result.length === 0 || result[0].lat == null || result[0].lng == null) {
        return null;
      }
      return { lat: result[0].lat, lng: result[0].lng };
    } catch {
      // Silently ignore lookup failures
      return null;
    }
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    // If cityBias is provided, look up coordinates for distance-based sorting
    let cityCoords: CityCoords | undefined;
    if (query.cityBias && !query.geo) {
      const coords = await this.lookupCityCoords(query.cityBias);
      if (coords) {
        cityCoords = coords;
      }
    }

    const built = buildSearchQuery(query, cityCoords);

    const [rows, total] = await Promise.all([
      this.deps.executeQuery<Record<string, unknown>>(built.sql, built.params),
      this.deps.executeCount(built.countSql, built.countParams),
    ]);

    const results: SearchResult[] = rows.map((row) => this.mapRowToResult(row));

    return {
      results,
      total,
      page: query.pagination.page,
      limit: query.pagination.limit,
      hasMore: total > query.pagination.page * query.pagination.limit,
    };
  }

  /**
   * Search for services by a list of UUIDs.
   * Max 50 IDs per request. Returns services in the order they appear in the DB
   * (not the order of input IDs).
   */
  async searchByIds(ids: string[]): Promise<SearchResult[]> {
    if (ids.length === 0) {
      return [];
    }
    if (ids.length > 50) {
      throw new Error('Maximum 50 IDs allowed per request');
    }

    const sql = `
      SELECT
        s.*,
        o.name AS organization_name,
        o.description AS organization_description,
        o.created_at AS organization_created_at,
        o.updated_at AS organization_updated_at,
        l.id AS location_id,
        l.organization_id AS location_organization_id,
        l.name AS location_name,
        l.latitude, l.longitude,
        l.created_at AS location_created_at,
        l.updated_at AS location_updated_at,
        a.id AS address_id,
        a.location_id AS address_location_id,
        a.address_1, a.address_2, a.city, a.region, a.state_province, a.postal_code, a.country,
        a.created_at AS address_created_at,
        a.updated_at AS address_updated_at,
        cs.id AS confidence_id,
        cs.score AS confidence_score,
        cs.verification_confidence,
        cs.eligibility_match,
        cs.constraint_fit,
        cs.computed_at AS confidence_computed_at,
        NULL::float AS distance_meters
      FROM services s
      JOIN organizations o ON o.id = s.organization_id
      LEFT JOIN service_at_location sal ON sal.service_id = s.id
      LEFT JOIN locations l ON l.id = sal.location_id
      LEFT JOIN addresses a ON a.location_id = l.id
      LEFT JOIN confidence_scores cs ON cs.service_id = s.id
      WHERE s.id = ANY($1::uuid[])
      AND ${buildPublishedServicePredicate('s', 'o')}
      ORDER BY cs.verification_confidence DESC NULLS LAST
    `;

    const rows = await this.deps.executeQuery<Record<string, unknown>>(sql, [ids]);
    return rows.map((row) => this.mapRowToResult(row));
  }

  /**
   * Maps a database row to a SearchResult.
   * Shared between search() and searchByIds().
   */
  private mapRowToResult(row: Record<string, unknown>): SearchResult {
    return {
      service: {
        service: {
          id: row.id as string,
          organizationId: row.organization_id as string,
          programId: (row.program_id as string | null) ?? null,
          name: row.name as string,
          description: row.description as string | null,
          url: (row.url as string | null) ?? null,
          email: (row.email as string | null) ?? null,
          status: (row.status ?? 'active') as 'active' | 'inactive' | 'defunct',
          interpretationServices: (row.interpretation_services as string | null) ?? null,
          applicationProcess: (row.application_process as string | null) ?? null,
          waitTime: (row.wait_time as string | null) ?? null,
          fees: (row.fees as string | null) ?? null,
          accreditations: (row.accreditations as string | null) ?? null,
          licenses: (row.licenses as string | null) ?? null,
          updatedAt: row.updated_at as Date,
          createdAt: row.created_at as Date,
        },
        organization: {
          id: row.organization_id as string,
          name: (row.organization_name ?? '') as string,
          description: (row.organization_description as string | null) ?? null,
          status: (row.organization_status ?? 'active') as 'active' | 'inactive' | 'defunct',
          updatedAt: row.organization_updated_at as Date,
          createdAt: row.organization_created_at as Date,
        },
        location: row.location_id
          ? {
              id: row.location_id as string,
              organizationId: row.location_organization_id as string,
              name: (row.location_name as string | null) ?? null,
              latitude: (row.latitude as number | null) ?? null,
              longitude: (row.longitude as number | null) ?? null,
              status: (row.location_status ?? 'active') as 'active' | 'inactive' | 'defunct',
              createdAt: row.location_created_at as Date,
              updatedAt: row.location_updated_at as Date,
            }
          : null,
        address: row.address_id
          ? {
              id: row.address_id as string,
              locationId: row.address_location_id as string,
              address1: (row.address_1 as string | null) ?? null,
              address2: (row.address_2 as string | null) ?? null,
              city: (row.city as string | null) ?? null,
              region: (row.region as string | null) ?? null,
              stateProvince: (row.state_province as string | null) ?? null,
              postalCode: (row.postal_code as string | null) ?? null,
              country: (row.country as string | null) ?? null,
              createdAt: row.address_created_at as Date,
              updatedAt: row.address_updated_at as Date,
            }
          : null,
        phones: [],
        schedules: [],
        taxonomyTerms: [],
        confidenceScore: row.confidence_score != null
          ? {
              id: (row.confidence_id as string) ?? '',
              serviceId: row.id as string,
              score: row.confidence_score as number,
              verificationConfidence: (row.verification_confidence as number) ?? 0,
              eligibilityMatch: (row.eligibility_match as number) ?? 0,
              constraintFit: (row.constraint_fit as number) ?? 0,
              computedAt: (row.confidence_computed_at as Date) ?? new Date(),
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null,
      },
      distanceMeters: row.distance_meters != null ? (row.distance_meters as number) : undefined,
    };
  }

  /**
   * Hybrid search: runs the standard SQL query then re-ranks with pgvector cosine
   * similarity when a query embedding is provided.
   *
   * Non-negotiable: vector similarity never introduces new results.
   * It only re-orders records already returned by the SQL layer.
   * Services without embeddings keep their original SQL position (vectorSim=0).
   *
   * When queryEmbedding is null (Foundry unconfigured, flag off, or embed failed),
   * falls back transparently to the standard SQL search order.
   *
   * @param query          Standard SearchQuery
   * @param queryEmbedding 1024-dim float[] from embedForQuery(), or null for fallback
   * @param vectorAlpha    Weight of SQL confidence in hybrid score (default 0.6)
   */
  async hybridSearch(
    query: SearchQuery,
    queryEmbedding: number[] | null,
    vectorAlpha = 0.6
  ): Promise<SearchResponse> {
    const sqlResponse = await this.search(query);

    if (!queryEmbedding || sqlResponse.results.length === 0) {
      return sqlResponse;
    }

    // Collect IDs from SQL results to scope the vector query
    const candidateIds = sqlResponse.results.map((r) => r.service.service.id);

    const vectorQuery = buildVectorSimilarityQuery(queryEmbedding, candidateIds, candidateIds.length);
    const vectorRows = await this.deps.executeQuery<VectorSimilarityRow>(
      vectorQuery.sql,
      vectorQuery.params
    );

    const similarityMap = new Map(vectorRows.map((r) => [r.id, r.similarity]));

    // Attach id + confidenceScore at top level for the generic re-ranker
    const withIds = sqlResponse.results.map((r) => ({
      ...r,
      id: r.service.service.id,
      confidenceScore: r.service.confidenceScore?.score ?? null,
    }));

    const reranked = reRankWithVectorSimilarity(withIds, similarityMap, vectorAlpha);

    // Strip the ephemeral fields added above before returning to callers.
    const stripHelpers = ({ id: _id, confidenceScore: _score, ...rest }: typeof withIds[number]) =>
      rest as SearchResult;

    return {
      ...sqlResponse,
      results: reranked.map(stripHelpers),
    };
  }
}
