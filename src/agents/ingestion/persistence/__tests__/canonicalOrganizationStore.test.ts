import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleCanonicalOrganizationStore } from '../canonicalOrganizationStore';

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
    id: 'corg-1',
    name: 'Test Organization',
    alternateName: null,
    description: 'A test org',
    url: 'https://example.org',
    email: 'info@example.org',
    phone: null,
    taxStatus: null,
    taxId: null,
    yearIncorporated: null,
    legalStatus: null,
    lifecycleStatus: 'draft',
    publicationStatus: 'unpublished',
    winningSourceSystemId: 'sys-1',
    sourceCount: 1,
    sourceConfidenceSummary: {},
    publishedOrganizationId: null,
    firstSeenAt: new Date('2026-01-01'),
    lastRefreshedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('canonicalOrganizationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getById returns first row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleCanonicalOrganizationStore(db as never);

    expect(await store.getById('corg-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('listByLifecycle returns matching orgs', async () => {
    const rows = [makeRow(), makeRow({ id: 'corg-2' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalOrganizationStore(db as never);

    expect(await store.listByLifecycle('draft')).toEqual(rows);
  });

  it('listByPublication returns matching orgs with offset', async () => {
    const rows = [makeRow({ publicationStatus: 'published' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalOrganizationStore(db as never);

    expect(await store.listByPublication('published', 50, 10)).toEqual(rows);
  });

  it('listByWinningSource returns orgs from a source system', async () => {
    const rows = [makeRow({ winningSourceSystemId: 'sys-1' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalOrganizationStore(db as never);

    expect(await store.listByWinningSource('sys-1')).toEqual(rows);
  });

  it('create inserts and returns via returning()', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleCanonicalOrganizationStore(db as never);

    const result = await store.create({
      name: 'Test Organization',
    } as never);

    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('update omits id and createdAt from set', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleCanonicalOrganizationStore(db as never);

    await store.update('corg-1', {
      id: 'ignore-me',
      createdAt: new Date(),
      name: 'Updated Name',
    } as never);

    const set = updateSets[0] as Record<string, unknown>;
    expect(set).not.toHaveProperty('id');
    expect(set).not.toHaveProperty('createdAt');
    expect(set).toHaveProperty('name', 'Updated Name');
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it('updateLifecycleStatus sets status', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleCanonicalOrganizationStore(db as never);

    await store.updateLifecycleStatus('corg-1', 'verified');
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('lifecycleStatus', 'verified');
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it('updatePublicationStatus sets status', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleCanonicalOrganizationStore(db as never);

    await store.updatePublicationStatus('corg-1', 'published');
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('publicationStatus', 'published');
    expect(set.updatedAt).toBeInstanceOf(Date);
  });
});
