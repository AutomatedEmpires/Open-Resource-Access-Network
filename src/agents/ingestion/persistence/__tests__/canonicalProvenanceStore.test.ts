import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleCanonicalProvenanceStore } from '../canonicalProvenanceStore';

function createMockDb(
  selectResults: unknown[] = [],
  returningResults: unknown[] = [],
  updateRowCount = 0,
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
        orderBy: vi.fn(() => builder),
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
          where: vi.fn(() => Promise.resolve({ rowCount: updateRowCount })),
        };
      }),
    })),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      // The transaction callback receives the same db object as `tx`
      return fn(db);
    }),
  };

  return { db, insertValues, updateSets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prov-1',
    canonicalEntityType: 'organization',
    canonicalEntityId: 'corg-1',
    fieldName: 'name',
    assertedValue: { value: 'Test Org' },
    sourceRecordId: 'rec-1',
    evidenceId: null,
    selectorOrHint: null,
    confidenceHint: 85,
    decisionStatus: 'candidate',
    decidedBy: null,
    decidedAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('canonicalProvenanceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listByEntity returns all provenance for entity', async () => {
    const rows = [makeRow(), makeRow({ id: 'prov-2', fieldName: 'description' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleCanonicalProvenanceStore(db as never);

    expect(await store.listByEntity('organization', 'corg-1')).toEqual(rows);
  });

  it('getAcceptedForField returns accepted row or null', async () => {
    const row = makeRow({ decisionStatus: 'accepted' });
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleCanonicalProvenanceStore(db as never);

    expect(await store.getAcceptedForField('organization', 'corg-1', 'name')).toEqual(row);
    expect(await store.getAcceptedForField('organization', 'corg-1', 'missing')).toBeNull();
  });

  it('create inserts and returns via returning()', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleCanonicalProvenanceStore(db as never);

    const result = await store.create({
      canonicalEntityType: 'organization',
      canonicalEntityId: 'corg-1',
      fieldName: 'name',
      assertedValue: { value: 'Test Org' },
      sourceRecordId: 'rec-1',
      sourceSystemId: 'sys-1',
      confidenceHint: 85,
    } as never);

    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('bulkCreate skips empty array', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleCanonicalProvenanceStore(db as never);

    await store.bulkCreate([]);
    expect(insertValues).toHaveLength(0);
  });

  it('bulkCreate inserts multiple rows', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleCanonicalProvenanceStore(db as never);

    await store.bulkCreate([
      makeRow() as never,
      makeRow({ id: 'prov-2' }) as never,
    ]);

    expect(insertValues).toHaveLength(1);
    expect(db.insert).toHaveBeenCalled();
  });

  it('updateDecision sets decisionStatus and timestamps', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleCanonicalProvenanceStore(db as never);

    await store.updateDecision('prov-1', 'accepted', 'admin-1');
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('decisionStatus', 'accepted');
    expect(set).toHaveProperty('decidedBy', 'admin-1');
    expect(set.decidedAt).toBeInstanceOf(Date);
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it('updateDecision defaults decidedBy to null', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleCanonicalProvenanceStore(db as never);

    await store.updateDecision('prov-1', 'rejected');
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('decidedBy', null);
  });

  it('supersedeField returns count of superseded rows', async () => {
    const { db } = createMockDb([], [], 3);
    const store = createDrizzleCanonicalProvenanceStore(db as never);

    const count = await store.supersedeField('organization', 'corg-1', 'name');
    expect(count).toBe(3);
  });

  it('supersedeField returns 0 when no rows matched', async () => {
    const { db } = createMockDb([], [], 0);
    const store = createDrizzleCanonicalProvenanceStore(db as never);

    const count = await store.supersedeField('organization', 'corg-1', 'description');
    expect(count).toBe(0);
  });

  it('acceptField supersedes then accepts inside a transaction', async () => {
    const { db, updateSets } = createMockDb([], [], 2);
    const store = createDrizzleCanonicalProvenanceStore(db as never);

    const result = await store.acceptField('prov-2', 'organization', 'corg-1', 'name', 'admin-1');

    expect(result.supersededCount).toBe(2);
    expect(db.transaction).toHaveBeenCalledOnce();
    // First update: supersede existing accepted records
    expect(updateSets[0]).toHaveProperty('decisionStatus', 'superseded');
    // Second update: accept the new record
    expect(updateSets[1]).toHaveProperty('decisionStatus', 'accepted');
    expect(updateSets[1]).toHaveProperty('decidedBy', 'admin-1');
  });
});
