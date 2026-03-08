import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleEntityIdentifierStore } from '../entityIdentifierStore';

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
          where: vi.fn(() => Promise.resolve({ rowCount: 2 })),
        };
      }),
    })),
  };

  return { db, insertValues, updateSets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eid-1',
    entityType: 'organization',
    entityId: 'org-1',
    sourceSystemId: 'sys-1',
    identifierScheme: 'hsds_org_id',
    identifierValue: 'ext-org-001',
    status: 'active',
    statusChangedAt: new Date('2026-01-01'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('entityIdentifierStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listByEntity returns all identifiers for a given entity', async () => {
    const rows = [makeRow(), makeRow({ id: 'eid-2', identifierScheme: 'ein' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleEntityIdentifierStore(db as never);

    const result = await store.listByEntity('organization', 'org-1');
    expect(result).toEqual(rows);
  });

  it('findByScheme returns first match or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleEntityIdentifierStore(db as never);

    expect(await store.findByScheme('hsds_org_id', 'ext-org-001')).toEqual(row);
    expect(await store.findByScheme('hsds_org_id', 'nope')).toBeNull();
  });

  it('create inserts and returns via returning()', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleEntityIdentifierStore(db as never);

    const result = await store.create({
      entityType: 'organization',
      entityId: 'org-1',
      sourceSystemId: 'sys-1',
      identifierScheme: 'hsds_org_id',
      identifierValue: 'ext-org-001',
    } as never);

    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('updateStatusForEntity returns affected row count', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleEntityIdentifierStore(db as never);

    const count = await store.updateStatusForEntity('organization', 'org-1', 'deprecated');

    expect(count).toBe(2);
    expect(updateSets).toHaveLength(1);
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('status', 'deprecated');
    expect(set.statusChangedAt).toBeInstanceOf(Date);
    expect(set.updatedAt).toBeInstanceOf(Date);
  });
});
