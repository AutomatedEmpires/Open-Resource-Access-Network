/**
 * Card-tier hydration tests.
 *
 * The paged search path attaches exactly one callable phone (service →
 * location → organization fallback), one hours line (service → location), and
 * a capped set of taxonomy labels. These tests pin the fallback chain — the
 * demo/live data attaches phones at the location/org level, which the old
 * service-scoped lookup silently missed ("No stored phone number" while a
 * phone existed one level up).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CARD_PHONES_SQL, CARD_SCHEDULES_SQL, hydrateCardTier } from '../hydrateRelations';
import type { EnrichedService } from '@/domain/types';

const executeQuery = vi.fn();

function makeService(overrides: {
  id: string;
  locationId?: string | null;
  organizationId?: string;
}): EnrichedService {
  return {
    service: {
      id: overrides.id,
      organizationId: overrides.organizationId ?? 'org-1',
      programId: null,
      name: `Service ${overrides.id}`,
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
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    organization: {
      id: overrides.organizationId ?? 'org-1',
      name: 'Org',
      description: null,
      status: 'active',
      verifiedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    location: overrides.locationId
      ? {
          id: overrides.locationId,
          organizationId: overrides.organizationId ?? 'org-1',
          name: null,
          latitude: null,
          longitude: null,
          status: 'active',
          createdAt: new Date(0),
          updatedAt: new Date(0),
        }
      : null,
    address: null,
    phones: [],
    schedules: [],
    taxonomyTerms: [],
    confidenceScore: null,
  } as unknown as EnrichedService;
}

function phoneRow(overrides: Record<string, unknown>) {
  return {
    id: 'p-x',
    service_id: null,
    location_id: null,
    organization_id: null,
    number: '555-0000',
    extension: null,
    type: 'voice',
    language: null,
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  executeQuery.mockResolvedValue([]);
});

describe('hydrateCardTier', () => {
  it('returns [] for empty input without querying', async () => {
    const result = await hydrateCardTier({ executeQuery }, []);
    expect(result).toEqual([]);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it('prefers a service-scoped phone over location and organization phones', async () => {
    executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM phones')) {
        return [
          phoneRow({ id: 'p-org', organization_id: 'org-1', number: '555-0300' }),
          phoneRow({ id: 'p-loc', location_id: 'loc-1', number: '555-0200' }),
          phoneRow({ id: 'p-svc', service_id: 'svc-1', number: '555-0100' }),
        ];
      }
      return [];
    });

    const [result] = await hydrateCardTier(
      { executeQuery },
      [makeService({ id: 'svc-1', locationId: 'loc-1' })],
    );

    expect(result.phones).toHaveLength(1);
    expect(result.phones[0].number).toBe('555-0100');
  });

  it('falls back to the record location phone, then the organization phone', async () => {
    executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM phones')) {
        return [
          phoneRow({ id: 'p-org', organization_id: 'org-1', number: '555-0300' }),
          phoneRow({ id: 'p-loc', location_id: 'loc-1', number: '555-0200' }),
        ];
      }
      return [];
    });

    const [withLocation, withoutLocation] = await hydrateCardTier(
      { executeQuery },
      [
        makeService({ id: 'svc-1', locationId: 'loc-1' }),
        makeService({ id: 'svc-2', locationId: null }),
      ],
    );

    expect(withLocation.phones[0]?.number).toBe('555-0200');
    expect(withoutLocation.phones[0]?.number).toBe('555-0300');
  });

  it('attaches one schedule line with a service-then-location fallback', async () => {
    executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM schedules')) {
        return [
          {
            id: 's-loc', service_id: null, location_id: 'loc-1',
            description: 'Open weekdays 9-5',
            created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 's-svc', service_id: 'svc-2', location_id: null,
            description: 'Hotline, 24/7',
            created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
          },
        ];
      }
      return [];
    });

    const [fromLocation, fromService] = await hydrateCardTier(
      { executeQuery },
      [
        makeService({ id: 'svc-1', locationId: 'loc-1' }),
        makeService({ id: 'svc-2', locationId: null }),
      ],
    );

    expect(fromLocation.schedules[0]?.description).toBe('Open weekdays 9-5');
    expect(fromService.schedules[0]?.description).toBe('Hotline, 24/7');
  });

  it('caps taxonomy labels at three per service', async () => {
    executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM service_taxonomy')) {
        return ['Food', 'Groceries', 'Meals', 'Nutrition', 'Pantry'].map((term, i) => ({
          service_id: 'svc-1',
          id: `t-${i}`,
          term,
          description: null,
          parent_id: null,
          taxonomy: 'custom',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-02-01T00:00:00.000Z',
        }));
      }
      return [];
    });

    const [result] = await hydrateCardTier(
      { executeQuery },
      [makeService({ id: 'svc-1' })],
    );

    expect(result.taxonomyTerms).toHaveLength(3);
    expect(result.taxonomyTerms.map((t) => t.term)).toEqual(['Food', 'Groceries', 'Meals']);
    expect(result.taxonomyTerms[0]?.updatedAt.toISOString()).toBe('2026-02-01T00:00:00.000Z');

    const taxonomyCall = executeQuery.mock.calls.find(([sql]) => (
      typeof sql === 'string' && sql.includes('FROM service_taxonomy')
    ));
    expect(taxonomyCall?.[0]).toContain('tt.updated_at');
    expect(taxonomyCall?.[0]).toContain('ORDER BY st.service_id, tt.term, tt.id');
  });

  it('leaves collections empty when nothing matches (no fabricated data)', async () => {
    const [result] = await hydrateCardTier(
      { executeQuery },
      [makeService({ id: 'svc-1', locationId: 'loc-1' })],
    );
    expect(result.phones).toEqual([]);
    expect(result.schedules).toEqual([]);
    expect(result.taxonomyTerms).toEqual([]);
  });

  it('indexes a multi-parent phone row under every scope it carries', async () => {
    // One HRSA-style row scoped to BOTH a service and its organization: the
    // sibling service with no phone of its own must still find the org number.
    executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM phones')) {
        return [
          phoneRow({ id: 'p-1', service_id: 'svc-1', organization_id: 'org-1', number: '555-0100' }),
        ];
      }
      return [];
    });

    const [withOwn, sibling] = await hydrateCardTier(
      { executeQuery },
      [
        makeService({ id: 'svc-1' }),
        makeService({ id: 'svc-2' }),
      ],
    );

    expect(withOwn.phones[0]?.number).toBe('555-0100');
    expect(sibling.phones[0]?.number).toBe('555-0100');
  });

  it('selects only voice, hotline, or untyped rows for the Call action', () => {
    // SMS, TTY, and fax require different affordances and never qualify for
    // the card tier's tel: link.
    expect(CARD_PHONES_SQL).toContain("type IN ('voice', 'hotline')");
    expect(CARD_PHONES_SQL).toMatch(/CASE WHEN type IS NULL OR type = 'voice' THEN 0 ELSE 1 END/);
    expect(CARD_PHONES_SQL).not.toContain("type <> 'fax'");
    expect(CARD_PHONES_SQL).toContain('created_at');
    expect(CARD_PHONES_SQL).toContain('updated_at');
  });

  it('carries real timestamps instead of epoch defaults', async () => {
    executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM phones')) {
        return [phoneRow({ id: 'p-1', service_id: 'svc-1', created_at: '2026-05-01T12:00:00.000Z', updated_at: '2026-06-01T12:00:00.000Z' })];
      }
      return [];
    });

    const [result] = await hydrateCardTier({ executeQuery }, [makeService({ id: 'svc-1' })]);
    expect(result.phones[0]?.createdAt.toISOString()).toBe('2026-05-01T12:00:00.000Z');
    expect(result.phones[0]?.updatedAt.toISOString()).toBe('2026-06-01T12:00:00.000Z');
  });

  it('includes structured schedules that have no description', async () => {
    // Hours from the resource-submission workflow store days/opens_at/closes_at
    // with a NULL description — they must hydrate with their structured fields.
    executeQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM schedules')) {
        return [{
          id: 's-1', service_id: 'svc-1', location_id: null,
          valid_from: null, valid_to: null, dtstart: null, until: null, wkst: null,
          days: ['MO', 'TU'], opens_at: '09:00', closes_at: '17:00', description: null,
          created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        }];
      }
      return [];
    });

    const [result] = await hydrateCardTier({ executeQuery }, [makeService({ id: 'svc-1' })]);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0]?.days).toEqual(['MO', 'TU']);
    expect(result.schedules[0]?.opensAt).toBe('09:00');
    expect(result.schedules[0]?.closesAt).toBe('17:00');
    expect(CARD_SCHEDULES_SQL).toContain('days IS NOT NULL OR opens_at IS NOT NULL');
    expect(CARD_SCHEDULES_SQL).toContain('valid_from <= $3::date');
    expect(CARD_SCHEDULES_SQL).toContain('valid_to >= $3::date');
    expect(CARD_SCHEDULES_SQL).toContain('valid_from DESC NULLS LAST');
    expect(CARD_SCHEDULES_SQL).toContain('updated_at DESC NULLS LAST');
    expect(CARD_SCHEDULES_SQL).toContain('service_id NULLS LAST, location_id NULLS LAST, id');

    const scheduleCall = executeQuery.mock.calls.find(([sql]) => (
      typeof sql === 'string' && sql.includes('FROM schedules')
    ));
    expect(scheduleCall?.[1]).toEqual([
      ['svc-1'],
      [],
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    ]);
  });
});
