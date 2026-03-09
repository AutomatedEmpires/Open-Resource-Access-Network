import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleCanonicalLocationStore } from '../canonicalLocationStore';

function createMockDb(selectResults: unknown[] = [], returningResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const terminal: any = {
        then: (
          onFulfilled?: ((value: unknown) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        orderBy: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        offset: vi.fn(() => builder),
        then: terminal.then,
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        const rows = returningResults.shift() ?? [];
        return {
          returning: vi.fn(() => Promise.resolve(rows)),
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
    id: 'cloc-1',
    canonicalOrganizationId: 'corg-1',
    name: 'Main Office',
    alternateName: null,
    description: null,
    transportation: null,
    latitude: 47.6062,
    longitude: -122.3321,
    geom: null,
    addressLine1: '123 Main St',
    addressLine2: null,
    addressCity: 'Seattle',
    addressRegion: 'WA',
    addressPostalCode: '98101',
    addressCountry: 'US',
    lifecycleStatus: 'draft',
    publicationStatus: 'unpublished',
    winningSourceSystemId: 'sys-1',
    sourceCount: 1,
    sourceConfidenceSummary: {},
    publishedLocationId: null,
    firstSeenAt: new Date('2026-01-01'),
    lastRefreshedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('canonicalLocationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getById returns first row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleCanonicalLocationStore(db as never);

    expect(await store.getById('cloc-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('listByOrganization returns locations for org', async () => {
    const rows = [makeRow(), makeRow({ id: 'cloc-2', name: 'Branch' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalLocationStore(db as never);

    expect(await store.listByOrganization('corg-1')).toEqual(rows);
  });

  it('listByLifecycle returns matching locations', async () => {
    const rows = [makeRow({ lifecycleStatus: 'active' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalLocationStore(db as never);

    expect(await store.listByLifecycle('active')).toEqual(rows);
  });

  it('listByPublication returns matching locations with offset', async () => {
    const rows = [makeRow({ publicationStatus: 'published' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalLocationStore(db as never);

    expect(await store.listByPublication('published', 50, 10)).toEqual(rows);
  });

  it('listByWinningSource returns locations from a source system', async () => {
    const rows = [makeRow({ winningSourceSystemId: 'sys-1' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalLocationStore(db as never);

    expect(await store.listByWinningSource('sys-1')).toEqual(rows);
  });

  it('create inserts and returns via returning()', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleCanonicalLocationStore(db as never);

    const result = await store.create({
      canonicalOrganizationId: 'corg-1',
      name: 'Main Office',
      latitude: 47.6062,
      longitude: -122.3321,
    } as never);

    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('update omits id and createdAt from set', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleCanonicalLocationStore(db as never);

    await store.update('cloc-1', {
      id: 'ignore-me',
      createdAt: new Date(),
      name: 'Updated Location',
    } as never);

    const set = updateSets[0] as Record<string, unknown>;
    expect(set).not.toHaveProperty('id');
    expect(set).not.toHaveProperty('createdAt');
    expect(set).toHaveProperty('name', 'Updated Location');
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it('updateLifecycleStatus sets status', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleCanonicalLocationStore(db as never);

    await store.updateLifecycleStatus('cloc-1', 'verified');
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('lifecycleStatus', 'verified');
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it('updatePublicationStatus sets status', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleCanonicalLocationStore(db as never);

    await store.updatePublicationStatus('cloc-1', 'published');
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('publicationStatus', 'published');
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it('getByIds returns matching locations for multiple IDs', async () => {
    const rows = [makeRow(), makeRow({ id: 'cloc-2', name: 'Branch' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalLocationStore(db as never);

    const result = await store.getByIds(['cloc-1', 'cloc-2']);
    expect(result).toEqual(rows);
  });

  it('getByIds returns empty array for empty input', async () => {
    const { db } = createMockDb();
    const store = createDrizzleCanonicalLocationStore(db as never);

    const result = await store.getByIds([]);
    expect(result).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
  });
});
