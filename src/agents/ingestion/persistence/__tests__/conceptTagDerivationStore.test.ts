import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrizzleConceptTagDerivationStore } from '../conceptTagDerivationStore';

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
    id: 'deriv-1',
    sourceRecordId: 'src-1',
    sourceRegistryId: 'reg-1',
    sourceCode: 'BD-1800',
    crosswalkId: 'cw-1',
    conceptId: 'concept-1',
    derivedTagType: 'category',
    derivedTagValue: 'food_pantry',
    confidence: 95,
    entityType: 'service',
    entityId: 'svc-1',
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('conceptTagDerivationStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('findByEntity returns derivations for entity', async () => {
    const rows = [makeRow(), makeRow({ id: 'deriv-2', derivedTagValue: 'shelter' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleConceptTagDerivationStore(db as never);

    expect(await store.findByEntity('service', 'svc-1')).toEqual(rows);
  });

  it('create inserts and returns row', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleConceptTagDerivationStore(db as never);

    const result = await store.create({
      sourceRegistryId: 'reg-1',
      sourceCode: 'BD-1800',
      crosswalkId: 'cw-1',
      conceptId: 'concept-1',
      derivedTagType: 'category',
      derivedTagValue: 'food_pantry',
      confidence: 95,
      entityType: 'service',
      entityId: 'svc-1',
    });
    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('bulkCreate inserts multiple rows', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleConceptTagDerivationStore(db as never);

    await store.bulkCreate([
      { sourceRegistryId: 'reg-1', sourceCode: 'A', crosswalkId: 'cw-1', conceptId: 'c-1', derivedTagType: 'category', derivedTagValue: 'food', confidence: 100, entityType: 'service', entityId: 'svc-1' },
      { sourceRegistryId: 'reg-1', sourceCode: 'B', crosswalkId: 'cw-2', conceptId: 'c-2', derivedTagType: 'category', derivedTagValue: 'shelter', confidence: 80, entityType: 'service', entityId: 'svc-1' },
    ]);
    expect(insertValues).toHaveLength(1);
    expect((insertValues[0] as unknown[]).length).toBe(2);
  });

  it('bulkCreate skips insert for empty array', async () => {
    const { db } = createMockDb();
    const store = createDrizzleConceptTagDerivationStore(db as never);

    await store.bulkCreate([]);
    expect(db.insert).not.toHaveBeenCalled();
  });
});
