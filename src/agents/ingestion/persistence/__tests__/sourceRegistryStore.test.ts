import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleSourceRegistryStore } from '../sourceRegistryStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      let result = selectResults.shift() ?? [];
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => {
          result = result ?? [];
          return builder;
        }),
        limit: vi.fn(() => Promise.resolve(result)),
        then: (
          onFulfilled?: ((value: unknown) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        return Promise.resolve();
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => {
        updateSets.push(value);
        return {
          where: vi.fn(() => Promise.resolve()),
        };
      }),
    })),
  };

  return { db, insertValues, updateSets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'src-1',
    name: 'County Feed',
    family: 'seeded_only',
    homepageUrl: 'https://example.gov',
    licenseNotes: null,
    termsUrl: null,
    trustTier: 'allowlisted',
    hsdsProfileUri: null,
    domainRules: [{ type: 'exact_host', value: 'example.gov' }],
    crawlPolicy: {
      discovery: [{ type: 'seeded_only' }],
      obeyRobotsTxt: true,
      userAgent: 'oran-ingestion-agent/1.0',
      allowedPathPrefixes: ['/'],
      blockedPathPrefixes: [],
      maxRequestsPerMinute: 60,
      maxConcurrentRequests: 4,
      fetchTtlHours: 12,
    },
    jurisdictionScope: [{ kind: 'statewide', country: 'US', stateProvince: 'WA' }],
    contactInfo: {},
    isActive: true,
    notes: null,
    legacyIngestionSourceId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('sourceRegistryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps active source systems into the current domain model and skips non-registry rows', async () => {
    const { db } = createMockDb([
      [
        makeRow(),
        makeRow({ id: 'host-portal', name: 'ORAN Host Portal', domainRules: [], family: 'host_portal' }),
      ],
    ]);
    const store = createDrizzleSourceRegistryStore(db as never);

    const results = await store.listActive();

    expect(results).toEqual([
      expect.objectContaining({
        id: 'src-1',
        displayName: 'County Feed',
        trustLevel: 'allowlisted',
        domainRules: [{ type: 'exact_host', value: 'example.gov' }],
        discovery: [{ type: 'seeded_only' }],
        crawl: expect.objectContaining({
          maxConcurrentRequests: 4,
          fetchTtlHours: 12,
        }),
        coverage: [{ kind: 'statewide', country: 'US', stateProvince: 'WA' }],
      }),
    ]);
  });

  it('returns null for missing ids and invalid URLs', async () => {
    const { db } = createMockDb([[], []]);
    const store = createDrizzleSourceRegistryStore(db as never);

    await expect(store.getById('missing')).resolves.toBeNull();
    await expect(store.findForUrl('not a url')).resolves.toBeNull();
  });

  it('matches exact and suffix sources through the shared registry matcher', async () => {
    const { db } = createMockDb([
      [
        makeRow({ id: 'exact-row', name: 'Exact', domainRules: [{ type: 'exact_host', value: 'portal.example.gov' }] }),
        makeRow({ id: 'suffix-row', name: 'Suffix', domainRules: [{ type: 'suffix', value: 'example.gov' }] }),
      ],
      [
        makeRow({ id: 'exact-row', name: 'Exact', domainRules: [{ type: 'exact_host', value: 'portal.example.gov' }] }),
        makeRow({ id: 'suffix-row', name: 'Suffix', domainRules: [{ type: 'suffix', value: 'example.gov' }] }),
      ],
    ]);
    const store = createDrizzleSourceRegistryStore(db as never);

    await expect(store.findForUrl('https://portal.example.gov/path')).resolves.toEqual(
      expect.objectContaining({ id: 'exact-row', displayName: 'Exact' }),
    );
    await expect(store.findForUrl('https://sub.example.gov/path')).resolves.toEqual(
      expect.objectContaining({ id: 'suffix-row', displayName: 'Suffix' }),
    );
  });

  it('updates existing records and inserts new ones against source systems', async () => {
    const { db, insertValues, updateSets } = createMockDb([
      [makeRow({ id: 'src-1' })],
      [],
    ]);
    const store = createDrizzleSourceRegistryStore(db as never);

    await store.upsert({
      id: 'src-1',
      displayName: 'Updated Feed',
      trustLevel: 'blocked',
      domainRules: [{ type: 'suffix', value: 'updated.gov' }],
      discovery: [{ type: 'sitemap', sitemapUrl: 'https://updated.gov/sitemap.xml' }],
      crawl: {
        obeyRobotsTxt: true,
        userAgent: 'oran',
        allowedPathPrefixes: ['/'],
        blockedPathPrefixes: [],
        maxRequestsPerMinute: 12,
        maxConcurrentRequests: 8,
        fetchTtlHours: 24,
      },
      coverage: [{ kind: 'national', country: 'US' }],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    await store.upsert({
      id: 'src-2',
      displayName: 'Inserted Feed',
      trustLevel: 'allowlisted',
      domainRules: [{ type: 'exact_host', value: 'inserted.gov' }],
      discovery: [{ type: 'seeded_only', seedUrls: ['https://inserted.gov'] }],
      crawl: {
        obeyRobotsTxt: true,
        userAgent: 'oran',
        allowedPathPrefixes: ['/'],
        blockedPathPrefixes: [],
        maxRequestsPerMinute: 12,
        maxConcurrentRequests: 3,
        fetchTtlHours: 6,
      },
      coverage: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        id: 'src-1',
        name: 'Updated Feed',
        family: 'sitemap',
        homepageUrl: 'https://updated.gov/sitemap.xml',
        trustTier: 'blocked',
        domainRules: [{ type: 'suffix', value: 'updated.gov' }],
        crawlPolicy: expect.objectContaining({
          discovery: [{ type: 'sitemap', sitemapUrl: 'https://updated.gov/sitemap.xml' }],
          maxConcurrentRequests: 8,
          fetchTtlHours: 24,
        }),
        jurisdictionScope: [{ kind: 'national', country: 'US' }],
        isActive: true,
        updatedAt: expect.any(Date),
      }),
    );

    expect(insertValues).toHaveLength(1);
    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        id: 'src-2',
        name: 'Inserted Feed',
        family: 'seeded_only',
        homepageUrl: 'https://inserted.gov',
        trustTier: 'allowlisted',
        domainRules: [{ type: 'exact_host', value: 'inserted.gov' }],
        jurisdictionScope: [],
        isActive: true,
      }),
    );
  });

  it('deactivates records without deleting them', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleSourceRegistryStore(db as never);

    await store.deactivate('src-9');

    expect(updateSets).toEqual([
      expect.objectContaining({
        isActive: false,
        updatedAt: expect.any(Date),
      }),
    ]);
  });
});
