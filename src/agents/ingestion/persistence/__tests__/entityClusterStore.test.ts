import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDrizzleEntityClusterStore } from '../entityClusterStore';

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
    id: 'clust-1',
    entityType: 'organization',
    canonicalEntityId: 'org-1',
    label: 'Test Cluster',
    status: 'active',
    confidence: 85,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('entityClusterStore', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('getById returns row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleEntityClusterStore(db as never);

    expect(await store.getById('clust-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('findByCanonicalEntity returns matching clusters', async () => {
    const rows = [makeRow()];
    const { db } = createMockDb([rows]);
    const store = createDrizzleEntityClusterStore(db as never);

    expect(await store.findByCanonicalEntity('organization', 'org-1')).toEqual(rows);
  });

  it('listByStatus returns matching clusters', async () => {
    const rows = [makeRow(), makeRow({ id: 'clust-2' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleEntityClusterStore(db as never);

    expect(await store.listByStatus('active')).toEqual(rows);
  });

  it('create inserts and returns row', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleEntityClusterStore(db as never);

    const result = await store.create({ entityType: 'organization', canonicalEntityId: 'org-1' });
    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('update sets fields and updatedAt', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleEntityClusterStore(db as never);

    await store.update('clust-1', { status: 'merged' } as any);
    expect(updateSets).toHaveLength(1);
    expect((updateSets[0] as Record<string, unknown>).status).toBe('merged');
    expect((updateSets[0] as Record<string, unknown>).updatedAt).toBeInstanceOf(Date);
  });
});
