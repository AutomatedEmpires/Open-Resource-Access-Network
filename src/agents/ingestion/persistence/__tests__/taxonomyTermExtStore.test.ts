import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrizzleTaxonomyTermExtStore } from '../taxonomyTermExtStore';

function createMockDb(selectResults: unknown[] = [], returningResults: unknown[] = []) {
  const insertValues: unknown[] = [];

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
        limit: vi.fn(() => builder),
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
          then: (
            onFulfilled?: ((value: unknown) => unknown) | null,
            onRejected?: ((reason: unknown) => unknown) | null,
          ) => Promise.resolve().then(onFulfilled ?? undefined, onRejected ?? undefined),
        };
      }),
    })),
  };

  return { db, insertValues };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'term-1',
    registryId: 'reg-1',
    code: 'BD-1800.2000',
    term: 'Food Pantries',
    parentCode: 'BD-1800',
    description: 'Emergency food distribution',
    uri: null,
    depth: 2,
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('taxonomyTermExtStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getById returns row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleTaxonomyTermExtStore(db as never);

    expect(await store.getById('term-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('findByRegistryAndCode returns matching term', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row]]);
    const store = createDrizzleTaxonomyTermExtStore(db as never);

    expect(await store.findByRegistryAndCode('reg-1', 'BD-1800.2000')).toEqual(row);
  });

  it('listByRegistry returns all terms for registry', async () => {
    const rows = [makeRow(), makeRow({ id: 'term-2', code: 'BD-1800.3000' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleTaxonomyTermExtStore(db as never);

    expect(await store.listByRegistry('reg-1')).toEqual(rows);
  });

  it('create inserts and returns row', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleTaxonomyTermExtStore(db as never);

    const result = await store.create({ registryId: 'reg-1', code: 'BD-1800.2000', term: 'Food Pantries' });
    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('bulkCreate inserts multiple rows', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleTaxonomyTermExtStore(db as never);

    await store.bulkCreate([
      { registryId: 'reg-1', code: 'A', term: 'Term A' },
      { registryId: 'reg-1', code: 'B', term: 'Term B' },
    ]);
    expect(insertValues).toHaveLength(1);
    expect((insertValues[0] as unknown[]).length).toBe(2);
  });

  it('bulkCreate skips insert for empty array', async () => {
    const { db } = createMockDb();
    const store = createDrizzleTaxonomyTermExtStore(db as never);

    await store.bulkCreate([]);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
