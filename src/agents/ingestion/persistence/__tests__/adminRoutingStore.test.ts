import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleAdminRoutingStore } from '../adminRoutingStore';

function createMockDb(selectResults: unknown[] = []) {
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
        orderBy: vi.fn(() => terminal),
        then: terminal.then,
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        return Promise.resolve();
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
    id: 'route-1',
    jurisdictionCountry: 'US',
    jurisdictionState: null,
    jurisdictionCounty: null,
    assignedRole: 'community_admin',
    assignedUserId: null,
    priority: 10,
    isActive: true,
    ...overrides,
  };
}

describe('adminRoutingStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds the most specific matching rule and skips mismatched requirements', async () => {
    const { db } = createMockDb([
      [
        makeRow({ id: 'country-only', priority: 100 }),
        makeRow({ id: 'state-only', jurisdictionState: 'WA', priority: 50 }),
        makeRow({ id: 'county-specific', jurisdictionState: 'WA', jurisdictionCounty: 'King', priority: 1 }),
        makeRow({ id: 'mismatch-state', jurisdictionState: 'OR', priority: 999 }),
        makeRow({ id: 'mismatch-county', jurisdictionState: 'WA', jurisdictionCounty: 'Pierce', priority: 999 }),
      ],
      [
        makeRow({ id: 'country-only-2', priority: 5 }),
        makeRow({ id: 'needs-state', jurisdictionState: 'WA', priority: 99 }),
      ],
    ]);
    const store = createDrizzleAdminRoutingStore(db as never);

    await expect(store.findBestMatch('US', 'WA', 'King')).resolves.toEqual(
      expect.objectContaining({
        id: 'county-specific',
        jurisdictionCountry: 'US',
        jurisdictionState: 'WA',
        jurisdictionCounty: 'King',
      }),
    );
    await expect(store.findBestMatch('US')).resolves.toEqual(
      expect.objectContaining({
        id: 'country-only-2',
        jurisdictionState: undefined,
        jurisdictionCounty: undefined,
      }),
    );
  });

  it('returns null when no matching active rule exists and lists active rules with mapped optionals', async () => {
    const { db } = createMockDb([
      [],
      [
        makeRow({ id: 'route-a', assignedUserId: 'user-1', jurisdictionState: 'WA', jurisdictionCounty: 'King' }),
        makeRow({ id: 'route-b', assignedRole: 'oran_admin', assignedUserId: null }),
      ],
    ]);
    const store = createDrizzleAdminRoutingStore(db as never);

    await expect(store.findBestMatch('US', 'WA', 'King')).resolves.toBeNull();
    await expect(store.listActive()).resolves.toEqual([
      expect.objectContaining({
        id: 'route-a',
        assignedUserId: 'user-1',
        jurisdictionState: 'WA',
        jurisdictionCounty: 'King',
      }),
      expect.objectContaining({
        id: 'route-b',
        assignedUserId: undefined,
        jurisdictionState: undefined,
        jurisdictionCounty: undefined,
      }),
    ]);
  });

  it('updates existing rules and inserts new rules through upsert', async () => {
    const { db, insertValues, updateSets } = createMockDb();
    const store = createDrizzleAdminRoutingStore(db as never);

    await store.upsert({
      id: 'route-1',
      jurisdictionCountry: 'US',
      jurisdictionState: 'WA',
      jurisdictionCounty: 'King',
      assignedRole: 'community_admin',
      assignedUserId: 'user-9',
      priority: 20,
      isActive: false,
    });

    await store.upsert({
      jurisdictionCountry: 'US',
      assignedRole: 'oran_admin',
      priority: 5,
      isActive: true,
    });

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        jurisdictionCountry: 'US',
        jurisdictionState: 'WA',
        jurisdictionCounty: 'King',
        assignedRole: 'community_admin',
        assignedUserId: 'user-9',
        priority: 20,
        isActive: false,
        updatedAt: expect.any(Date),
      }),
    );
    expect(insertValues[0]).toEqual(
      expect.objectContaining({
        jurisdictionCountry: 'US',
        jurisdictionState: undefined,
        jurisdictionCounty: undefined,
        assignedRole: 'oran_admin',
        assignedUserId: undefined,
        priority: 5,
        isActive: true,
      }),
    );
  });
});
