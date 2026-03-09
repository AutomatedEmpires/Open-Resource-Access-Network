import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrizzleResolutionDecisionStore } from '../resolutionDecisionStore';

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
        };
      }),
    })),
  };

  return { db, insertValues };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dec-1',
    resolutionCandidateId: 'cand-1',
    sourceRecordId: 'sr-1',
    entityType: 'organization',
    entityId: 'org-1',
    decision: 'accept',
    matchStrategy: 'identifier',
    matchConfidence: 95,
    rationale: 'Exact EIN match',
    decidedBy: 'system',
    decidedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('resolutionDecisionStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getById returns row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleResolutionDecisionStore(db as never);

    expect(await store.getById('dec-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('findBySourceRecord returns decisions for a source record', async () => {
    const rows = [makeRow()];
    const { db } = createMockDb([rows]);
    const store = createDrizzleResolutionDecisionStore(db as never);

    expect(await store.findBySourceRecord('sr-1')).toEqual(rows);
  });

  it('findByEntity returns decisions for a given entity', async () => {
    const rows = [makeRow(), makeRow({ id: 'dec-2', decision: 'reject' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleResolutionDecisionStore(db as never);

    expect(await store.findByEntity('organization', 'org-1')).toEqual(rows);
  });

  it('create inserts and returns row', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleResolutionDecisionStore(db as never);

    const result = await store.create({
      entityType: 'organization',
      entityId: 'org-1',
      decision: 'accept',
    });
    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });
});
