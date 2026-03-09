import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrizzleCanonicalConceptStore } from '../canonicalConceptStore';

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
    id: 'concept-1',
    conceptKey: 'food_pantry',
    label: 'Food Pantry',
    description: 'Emergency food distribution sites',
    oranTaxonomyTermId: 'tt-1',
    isActive: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('canonicalConceptStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getById returns row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleCanonicalConceptStore(db as never);

    expect(await store.getById('concept-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('findByKey returns row by concept_key', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row]]);
    const store = createDrizzleCanonicalConceptStore(db as never);

    expect(await store.findByKey('food_pantry')).toEqual(row);
  });

  it('listActive returns active concepts', async () => {
    const rows = [makeRow(), makeRow({ id: 'concept-2', conceptKey: 'shelter' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalConceptStore(db as never);

    expect(await store.listActive()).toEqual(rows);
  });

  it('create inserts and returns row', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleCanonicalConceptStore(db as never);

    const result = await store.create({ conceptKey: 'food_pantry', label: 'Food Pantry' });
    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('update sets fields and updated_at', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleCanonicalConceptStore(db as never);

    await store.update('concept-1', { label: 'Updated Label' } as any);
    expect(updateSets).toHaveLength(1);
    expect((updateSets[0] as Record<string, unknown>).label).toBe('Updated Label');
    expect((updateSets[0] as Record<string, unknown>).updatedAt).toBeInstanceOf(Date);
  });
});
