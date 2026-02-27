/**
 * Search Query Builder Tests
 *
 * Tests for the search engine's query building functions.
 * All tests are self-contained — no DB connection required.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRadiusWhereClause,
  buildBboxWhereClause,
  buildFiltersWhereClause,
  buildTextSearchWhereClause,
  buildSearchQuery,
  ServiceSearchEngine,
} from '../engine';
import type { SearchQuery } from '../types';

// ============================================================
// buildRadiusWhereClause
// ============================================================

describe('buildRadiusWhereClause', () => {
  it('generates ST_DWithin SQL fragment', () => {
    const clause = buildRadiusWhereClause({
      type: 'radius',
      lat: 40.7128,
      lng: -74.006,
      radiusMeters: 10000,
    });

    expect(clause.sql).toContain('ST_DWithin');
    expect(clause.sql).toContain('ST_SetSRID');
    expect(clause.sql).toContain('ST_MakePoint');
    expect(clause.params).toHaveLength(3);
    expect(clause.params[0]).toBe(40.7128);  // lat
    expect(clause.params[1]).toBe(-74.006);  // lng
    expect(clause.params[2]).toBe(10000);    // radius
  });

  it('uses correct parameter offsets', () => {
    const clause = buildRadiusWhereClause(
      { type: 'radius', lat: 1, lng: 2, radiusMeters: 500 },
      5
    );
    expect(clause.sql).toContain('$5');
    expect(clause.sql).toContain('$6');
    expect(clause.sql).toContain('$7');
  });
});

// ============================================================
// buildBboxWhereClause
// ============================================================

describe('buildBboxWhereClause', () => {
  it('generates ST_MakeEnvelope SQL fragment', () => {
    const clause = buildBboxWhereClause({
      type: 'bbox',
      minLat: 40.0,
      minLng: -75.0,
      maxLat: 41.0,
      maxLng: -73.0,
    });

    expect(clause.sql).toContain('ST_MakeEnvelope');
    expect(clause.params).toHaveLength(4);
    // MakeEnvelope order: minLng, minLat, maxLng, maxLat
    expect(clause.params[0]).toBe(-75.0);  // minLng
    expect(clause.params[1]).toBe(40.0);   // minLat
    expect(clause.params[2]).toBe(-73.0);  // maxLng
    expect(clause.params[3]).toBe(41.0);   // maxLat
  });

  it('uses correct parameter offsets', () => {
    const clause = buildBboxWhereClause(
      { type: 'bbox', minLat: 0, minLng: 0, maxLat: 1, maxLng: 1 },
      3
    );
    expect(clause.sql).toContain('$3');
    expect(clause.sql).toContain('$6');
  });
});

// ============================================================
// buildFiltersWhereClause
// ============================================================

describe('buildFiltersWhereClause', () => {
  it('always includes status filter', () => {
    const clause = buildFiltersWhereClause({ status: 'active' });
    expect(clause.sql).toContain('s.status');
    expect(clause.params).toContain('active');
  });

  it('includes taxonomy filter when taxonomyTermIds provided', () => {
    const clause = buildFiltersWhereClause({
      status: 'active',
      taxonomyTermIds: ['uuid-1', 'uuid-2'],
    });
    expect(clause.sql).toContain('service_taxonomy');
    expect(clause.params).toContain('uuid-1');
    expect(clause.params).toContain('uuid-2');
  });

  it('includes confidence score filter when minConfidenceScore provided', () => {
    const clause = buildFiltersWhereClause({
      status: 'active',
      minConfidenceScore: 0.5,
    });
    expect(clause.sql).toContain('cs.score');
    expect(clause.params).toContain(0.5);
  });

  it('includes organization filter when organizationId provided', () => {
    const orgId = '12345678-1234-1234-1234-123456789012';
    const clause = buildFiltersWhereClause({
      status: 'active',
      organizationId: orgId,
    });
    expect(clause.sql).toContain('s.organization_id');
    expect(clause.params).toContain(orgId);
  });

  it('does not include taxonomy filter when no IDs provided', () => {
    const clause = buildFiltersWhereClause({ status: 'active' });
    expect(clause.sql).not.toContain('service_taxonomy');
  });
});

// ============================================================
// buildTextSearchWhereClause
// ============================================================

describe('buildTextSearchWhereClause', () => {
  it('generates full-text search SQL with to_tsvector and plainto_tsquery', () => {
    const clause = buildTextSearchWhereClause('food bank', 1);
    expect(clause.sql).toContain('to_tsvector');
    expect(clause.sql).toContain('plainto_tsquery');
    expect(clause.params).toContain('food bank');
  });
});

// ============================================================
// buildSearchQuery
// ============================================================

describe('buildSearchQuery', () => {
  const baseQuery: SearchQuery = {
    filters: { status: 'active' },
    pagination: { page: 1, limit: 20 },
  };

  it('generates valid SQL for text-only query', () => {
    const built = buildSearchQuery({ ...baseQuery, text: 'food assistance' });
    expect(built.sql).toBeTruthy();
    expect(built.sql).toContain('SELECT');
    expect(built.sql).toContain('FROM services');
    expect(built.params.length).toBeGreaterThan(0);
  });

  it('generates valid SQL for radius query', () => {
    const built = buildSearchQuery({
      ...baseQuery,
      geo: { type: 'radius', lat: 40.7, lng: -74.0, radiusMeters: 5000 },
    });
    expect(built.sql).toContain('ST_DWithin');
  });

  it('generates valid SQL for bbox query', () => {
    const built = buildSearchQuery({
      ...baseQuery,
      geo: { type: 'bbox', minLat: 40.0, minLng: -75.0, maxLat: 41.0, maxLng: -73.0 },
    });
    expect(built.sql).toContain('ST_MakeEnvelope');
  });

  it('includes LIMIT and OFFSET for pagination', () => {
    const built = buildSearchQuery({ ...baseQuery, pagination: { page: 3, limit: 10 } });
    // Offset = (3-1)*10 = 20
    expect(built.params).toContain(10);  // limit
    expect(built.params).toContain(20);  // offset
  });

  it('pagination page 1 has offset 0', () => {
    const built = buildSearchQuery({ ...baseQuery, pagination: { page: 1, limit: 20 } });
    expect(built.params).toContain(0);  // offset = (1-1)*20 = 0
  });

  it('generates count query', () => {
    const built = buildSearchQuery(baseQuery);
    expect(built.countSql).toContain('COUNT');
    expect(built.countSql).toContain('FROM services');
  });

  it('empty query returns all results (paginated)', () => {
    const built = buildSearchQuery(baseQuery);
    // Should still have LIMIT and OFFSET
    expect(built.params).toContain(20);  // limit
    expect(built.params).toContain(0);   // offset
  });
});

// ============================================================
// ServiceSearchEngine
// ============================================================

describe('ServiceSearchEngine', () => {
  it('calls executeQuery and executeCount', async () => {
    let queryCalled = false;
    let countCalled = false;

    const engine = new ServiceSearchEngine({
      executeQuery: async () => {
        queryCalled = true;
        return [];
      },
      executeCount: async () => {
        countCalled = true;
        return 0;
      },
    });

    const result = await engine.search({
      filters: { status: 'active' },
      pagination: { page: 1, limit: 20 },
    });

    expect(queryCalled).toBe(true);
    expect(countCalled).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('sets hasMore correctly when total > page * limit', async () => {
    const engine = new ServiceSearchEngine({
      executeQuery: async () => [],
      executeCount: async () => 100,
    });

    const result = await engine.search({
      filters: { status: 'active' },
      pagination: { page: 1, limit: 20 },
    });

    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(100);
  });

  it('returns correct page and limit in response', async () => {
    const engine = new ServiceSearchEngine({
      executeQuery: async () => [],
      executeCount: async () => 0,
    });

    const result = await engine.search({
      filters: { status: 'active' },
      pagination: { page: 2, limit: 10 },
    });

    expect(result.page).toBe(2);
    expect(result.limit).toBe(10);
  });
});
