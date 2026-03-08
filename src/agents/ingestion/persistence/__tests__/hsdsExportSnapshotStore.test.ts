import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleHsdsExportSnapshotStore } from '../hsdsExportSnapshotStore';

function createMockDb(selectResults: unknown[] = [], returningResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const terminal: any = {
        offset: vi.fn(() => Promise.resolve(result)),
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
        offset: terminal.offset,
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
          where: vi.fn(() => Promise.resolve({ rowCount: 1 })),
        };
      }),
    })),
  };

  return { db, insertValues, updateSets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'snap-1',
    entityType: 'organization',
    entityId: 'org-1',
    snapshotVersion: 1,
    hsdsPayload: { id: 'org-1', name: 'Test' },
    status: 'current',
    generatedAt: new Date('2026-01-01'),
    withdrawnAt: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('hsdsExportSnapshotStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getCurrent returns latest current snapshot or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleHsdsExportSnapshotStore(db as never);

    expect(await store.getCurrent('organization', 'org-1')).toEqual(row);
    expect(await store.getCurrent('organization', 'nope')).toBeNull();
  });

  it('create supersedes existing current snapshot before inserting new one', async () => {
    const newRow = makeRow({ id: 'snap-2', snapshotVersion: 2 });
    const { db, updateSets, insertValues } = createMockDb([], [[newRow]]);
    const store = createDrizzleHsdsExportSnapshotStore(db as never);

    const result = await store.create({
      entityType: 'organization',
      entityId: 'org-1',
      snapshotVersion: 2,
      hsdsPayload: { id: 'org-1', name: 'Updated' },
      status: 'current',
    } as never);

    // Must supersede existing before inserting
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).toEqual(expect.objectContaining({ status: 'superseded' }));

    expect(insertValues).toHaveLength(1);
    expect(result).toEqual(newRow);
  });

  it('withdrawForEntity returns affected row count', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleHsdsExportSnapshotStore(db as never);

    const count = await store.withdrawForEntity('organization', 'org-1');

    expect(count).toBe(1);
    expect(updateSets).toHaveLength(1);
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('status', 'withdrawn');
    expect(set.withdrawnAt).toBeInstanceOf(Date);
  });

  it('listCurrent returns paginated current snapshots', async () => {
    const rows = [makeRow(), makeRow({ id: 'snap-2' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleHsdsExportSnapshotStore(db as never);

    const result = await store.listCurrent(50, 0);
    expect(result).toEqual(rows);
  });
});
