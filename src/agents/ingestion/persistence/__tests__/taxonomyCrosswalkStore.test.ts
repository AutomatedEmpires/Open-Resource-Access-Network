import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrizzleTaxonomyCrosswalkStore } from '../taxonomyCrosswalkStore';

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
    id: 'cw-1',
    sourceRegistryId: 'reg-1',
    sourceCode: 'BD-1800',
    targetConceptId: 'concept-1',
    matchType: 'exact',
    confidence: 95,
    notes: null,
    createdBy: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('taxonomyCrosswalkStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getById returns row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleTaxonomyCrosswalkStore(db as never);

    expect(await store.getById('cw-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('findBySourceCode returns matching crosswalks', async () => {
    const rows = [makeRow(), makeRow({ id: 'cw-2', targetConceptId: 'concept-2', matchType: 'broader' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleTaxonomyCrosswalkStore(db as never);

    expect(await store.findBySourceCode('reg-1', 'BD-1800')).toEqual(rows);
  });

  it('findExact returns single matching crosswalk', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row]]);
    const store = createDrizzleTaxonomyCrosswalkStore(db as never);

    expect(await store.findExact('reg-1', 'BD-1800', 'concept-1')).toEqual(row);
  });

  it('create inserts and returns row', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleTaxonomyCrosswalkStore(db as never);

    const result = await store.create({
      sourceRegistryId: 'reg-1',
      sourceCode: 'BD-1800',
      targetConceptId: 'concept-1',
    });
    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('bulkCreate inserts multiple rows', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleTaxonomyCrosswalkStore(db as never);

    await store.bulkCreate([
      { sourceRegistryId: 'reg-1', sourceCode: 'A', targetConceptId: 'c-1' },
      { sourceRegistryId: 'reg-1', sourceCode: 'B', targetConceptId: 'c-2' },
    ]);
    expect(insertValues).toHaveLength(1);
    expect((insertValues[0] as unknown[]).length).toBe(2);
  });

  it('bulkCreate skips insert for empty array', async () => {
    const { db } = createMockDb();
    const store = createDrizzleTaxonomyCrosswalkStore(db as never);

    await store.bulkCreate([]);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
