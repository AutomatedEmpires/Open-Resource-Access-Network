import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrizzleResolutionCandidateStore } from '../resolutionCandidateStore';

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
    id: 'cand-1',
    sourceRecordId: 'sr-1',
    candidateEntityType: 'organization',
    candidateEntityId: 'org-1',
    matchStrategy: 'identifier',
    matchKey: 'ein:12-3456789',
    confidence: 95,
    autoResolved: false,
    status: 'pending',
    createdAt: new Date('2026-01-01'),
    resolvedAt: null,
    resolvedBy: null,
    ...overrides,
  };
}

describe('resolutionCandidateStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getById returns row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleResolutionCandidateStore(db as never);

    expect(await store.getById('cand-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('findBySourceRecord returns candidates for a source record', async () => {
    const rows = [makeRow()];
    const { db } = createMockDb([rows]);
    const store = createDrizzleResolutionCandidateStore(db as never);

    expect(await store.findBySourceRecord('sr-1')).toEqual(rows);
  });

  it('findByEntity returns candidates for a given entity', async () => {
    const rows = [makeRow()];
    const { db } = createMockDb([rows]);
    const store = createDrizzleResolutionCandidateStore(db as never);

    expect(await store.findByEntity('organization', 'org-1')).toEqual(rows);
  });

  it('listByStatus returns matching candidates', async () => {
    const rows = [makeRow(), makeRow({ id: 'cand-2' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleResolutionCandidateStore(db as never);

    expect(await store.listByStatus('pending')).toEqual(rows);
  });

  it('create inserts and returns row', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleResolutionCandidateStore(db as never);

    const result = await store.create({
      candidateEntityType: 'organization',
      candidateEntityId: 'org-1',
      matchStrategy: 'identifier',
      confidence: 95,
    });
    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('update sets fields correctly', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleResolutionCandidateStore(db as never);

    await store.update('cand-1', { status: 'accepted', resolvedBy: 'admin' } as any);
    expect(updateSets).toHaveLength(1);
    expect((updateSets[0] as Record<string, unknown>).status).toBe('accepted');
    expect((updateSets[0] as Record<string, unknown>).resolvedBy).toBe('admin');
  });
});
