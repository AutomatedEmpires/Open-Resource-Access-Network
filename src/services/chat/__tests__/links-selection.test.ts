import { describe, expect, test } from 'vitest';

import type { EnrichedService } from '@/domain/types';
import { selectServiceLinks, type ServiceLink } from '../links';

function makeMockEnrichedService(): EnrichedService {
  const now = new Date();
  return {
    service: {
      id: 'svc-1',
      organizationId: 'org-1',
      name: 'Test Service',
      description: 'Test description',
      status: 'active',
      url: 'https://example.gov/services/veterans',
      updatedAt: now,
      createdAt: now,
    },
    organization: {
      id: 'org-1',
      name: 'Example Org',
      url: 'https://example.gov',
      status: 'active',
      updatedAt: now,
      createdAt: now,
    },
    phones: [],
    schedules: [],
    taxonomyTerms: [],
    confidenceScore: null,
  };
}

describe('selectServiceLinks', () => {
  test('prefers apply deep link when user intent is apply + audience tag matches', () => {
    const enriched = makeMockEnrichedService();

    const verifiedLinks: ServiceLink[] = [
      {
        url: 'https://example.gov/services/veterans/apply',
        label: 'Apply online',
        kind: 'apply',
        constraints: {
          intentActions: ['apply'],
          audienceTags: ['veteran'],
        },
        evidenceId: 'ev-1',
        lastVerifiedAt: '2026-03-02T00:00:00Z',
      },
    ];

    const links = selectServiceLinks(
      enriched,
      {
        intentCategory: 'housing',
        intentAction: 'apply',
        locale: 'en',
        audienceTags: ['veteran'],
      },
      verifiedLinks
    );

    expect(links.length).toBeGreaterThan(0);
    expect(links[0].url).toBe('https://example.gov/services/veterans/apply');
    expect(links[0].isPrimary).toBe(true);
  });

  test('does not return veteran-only link when audience tag is missing', () => {
    const enriched = makeMockEnrichedService();

    const verifiedLinks: ServiceLink[] = [
      {
        url: 'https://example.gov/services/veterans/apply',
        label: 'Apply online',
        kind: 'apply',
        constraints: {
          intentActions: ['apply'],
          audienceTags: ['veteran'],
        },
      },
    ];

    const links = selectServiceLinks(
      enriched,
      {
        intentCategory: 'housing',
        intentAction: 'apply',
        locale: 'en',
        audienceTags: undefined,
      },
      verifiedLinks
    );

    // Falls back to stored service/org URLs.
    expect(links.some((l) => l.url === 'https://example.gov/services/veterans/apply')).toBe(false);
    expect(links.some((l) => l.url === 'https://example.gov/services/veterans')).toBe(true);
  });
});
