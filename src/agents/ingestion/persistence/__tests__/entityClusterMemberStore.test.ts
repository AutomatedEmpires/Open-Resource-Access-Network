import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrizzleEntityClusterMemberStore } from '../entityClusterMemberStore';

function createMockDb(selectResults: unknown[] = [], returningResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  let deleteRowCount = 0;

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
    delete: vi.fn(() => ({
      where: vi.fn(() => Promise.resolve({ rowCount: deleteRowCount })),
    })),
  };

  function setDeleteRowCount(n: number) { deleteRowCount = n; }

  return { db, insertValues, setDeleteRowCount };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mem-1',
    clusterId: 'clust-1',
    entityType: 'organization',
    entityId: 'org-1',
    role: 'member',
    addedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('entityClusterMemberStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('findByCluster returns members of a cluster', async () => {
    const rows = [makeRow(), makeRow({ id: 'mem-2', entityId: 'org-2' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleEntityClusterMemberStore(db as never);

    expect(await store.findByCluster('clust-1')).toEqual(rows);
  });

  it('findByEntity returns memberships for a given entity', async () => {
    const rows = [makeRow()];
    const { db } = createMockDb([rows]);
    const store = createDrizzleEntityClusterMemberStore(db as never);

    expect(await store.findByEntity('organization', 'org-1')).toEqual(rows);
  });

  it('create inserts and returns row', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleEntityClusterMemberStore(db as never);

    const result = await store.create({ clusterId: 'clust-1', entityType: 'organization', entityId: 'org-1' });
    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('deleteByCluster returns count of deleted rows', async () => {
    const { db, setDeleteRowCount } = createMockDb();
    setDeleteRowCount(3);
    const store = createDrizzleEntityClusterMemberStore(db as never);

    const count = await store.deleteByCluster('clust-1');
    expect(count).toBe(3);
  });
});
