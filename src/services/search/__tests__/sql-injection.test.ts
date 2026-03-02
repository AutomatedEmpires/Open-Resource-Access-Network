/**
 * Search Query SQL Injection Safety Tests
 *
 * Verifies that all generated SQL uses parameterized queries ($1, $2, ...)
 * and never interpolates user input into SQL strings.
 */

import { describe, it, expect } from 'vitest';
import {
  buildRadiusWhereClause,
  buildBboxWhereClause,
  buildFiltersWhereClause,
  buildTextSearchWhereClause,
  buildSearchQuery,
} from '@/services/search/engine';
import type { SearchQuery } from '@/services/search/types';

describe('SQL injection prevention', () => {
  it('text search does NOT interpolate user input into SQL', () => {
    const malicious = "'; DROP TABLE services; --";
    const clause = buildTextSearchWhereClause(malicious, 1);

    // The SQL should contain $1 placeholder, NOT the actual input
    expect(clause.sql).toContain('$1');
    expect(clause.sql).not.toContain('DROP TABLE');
    expect(clause.sql).not.toContain("';");
    // The actual value is in params, safely separated
    expect(clause.params[0]).toBe(malicious);
  });

  it('radius query does NOT interpolate coordinates into SQL', () => {
    const clause = buildRadiusWhereClause({
      type: 'radius',
      lat: 40.7128,
      lng: -74.006,
      radiusMeters: 10000,
    });

    // SQL should use $N placeholders, not raw numbers
    expect(clause.sql).toMatch(/\$\d+/);
    expect(clause.sql).not.toContain('40.7128');
    expect(clause.sql).not.toContain('-74.006');
    expect(clause.sql).not.toContain('10000');
  });

  it('bbox query does NOT interpolate bounds into SQL', () => {
    const clause = buildBboxWhereClause({
      type: 'bbox',
      minLat: 40.0,
      minLng: -75.0,
      maxLat: 41.0,
      maxLng: -73.0,
    });

    expect(clause.sql).toMatch(/\$\d+/);
    expect(clause.sql).not.toContain('40.0');
    expect(clause.params).toHaveLength(4);
  });

  it('filter with malicious organizationId is parameterized', () => {
    const malicious = "'; DELETE FROM organizations; --";
    const clause = buildFiltersWhereClause({
      status: 'active',
      organizationId: malicious,
    });

    expect(clause.sql).not.toContain('DELETE');
    expect(clause.params).toContain(malicious);
  });

  it('filter with malicious taxonomy IDs is parameterized', () => {
    const malicious = ["'; DROP TABLE service_taxonomy; --", 'normal-uuid'];
    const clause = buildFiltersWhereClause({
      status: 'active',
      taxonomyTermIds: malicious,
    });

    expect(clause.sql).not.toContain('DROP TABLE');
    expect(clause.params).toContain(malicious[0]);
    expect(clause.params).toContain(malicious[1]);
  });

  it('full query with malicious text is fully parameterized', () => {
    const query: SearchQuery = {
      text: "Robert'); DROP TABLE students;--",
      filters: { status: 'active' },
      pagination: { page: 1, limit: 20 },
    };

    const built = buildSearchQuery(query);

    // The generated SQL must not contain the raw malicious input
    expect(built.sql).not.toContain('DROP TABLE');
    expect(built.countSql).not.toContain('DROP TABLE');

    // All user-provided values must be in the params array
    const paramsStr = JSON.stringify(built.params);
    expect(paramsStr).toContain('DROP TABLE students');
  });

  it('pagination values are parameterized (not interpolated)', () => {
    const query: SearchQuery = {
      filters: { status: 'active' },
      pagination: { page: 2, limit: 50 },
    };

    const built = buildSearchQuery(query);

    // LIMIT and OFFSET should be $N placeholders
    expect(built.sql).toMatch(/LIMIT \$\d+/);
    expect(built.sql).toMatch(/OFFSET \$\d+/);
    expect(built.params).toContain(50);  // limit
    expect(built.params).toContain(50);  // offset = (2-1)*50
  });
});
