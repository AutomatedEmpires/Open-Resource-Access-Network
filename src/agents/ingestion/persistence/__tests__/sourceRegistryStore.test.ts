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
        then: (onFulfilled?: ((value: unknown) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) =>
          Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        return {
          then: (onFulfilled: ((value: void) => unknown) | null | undefined, onRejected?: ((reason: unknown) => unknown) | null | undefined) =>
            Promise.resolve().then(onFulfilled, onRejected),
        };
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
    pattern: 'example.gov',
    patternType: 'domain',
    trustLevel: 'allowlisted',
    maxDepth: 6,
    crawlFrequency: 12,
    ownerOrgId: null,
    isActive: true,
    flags: {},
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  };
}

describe('sourceRegistryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps active rows into the current domain model', async () => {
    const { db } = createMockDb([
      [
        makeRow({ patternType: 'exact', maxDepth: 4, crawlFrequency: 9 }),
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
        crawl: expect.objectContaining({
          maxConcurrentRequests: 4,
          fetchTtlHours: 9,
        }),
        discovery: [{ type: 'seeded_only' }],
      }),
    ]);
  });

  it('returns null for missing ids and invalid URLs', async () => {
    const { db } = createMockDb([[], []]);
    const store = createDrizzleSourceRegistryStore(db as never);

    await expect(store.getById('missing')).resolves.toBeNull();
    await expect(store.findForUrl('not a url')).resolves.toBeNull();
  });

  it('matches exact, suffix, domain, and regex sources in priority order', async () => {
    const { db } = createMockDb([
      [
        makeRow({ id: 'exact-row', patternType: 'exact', pattern: 'portal.example.gov', name: 'Exact' }),
        makeRow({ id: 'suffix-row', patternType: 'suffix', pattern: 'example.gov', name: 'Suffix' }),
        makeRow({ id: 'domain-row', patternType: 'domain', pattern: 'agency.gov', name: 'Domain' }),
        makeRow({ id: 'regex-row', patternType: 'regex', pattern: '.*city\\.gov$', name: 'Regex' }),
      ],
      [
        makeRow({ id: 'exact-row', patternType: 'exact', pattern: 'portal.example.gov', name: 'Exact' }),
        makeRow({ id: 'suffix-row', patternType: 'suffix', pattern: 'example.gov', name: 'Suffix' }),
        makeRow({ id: 'domain-row', patternType: 'domain', pattern: 'agency.gov', name: 'Domain' }),
        makeRow({ id: 'regex-row', patternType: 'regex', pattern: '.*city\\.gov$', name: 'Regex' }),
      ],
      [
        makeRow({ id: 'exact-row', patternType: 'exact', pattern: 'portal.example.gov', name: 'Exact' }),
        makeRow({ id: 'suffix-row', patternType: 'suffix', pattern: 'example.gov', name: 'Suffix' }),
        makeRow({ id: 'domain-row', patternType: 'domain', pattern: 'agency.gov', name: 'Domain' }),
        makeRow({ id: 'regex-row', patternType: 'regex', pattern: '.*city\\.gov$', name: 'Regex' }),
      ],
      [
        makeRow({ id: 'broken-regex', patternType: 'regex', pattern: '[', name: 'Broken' }),
        makeRow({ id: 'regex-row', patternType: 'regex', pattern: '.*city\\.gov$', name: 'Regex' }),
      ],
    ]);
    const store = createDrizzleSourceRegistryStore(db as never);

    await expect(store.findForUrl('https://portal.example.gov/path')).resolves.toEqual(
      expect.objectContaining({ id: 'exact-row', displayName: 'Exact' }),
    );
    await expect(store.findForUrl('https://sub.example.gov/path')).resolves.toEqual(
      expect.objectContaining({ id: 'suffix-row', displayName: 'Suffix' }),
    );
    await expect(store.findForUrl('https://dept.agency.gov/path')).resolves.toEqual(
      expect.objectContaining({ id: 'domain-row', displayName: 'Domain' }),
    );
    await expect(store.findForUrl('https://metro.city.gov/path')).resolves.toEqual(
      expect.objectContaining({ id: 'regex-row', displayName: 'Regex' }),
    );
  });

  it('updates existing records and inserts new ones with legacy-compatible field mapping', async () => {
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
      discovery: [{ type: 'seeded_only' }],
      crawl: {
        obeyRobotsTxt: true,
        userAgent: 'oran',
        allowedPathPrefixes: ['/'],
        blockedPathPrefixes: [],
        maxRequestsPerMinute: 12,
        maxConcurrentRequests: 8,
        fetchTtlHours: 24,
      },
      coverage: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    await store.upsert({
      id: 'src-2',
      displayName: 'Inserted Feed',
      trustLevel: 'allowlisted',
      domainRules: [{ type: 'exact_host', value: 'inserted.gov' }],
      discovery: [{ type: 'seeded_only' }],
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
        pattern: 'updated.gov',
        patternType: 'suffix',
        trustLevel: 'blocked',
        maxDepth: 8,
        crawlFrequency: 24,
        isActive: true,
        updatedAt: expect.any(Date),
      }),
    );

    expect(insertValues).toHaveLength(1);
    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        id: 'src-2',
        name: 'Inserted Feed',
        pattern: 'inserted.gov',
        patternType: 'exact_host',
        trustLevel: 'allowlisted',
        maxDepth: 3,
        crawlFrequency: 6,
        isActive: true,
        notes: null,
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
