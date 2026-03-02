/**
 * Sort Order / buildOrderByClause Tests
 *
 * Tests for the search engine sort ordering logic.
 * Covers all four sort modes and integration with buildSearchQuery.
 * All tests are self-contained — no DB connection required.
 */

import { describe, it, expect } from 'vitest';
import { buildOrderByClause, buildSearchQuery } from '../engine';
import type { SearchQuery } from '../types';

// ============================================================
// buildOrderByClause — unit
// ============================================================

describe('buildOrderByClause', () => {
  const distExpr = 'dist_col';

  it('returns trust-first + distance for "relevance"', () => {
    const clause = buildOrderByClause('relevance', distExpr);
    expect(clause).toContain('verification_confidence DESC');
    expect(clause).toContain('score DESC');
    expect(clause).toContain(`${distExpr} ASC`);
  });

  it('returns trust-first + distance when sortBy is undefined (default)', () => {
    const clause = buildOrderByClause(undefined, distExpr);
    expect(clause).toContain('verification_confidence DESC');
    expect(clause).toContain(distExpr);
  });

  it('returns trust-only for "trust"', () => {
    const clause = buildOrderByClause('trust', distExpr);
    expect(clause).toContain('verification_confidence DESC');
    expect(clause).toContain('score DESC');
    // should NOT include distance expression
    expect(clause).not.toContain(distExpr);
  });

  it('returns s.name ASC for "name_asc"', () => {
    const clause = buildOrderByClause('name_asc', distExpr);
    expect(clause).toBe('s.name ASC');
  });

  it('returns s.name DESC for "name_desc"', () => {
    const clause = buildOrderByClause('name_desc', distExpr);
    expect(clause).toBe('s.name DESC');
  });

  it('handles empty string distance expression gracefully', () => {
    const clause = buildOrderByClause('relevance', '');
    expect(clause).toContain('verification_confidence DESC');
    // Distance part still present in template even if empty
    expect(clause).toContain('ASC NULLS LAST');
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

  it('uses default relevance ORDER BY when sortBy is omitted', () => {
    const built = buildSearchQuery(baseQuery);
    expect(built.sql).toContain('ORDER BY');
    expect(built.sql).toContain('verification_confidence DESC');
    expect(built.sql).toContain('score DESC');
  });

  it('applies NAME ASC ordering when sortBy=name_asc', () => {
    const built = buildSearchQuery({ ...baseQuery, sortBy: 'name_asc' });
    expect(built.sql).toContain('ORDER BY');
    expect(built.sql).toContain('s.name ASC');
    // Should NOT contain trust-based ordering
    expect(built.sql).not.toMatch(/ORDER BY.*verification_confidence/);
  });

  it('applies NAME DESC ordering when sortBy=name_desc', () => {
    const built = buildSearchQuery({ ...baseQuery, sortBy: 'name_desc' });
    expect(built.sql).toContain('s.name DESC');
  });

  it('applies trust ordering when sortBy=trust', () => {
    const built = buildSearchQuery({ ...baseQuery, sortBy: 'trust' });
    const orderIdx = built.sql.indexOf('ORDER BY');
    const orderClause = built.sql.slice(orderIdx);
    expect(orderClause).toContain('verification_confidence DESC');
    // Trust sort should NOT include distance
    expect(orderClause).not.toContain('ST_Distance');
  });

  it('includes distance in relevance sort for geo queries', () => {
    const geoQuery: SearchQuery = {
      ...baseQuery,
      sortBy: 'relevance',
      geo: { type: 'radius', lat: 40.7, lng: -74.0, radiusMeters: 5000 },
    };
    const built = buildSearchQuery(geoQuery);
    const orderIdx = built.sql.indexOf('ORDER BY');
    const orderClause = built.sql.slice(orderIdx);
    expect(orderClause).toContain('ST_Distance');
  });

  it('count query is unaffected by sort option', () => {
    const a = buildSearchQuery({ ...baseQuery, sortBy: 'name_asc' });
    const b = buildSearchQuery({ ...baseQuery, sortBy: 'trust' });
    // Count queries should be identical (no ORDER BY, same WHERE)
    expect(a.countSql).toBe(b.countSql);
    expect(a.countParams).toEqual(b.countParams);
  });
});
