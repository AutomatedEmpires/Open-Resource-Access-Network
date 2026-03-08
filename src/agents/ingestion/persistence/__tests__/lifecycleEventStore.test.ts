import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleLifecycleEventStore } from '../lifecycleEventStore';

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
  };

  return { db, insertValues };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    entityType: 'organization',
    entityId: 'org-1',
    eventType: 'status_change',
    oldStatus: 'draft',
    newStatus: 'active',
    changedBy: 'system',
    reason: 'Initial publish',
    metadata: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('lifecycleEventStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('create inserts and returns event via returning()', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleLifecycleEventStore(db as never);

    const result = await store.create({
      entityType: 'organization',
      entityId: 'org-1',
      eventType: 'status_change',
      oldStatus: 'draft',
      newStatus: 'active',
      changedBy: 'system',
    } as never);

    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('listByEntity returns events in reverse chronological order', async () => {
    const rows = [
      makeRow({ id: 'evt-2', createdAt: new Date('2026-01-02') }),
      makeRow({ id: 'evt-1', createdAt: new Date('2026-01-01') }),
    ];
    const { db } = createMockDb([rows]);
    const store = createDrizzleLifecycleEventStore(db as never);

    const result = await store.listByEntity('organization', 'org-1');
    expect(result).toEqual(rows);
    expect(result).toHaveLength(2);
  });

  it('listByType returns events filtered by type with limit', async () => {
    const rows = [makeRow()];
    const { db } = createMockDb([rows]);
    const store = createDrizzleLifecycleEventStore(db as never);

    const result = await store.listByType('status_change', 50);
    expect(result).toEqual(rows);
  });

  it('listByEntity returns empty array when no events exist', async () => {
    const { db } = createMockDb([[]]);
    const store = createDrizzleLifecycleEventStore(db as never);

    const result = await store.listByEntity('organization', 'no-events');
    expect(result).toEqual([]);
  });
});
