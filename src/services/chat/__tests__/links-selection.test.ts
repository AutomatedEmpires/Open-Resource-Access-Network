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

  test('returns empty when all candidate URLs are invalid or unsupported', () => {
    const now = new Date();
    const enriched: EnrichedService = {
      service: {
        id: 'svc-x',
        organizationId: 'org-x',
        name: 'Bad URL Service',
        description: 'n/a',
        status: 'active',
        url: 'not-a-url',
        updatedAt: now,
        createdAt: now,
      },
      organization: {
        id: 'org-x',
        name: 'Bad URL Org',
        status: 'active',
        url: 'ftp://example.gov',
        updatedAt: now,
        createdAt: now,
      },
      phones: [],
      schedules: [],
      taxonomyTerms: [],
      confidenceScore: null,
    };

    const links = selectServiceLinks(
      enriched,
      { intentCategory: 'general', locale: 'en' },
      [
        { url: '::::', label: 'broken', kind: 'other' },
        { url: 'mailto:test@example.org', label: 'mail', kind: 'contact' },
      ],
    );

    expect(links).toEqual([]);
  });

  test('filters out links when intent category/action/locale constraints do not match', () => {
    const now = new Date();
    const enriched: EnrichedService = {
      service: {
        id: 'svc-y',
        organizationId: 'org-y',
        name: 'No fallback',
        description: 'n/a',
        status: 'active',
        url: '',
        updatedAt: now,
        createdAt: now,
      },
      organization: {
        id: 'org-y',
        name: 'No fallback org',
        status: 'active',
        url: '',
        updatedAt: now,
        createdAt: now,
      },
      phones: [],
      schedules: [],
      taxonomyTerms: [],
      confidenceScore: null,
    };

    const links = selectServiceLinks(
      enriched,
      {
        intentCategory: 'housing',
        intentAction: 'apply',
        locale: 'en',
        audienceTags: ['youth'],
      },
      [
        {
          url: 'https://example.gov/mismatch',
          label: 'Mismatch',
          kind: 'apply',
          constraints: {
            intentCategories: ['food_assistance'],
            intentActions: ['contact'],
            locales: ['es'],
            audienceTags: ['veteran'],
          },
        },
      ],
    );

    expect(links).toEqual([]);
  });

  test('de-duplicates equivalent URLs and strips hashes', () => {
    const enriched = makeMockEnrichedService();
    const links = selectServiceLinks(
      {
        ...enriched,
        service: {
          ...enriched.service,
          url: 'https://example.gov/services/veterans#details',
        },
      },
      { intentCategory: 'housing', locale: 'en' },
      [
        {
          url: 'https://example.gov/services/veterans',
          label: 'Duplicate page',
          kind: 'service_page',
        },
      ],
    );

    const servicePageLinks = links.filter((l) => l.url === 'https://example.gov/services/veterans');
    expect(servicePageLinks).toHaveLength(1);
  });

  test.each([
    ['contact', 'contact', 'https://example.gov/contact'],
    ['eligibility', 'eligibility', 'https://example.gov/eligibility'],
    ['hours', 'service_page', 'https://example.gov/service-home'],
    ['website', 'service_page', 'https://example.gov/service-home'],
  ] as const)(
    'prioritizes %s action links',
    (intentAction, kind, expectedUrl) => {
      const enriched = makeMockEnrichedService();
      const links = selectServiceLinks(
        {
          ...enriched,
          service: { ...enriched.service, url: 'https://example.gov/service-home' },
          organization: { ...enriched.organization, url: 'https://example.gov/org-home' },
        },
        {
          intentCategory: 'housing',
          intentAction,
          locale: 'en',
        },
        [
          { url: 'https://example.gov/contact', label: 'Contact', kind: 'contact' },
          { url: 'https://example.gov/eligibility', label: 'Eligibility', kind: 'eligibility' },
          { url: 'https://example.gov/hours', label: 'Hours', kind: 'hours' },
          { url: 'https://example.gov/service-home', label: 'Service Home', kind: 'service_page' },
        ],
      );

      expect(links[0].url).toBe(expectedUrl);
      expect(links[0].kind).toBe(kind);
      expect(links[0].isPrimary).toBe(true);
    },
  );
});
