import { describe, expect, it, vi } from 'vitest';

import type { EnrichedService } from '@/domain/types';
import { hydrateEnrichedServices } from '../hydrateRelations';

const SVC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SVC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOC_A = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function leanService(id: string, locationId?: string): EnrichedService {
  return {
    service: {
      id,
      organizationId: 'org-1',
      programId: null,
      name: 'Service',
      description: null,
      url: null,
      email: null,
      status: 'active',
      interpretationServices: null,
      applicationProcess: null,
      waitTime: null,
      fees: null,
      accreditations: null,
      licenses: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    organization: {
      id: 'org-1',
      name: 'Org',
      description: null,
      status: 'active',
      verifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    location: locationId
      ? {
          id: locationId,
          organizationId: 'org-1',
          name: null,
          latitude: null,
          longitude: null,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : null,
    address: null,
    phones: [],
    schedules: [],
    taxonomyTerms: [],
    confidenceScore: null,
  } as EnrichedService;
}

type Row = Record<string, unknown>;

function makeDeps(rowsBySql: Array<{ match: string; rows: Row[] }>) {
  const executeQuery = vi.fn(async (sql: string, params: unknown[]) => {
    expect(Array.isArray(params[0])).toBe(true);
    const entry = rowsBySql.find((candidate) => sql.includes(candidate.match));
    return entry ? entry.rows : [];
  });
  return { executeQuery: executeQuery as <T>(sql: string, params: unknown[]) => Promise<T[]>, mock: executeQuery };
}

describe('hydrateEnrichedServices', () => {
  it('returns immediately without queries for empty input', async () => {
    const deps = makeDeps([]);
    await expect(hydrateEnrichedServices(deps, [])).resolves.toEqual([]);
    expect(deps.mock).not.toHaveBeenCalled();
  });

  it('attaches phones, schedules, taxonomy, and eligibility grouped by service', async () => {
    const deps = makeDeps([
      { match: 'FROM phones', rows: [
        { id: 'p1', service_id: SVC_A, number: '555-0100', extension: null, type: 'voice' },
        { id: 'p2', service_id: SVC_B, number: '555-0200', type: 'hotline' },
      ] },
      { match: 'FROM schedules', rows: [
        { id: 's1', service_id: SVC_A, description: 'Mon-Fri 9-5', days: ['MO', 'FR'], opens_at: '09:00', closes_at: '17:00' },
      ] },
      { match: 'JOIN taxonomy_terms', rows: [
        { id: 't1', service_id: SVC_A, term: 'Food Pantry', taxonomy: 'custom' },
      ] },
      { match: 'FROM eligibility', rows: [
        { id: 'e1', service_id: SVC_A, description: 'Adults 18+', minimum_age: 18 },
      ] },
    ]);

    const [a, b] = await hydrateEnrichedServices(deps, [leanService(SVC_A), leanService(SVC_B)]);

    expect(a.phones).toHaveLength(1);
    expect(a.phones[0]).toMatchObject({ number: '555-0100', type: 'voice', serviceId: SVC_A });
    expect(a.schedules[0]).toMatchObject({ description: 'Mon-Fri 9-5', days: ['MO', 'FR'], opensAt: '09:00' });
    expect(a.taxonomyTerms[0]).toMatchObject({ term: 'Food Pantry' });
    expect(a.eligibility?.[0]).toMatchObject({ description: 'Adults 18+', minimumAge: 18 });

    expect(b.phones[0]).toMatchObject({ number: '555-0200', type: 'hotline' });
    expect(b.schedules).toEqual([]);
    expect(b.eligibility).toEqual([]);
  });

  it('keys accessibility by location and skips the query when no locations exist', async () => {
    const deps = makeDeps([
      { match: 'FROM accessibility_for_disabilities', rows: [
        { id: 'ac1', location_id: LOC_A, accessibility: 'wheelchair', details: null },
      ] },
    ]);

    const [withLocation, withoutLocation] = await hydrateEnrichedServices(deps, [
      leanService(SVC_A, LOC_A),
      leanService(SVC_B),
    ]);
    expect(withLocation.accessibility?.[0]).toMatchObject({ accessibility: 'wheelchair', locationId: LOC_A });
    expect(withoutLocation.accessibility).toEqual([]);

    const accessibilityCalls = deps.mock.mock.calls.filter(([sql]) =>
      String(sql).includes('accessibility_for_disabilities'));
    expect(accessibilityCalls).toHaveLength(1);
    expect(accessibilityCalls[0][1]).toEqual([[LOC_A]]);

    // No locations at all => the accessibility query is skipped entirely.
    deps.mock.mockClear();
    await hydrateEnrichedServices(deps, [leanService(SVC_A)]);
    expect(deps.mock.mock.calls.some(([sql]) => String(sql).includes('accessibility_for_disabilities'))).toBe(false);
  });

  it('deduplicates service ids in query parameters and never interpolates them', async () => {
    const deps = makeDeps([]);
    await hydrateEnrichedServices(deps, [leanService(SVC_A), leanService(SVC_A)]);
    for (const [sql, params] of deps.mock.mock.calls) {
      expect(String(sql)).not.toContain(SVC_A);
      expect((params as unknown[][])[0]).toEqual([SVC_A]);
    }
  });

  it('does not mutate the input services', async () => {
    const deps = makeDeps([
      { match: 'FROM phones', rows: [{ id: 'p1', service_id: SVC_A, number: '555-0100' }] },
    ]);
    const input = leanService(SVC_A);
    const [hydrated] = await hydrateEnrichedServices(deps, [input]);
    expect(input.phones).toEqual([]);
    expect(hydrated.phones).toHaveLength(1);
  });
});
