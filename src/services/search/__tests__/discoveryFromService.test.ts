import { describe, expect, it } from 'vitest';

import type { EnrichedService } from '@/domain/types';

import { buildServiceFallbackDiscoveryState } from '../discoveryFromService';

function makeService(overrides: Partial<EnrichedService> = {}): EnrichedService {
  return {
    service: { id: 'svc-1', name: 'Food Pantry' } as EnrichedService['service'],
    organization: { id: 'org-1', name: 'Helping Hands' } as EnrichedService['organization'],
    taxonomyTerms: [
      { id: 'a1000000-4000-4000-8000-000000000001', term: 'Food Assistance' },
      { id: 'a1000000-4000-4000-8000-000000000002', term: 'Pantries' },
    ] as EnrichedService['taxonomyTerms'],
    attributes: [
      { taxonomy: 'delivery', tag: 'virtual' },
      { taxonomy: 'delivery', tag: 'virtual' },
      { taxonomy: 'access', tag: 'walk_in' },
      { taxonomy: 'population', tag: 'youth' },
    ] as EnrichedService['attributes'],
    ...overrides,
  } as EnrichedService;
}

describe('buildServiceFallbackDiscoveryState', () => {
  it('maps service taxonomy and only browse-compatible attributes', () => {
    expect(buildServiceFallbackDiscoveryState(makeService())).toEqual({
      taxonomyTermIds: [
        'a1000000-4000-4000-8000-000000000001',
        'a1000000-4000-4000-8000-000000000002',
      ],
      attributeFilters: {
        delivery: ['virtual'],
        access: ['walk_in'],
      },
    });
  });

  it('returns an empty fallback shape when the service is missing', () => {
    expect(buildServiceFallbackDiscoveryState(null)).toEqual({
      taxonomyTermIds: [],
      attributeFilters: undefined,
    });
  });
});
