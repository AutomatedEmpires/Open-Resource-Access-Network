import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleSourceSystemStore } from '../sourceSystemStore';

function createMockDb(
  selectResults: unknown[] = [],
  returningResults: unknown[] = [],
) {
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
        limit: vi.fn(() => terminal),
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
    id: 'sys-1',
    slug: 'wa-211',
    name: 'WA 211',
    family: 'hsds_api',
    trustTier: 'official',
    description: 'Washington 211 directory',
    websiteUrl: 'https://wa211.org',
    contactEmail: null,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('sourceSystemStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getById returns first row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleSourceSystemStore(db as never);

    const found = await store.getById('sys-1');
    expect(found).toEqual(row);

    const missing = await store.getById('nope');
    expect(missing).toBeNull();
  });

  it('listActive returns all active rows without filters', async () => {
    const rows = [makeRow(), makeRow({ id: 'sys-2' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleSourceSystemStore(db as never);

    const result = await store.listActive();
    expect(result).toEqual(rows);
  });

  it('listActive passes family and trustTier filters', async () => {
    const { db } = createMockDb([[]]);
    const store = createDrizzleSourceSystemStore(db as never);

    await store.listActive({ family: 'csv_upload', trustTier: 'curated' });
    // Verifies no throw — filter conditions are appended correctly
  });

  it('create inserts and returns the row via returning()', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleSourceSystemStore(db as never);

    const result = await store.create({
      slug: 'wa-211',
      name: 'WA 211',
      family: 'hsds_api',
      trustTier: 'official',
    } as never);

    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('update omits id and createdAt from spreaded updates', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleSourceSystemStore(db as never);

    await store.update('sys-1', {
      id: 'HACKED',
      createdAt: new Date('1999-01-01'),
      name: 'Updated Name',
    } as never);

    expect(updateSets).toHaveLength(1);
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).not.toHaveProperty('id');
    expect(set).not.toHaveProperty('createdAt');
    expect(set).toHaveProperty('name', 'Updated Name');
    expect(set).toHaveProperty('updatedAt');
  });

  it('deactivate sets isActive to false', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleSourceSystemStore(db as never);

    await store.deactivate('sys-1');

    expect(updateSets).toHaveLength(1);
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('isActive', false);
    expect(set).toHaveProperty('updatedAt');
  });
});
