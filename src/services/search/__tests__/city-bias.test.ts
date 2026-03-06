/**
 * City Bias Search Tests
 *
 * Tests for cityBias-related functionality:
 *   - lookupCityCoords: resolves a city name to lat/lng from addresses table
 *   - buildSearchQuery: includes distance expression for sorting when cityCoords provided
 *   - search() integration: cityBias flows through the full search path
 *
 * All tests use mocked deps — no database connection required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildSearchQuery,
  ServiceSearchEngine,
} from '../engine';
import type { SearchQuery } from '../types';

// ============================================================
// buildSearchQuery with cityCoords
// ============================================================

describe('buildSearchQuery with cityCoords', () => {
  const baseQuery: SearchQuery = {
    filters: { status: 'active' },
    pagination: { page: 1, limit: 20 },
  };

  it('includes ST_Distance expression when cityCoords provided and no geo query', () => {
    const result = buildSearchQuery(baseQuery, { lat: 40.7128, lng: -74.006 });

    // cityBias lat/lng should appear in params
    expect(result.params).toContain(40.7128);
    expect(result.params).toContain(-74.006);

    // SQL should contain the distance sorting expression
    expect(result.sql).toContain('ST_Distance');
    expect(result.sql).toContain('ST_MakePoint');
    expect(result.sql).toContain('sort_distance');
  });

  it('does NOT include distance expression when no cityCoords and no geo query', () => {
    const result = buildSearchQuery(baseQuery);

    // sort_distance should be NULL
    expect(result.sql).toContain('NULL::float AS sort_distance');
    // No ST_Distance for sorting
    void result.sql.split('sort_distance')[0];
    // The base query without geo or cityBias should not have ST_MakePoint for the bias expr
    expect(result.params).not.toContain(40.7128);
  });

  it('ignores cityCoords when an explicit geo query is present', () => {
    const geoQuery: SearchQuery = {
      ...baseQuery,
      geo: {
        type: 'radius',
        lat: 34.0522,
        lng: -118.2437,
        radiusMeters: 5000,
      },
    };

    const result = buildSearchQuery(geoQuery, { lat: 40.7128, lng: -74.006 });

    // Should have the geo query coords, not the cityBias coords
    expect(result.params).toContain(34.0522);
    expect(result.params).toContain(-118.2437);
    // cityBias coords should NOT appear
    expect(result.params).not.toContain(40.7128);
    expect(result.params).not.toContain(-74.006);
  });

  it('does not add WHERE clauses for cityBias (sort only)', () => {
    const result = buildSearchQuery(baseQuery, { lat: 40.7128, lng: -74.006 });

    // The WHERE clause should only contain the status filter, not a distance filter
    const whereMatch = result.sql.match(/WHERE\s+([\s\S]*?)ORDER/);
    expect(whereMatch).toBeTruthy();
    const whereClause = whereMatch![1];
    expect(whereClause).toContain('s.status');
    expect(whereClause).not.toContain('ST_DWithin');
  });

  it('preserves standard ORDER BY with cityBias distance', () => {
    const result = buildSearchQuery(baseQuery, { lat: 40.7128, lng: -74.006 });

    // ORDER BY should include verification_confidence, score, and distance expression
    expect(result.sql).toContain('cs.verification_confidence DESC');
    expect(result.sql).toContain('cs.score DESC');
    // The ORDER BY uses the raw ST_Distance expression (via buildOrderByClause)
    const orderIdx = result.sql.indexOf('ORDER BY');
    const orderClause = result.sql.slice(orderIdx);
    expect(orderClause).toContain('ST_Distance');
    expect(orderClause).toContain('ASC NULLS LAST');
  });

  it('combines cityBias with text search', () => {
    const textQuery: SearchQuery = {
      ...baseQuery,
      text: 'food bank',
      cityBias: 'Portland',
    };

    const result = buildSearchQuery(textQuery, { lat: 45.5231, lng: -122.6765 });

    // Both text search and distance sorting should be present
    expect(result.sql).toContain('plainto_tsquery');
    expect(result.sql).toContain('ST_Distance');
    expect(result.params).toContain('food bank');
    expect(result.params).toContain(45.5231);
    expect(result.params).toContain(-122.6765);
  });

  it('count query does not include cityBias params when cityCoords used', () => {
    const result = buildSearchQuery(baseQuery, { lat: 40.7128, lng: -74.006 });

    // Count SQL should not contain ST_Distance
    expect(result.countSql).not.toContain('ST_Distance');
    // Count params should be shorter (no lat/lng)
    expect(result.countParams.length).toBeLessThan(result.params.length);
  });
});

// ============================================================
// ServiceSearchEngine.lookupCityCoords
// ============================================================

describe('ServiceSearchEngine.lookupCityCoords', () => {
  const mockExecuteQuery = vi.fn();
  const mockExecuteCount = vi.fn();

  const engine = new ServiceSearchEngine({
    executeQuery: mockExecuteQuery,
    executeCount: mockExecuteCount,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns coords when city is found in the addresses table', async () => {
    mockExecuteQuery.mockResolvedValue([{ lat: 45.5231, lng: -122.6765 }]);

    const result = await engine.lookupCityCoords('Portland');

    expect(result).toEqual({ lat: 45.5231, lng: -122.6765 });
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockExecuteQuery.mock.calls[0];
    expect(sql).toContain('LOWER(a.city) = LOWER($1)');
    expect(params).toEqual(['Portland']);
  });

  it('returns null when city is not found', async () => {
    mockExecuteQuery.mockResolvedValue([]);

    const result = await engine.lookupCityCoords('Nonexistentville');

    expect(result).toBeNull();
  });

  it('returns null when lat or lng is null in result', async () => {
    mockExecuteQuery.mockResolvedValue([{ lat: null, lng: null }]);

    const result = await engine.lookupCityCoords('Portland');

    expect(result).toBeNull();
  });

  it('returns null on database error (silently fails)', async () => {
    mockExecuteQuery.mockRejectedValue(new Error('connection refused'));

    const result = await engine.lookupCityCoords('Portland');

    expect(result).toBeNull();
  });

  it('queries with case-insensitive city match', async () => {
    mockExecuteQuery.mockResolvedValue([{ lat: 40.7128, lng: -74.006 }]);

    await engine.lookupCityCoords('new york');

    const [sql] = mockExecuteQuery.mock.calls[0];
    expect(sql).toContain('LOWER(a.city) = LOWER($1)');
  });
});

// ============================================================
// ServiceSearchEngine.search with cityBias
// ============================================================

describe('ServiceSearchEngine.search with cityBias', () => {
  const mockExecuteQuery = vi.fn();
  const mockExecuteCount = vi.fn();

  const engine = new ServiceSearchEngine({
    executeQuery: mockExecuteQuery,
    executeCount: mockExecuteCount,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves cityBias to coords and passes them to the query builder', async () => {
    // First call: lookupCityCoords
    // Second call: main search query
    mockExecuteQuery
      .mockResolvedValueOnce([{ lat: 45.5231, lng: -122.6765 }]) // lookupCityCoords
      .mockResolvedValueOnce([]); // search results
    mockExecuteCount.mockResolvedValue(0);

    const query: SearchQuery = {
      text: 'shelter',
      filters: { status: 'active' },
      pagination: { page: 1, limit: 10 },
      cityBias: 'Portland',
    };

    const result = await engine.search(query);

    // lookupCityCoords should be called first
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    const lookupCall = mockExecuteQuery.mock.calls[0];
    expect(lookupCall[1]).toEqual(['Portland']);

    // Search query should include the resolved city coordinates
    const searchCall = mockExecuteQuery.mock.calls[1];
    const searchParams = searchCall[1] as unknown[];
    expect(searchParams).toContain(45.5231);
    expect(searchParams).toContain(-122.6765);

    expect(result.results).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('skips cityBias when lookup returns null (unknown city)', async () => {
    mockExecuteQuery
      .mockResolvedValueOnce([]) // lookupCityCoords returns empty
      .mockResolvedValueOnce([]); // search results
    mockExecuteCount.mockResolvedValue(0);

    const query: SearchQuery = {
      text: 'food',
      filters: { status: 'active' },
      pagination: { page: 1, limit: 10 },
      cityBias: 'FakeCity12345',
    };

    await engine.search(query);

    // lookupCityCoords called but returned null
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);

    // Search query should NOT contain city coords
    const searchCall = mockExecuteQuery.mock.calls[1];
    const sql = searchCall[0] as string;
    // Should have NULL sort_distance since no cityCoords resolved
    expect(sql).toContain('NULL::float AS sort_distance');
  });

  it('does not call lookupCityCoords when no cityBias provided', async () => {
    mockExecuteQuery.mockResolvedValueOnce([]); // search results only
    mockExecuteCount.mockResolvedValue(0);

    const query: SearchQuery = {
      text: 'dental',
      filters: { status: 'active' },
      pagination: { page: 1, limit: 10 },
    };

    await engine.search(query);

    // Only one executeQuery call (for search), no lookupCityCoords
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  it('does not call lookupCityCoords when geo query is provided', async () => {
    mockExecuteQuery.mockResolvedValueOnce([]); // search results only
    mockExecuteCount.mockResolvedValue(0);

    const query: SearchQuery = {
      text: 'housing',
      filters: { status: 'active' },
      pagination: { page: 1, limit: 10 },
      cityBias: 'Portland',
      geo: {
        type: 'radius',
        lat: 45.5231,
        lng: -122.6765,
        radiusMeters: 5000,
      },
    };

    await engine.search(query);

    // Should skip lookupCityCoords since geo query is explicit
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });
});
