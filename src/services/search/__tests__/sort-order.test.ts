/**
 * Sort Order / buildOrderByClause Tests
 *
 * Tests for the search engine sort ordering logic.
 * Covers all four sort modes, the per-service deduplication subquery, and the
 * deterministic pagination tiebreaker. All tests are self-contained — no DB
 * connection required.
 */

import { describe, it, expect } from 'vitest';
import { buildOrderByClause, buildSearchQuery } from '../engine';
import type { SearchQuery } from '../types';

/** The ranking ORDER BY is the one applied outside the deduplication subquery. */
function outerOrderClause(sql: string): string {
  const idx = sql.lastIndexOf('ORDER BY');
  expect(idx).toBeGreaterThan(-1);
  return sql.slice(idx);
}

// ============================================================
// buildOrderByClause — unit
// ============================================================

describe('buildOrderByClause', () => {
  it('returns trust-first + distance for "relevance"', () => {
    const clause = buildOrderByClause('relevance');
    expect(clause).toContain('verification_confidence DESC');
    expect(clause).toContain('confidence_score DESC');
    expect(clause).toContain('sort_distance ASC');
  });

  it('returns trust-first + distance when sortBy is undefined (default)', () => {
    const clause = buildOrderByClause(undefined);
    expect(clause).toContain('verification_confidence DESC');
    expect(clause).toContain('sort_distance');
  });

  it('returns trust-only for "trust"', () => {
    const clause = buildOrderByClause('trust');
    expect(clause).toContain('verification_confidence DESC');
    expect(clause).toContain('confidence_score DESC');
    // should NOT include the distance column
    expect(clause).not.toContain('sort_distance');
  });

  it('returns name ASC for "name_asc"', () => {
    expect(buildOrderByClause('name_asc')).toBe('name ASC, id ASC');
  });

  it('returns name DESC for "name_desc"', () => {
    expect(buildOrderByClause('name_desc')).toBe('name DESC, id ASC');
  });

  it('always ends with a deterministic id tiebreaker so pages are stable', () => {
    const modes = ['relevance', 'trust', 'distance', 'name_asc', 'name_desc', undefined] as const;
    for (const mode of modes) {
      expect(buildOrderByClause(mode)).toMatch(/id ASC$/);
    }
  });
});

// ============================================================
// buildSearchQuery — sort integration
// ============================================================

describe('buildSearchQuery sort integration', () => {
  const baseQuery: SearchQuery = {
    filters: { status: 'active' },
    pagination: { page: 1, limit: 20 },
  };

  it('deduplicates the location fan-out with DISTINCT ON per service', () => {
    const built = buildSearchQuery(baseQuery);
    expect(built.sql).toContain('DISTINCT ON (s.id)');
    // Count total and page rows must agree on the unit of counting: services.
    expect(built.countSql).toContain('COUNT(DISTINCT s.id)');
  });

  it('does not ship the embedding vector in result rows', () => {
    const built = buildSearchQuery(baseQuery);
    expect(built.sql).not.toContain('s.*');
    expect(built.sql).not.toContain('embedding');
  });

  it('uses default relevance ORDER BY when sortBy is omitted', () => {
    const built = buildSearchQuery(baseQuery);
    const order = outerOrderClause(built.sql);
    expect(order).toContain('verification_confidence DESC');
    expect(order).toContain('confidence_score DESC');
  });

  it('applies NAME ASC ordering when sortBy=name_asc', () => {
    const built = buildSearchQuery({ ...baseQuery, sortBy: 'name_asc' });
    const order = outerOrderClause(built.sql);
    expect(order).toContain('name ASC');
    expect(order).not.toContain('verification_confidence');
  });

  it('applies NAME DESC ordering when sortBy=name_desc', () => {
    const built = buildSearchQuery({ ...baseQuery, sortBy: 'name_desc' });
    expect(outerOrderClause(built.sql)).toContain('name DESC');
  });

  it('applies trust ordering when sortBy=trust', () => {
    const built = buildSearchQuery({ ...baseQuery, sortBy: 'trust' });
    const order = outerOrderClause(built.sql);
    expect(order).toContain('verification_confidence DESC');
    // Trust sort should NOT include distance
    expect(order).not.toContain('sort_distance');
    expect(order).not.toContain('ST_Distance');
  });

  it('includes distance in relevance sort for geo queries', () => {
    const geoQuery: SearchQuery = {
      ...baseQuery,
      sortBy: 'relevance',
      geo: { type: 'radius', lat: 40.7, lng: -74.0, radiusMeters: 5000 },
    };
    const built = buildSearchQuery(geoQuery);
    // The distance expression is computed inside the subquery…
    expect(built.sql).toContain('ST_Distance');
    // …and the ranking references its alias.
    expect(outerOrderClause(built.sql)).toContain('sort_distance ASC');
  });

  it('count query is unaffected by sort option', () => {
    const a = buildSearchQuery({ ...baseQuery, sortBy: 'name_asc' });
    const b = buildSearchQuery({ ...baseQuery, sortBy: 'trust' });
    // Count queries should be identical (no ORDER BY, same WHERE)
    expect(a.countSql).toBe(b.countSql);
    expect(a.countParams).toEqual(b.countParams);
  });
});
