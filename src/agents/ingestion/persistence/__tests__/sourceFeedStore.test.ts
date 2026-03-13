import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleSourceFeedStore } from '../sourceFeedStore';

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
          where: vi.fn(() => Promise.resolve()),
        };
      }),
    })),
  };

  return { db, insertValues, updateSets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'feed-1',
    sourceSystemId: 'sys-1',
    feedName: 'WA 211 HSDS Feed',
    feedType: 'hsds_api',
    feedHandler: 'hsds_api',
    baseUrl: 'https://api.wa211.org/v1',
    healthcheckUrl: null,
    authType: 'api_key',
    profileUri: null,
    jurisdictionScope: {},
    refreshIntervalHours: 24,
    isActive: true,
    lastPolledAt: null,
    lastSuccessAt: null,
    lastError: null,
    errorCount: 0,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('sourceFeedStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getById returns first row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleSourceFeedStore(db as never);

    expect(await store.getById('feed-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('listBySystem returns feeds for given system', async () => {
    const rows = [makeRow(), makeRow({ id: 'feed-2' })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleSourceFeedStore(db as never);

    expect(await store.listBySystem('sys-1')).toEqual(rows);
  });

  it('listDueForPoll returns active feeds past their interval', async () => {
    const rows = [makeRow({ lastPolledAt: new Date('2025-01-01') })];
    const { db } = createMockDb([rows]);
    const store = createDrizzleSourceFeedStore(db as never);

    expect(await store.listDueForPoll()).toEqual(rows);
  });

  it('create inserts and returns the row via returning()', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleSourceFeedStore(db as never);

    const result = await store.create({
      sourceSystemId: 'sys-1',
      feedName: 'WA 211 HSDS Feed',
      feedType: 'hsds_api',
      feedHandler: 'hsds_api',
      baseUrl: 'https://api.wa211.org/v1',
    } as never);

    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('updateAfterPoll resets error state on success', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleSourceFeedStore(db as never);

    await store.updateAfterPoll('feed-1', {
      lastPolledAt: '2026-06-01T00:00:00Z',
      lastSuccessAt: '2026-06-01T00:00:00Z',
    });

    expect(updateSets).toHaveLength(1);
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('errorCount', 0);
    expect(set).toHaveProperty('lastError', null);
    expect(set.lastSuccessAt).toBeInstanceOf(Date);
  });

  it('updateAfterPoll records error without resetting success state', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleSourceFeedStore(db as never);

    await store.updateAfterPoll('feed-1', {
      lastPolledAt: '2026-06-01T00:00:00Z',
      lastError: 'timeout',
      errorCount: 3,
    });

    expect(updateSets).toHaveLength(1);
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('lastError', 'timeout');
    expect(set).toHaveProperty('errorCount', 3);
    expect(set).not.toHaveProperty('lastSuccessAt');
  });

  it('deactivate sets isActive to false', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleSourceFeedStore(db as never);

    await store.deactivate('feed-1');

    expect(updateSets).toHaveLength(1);
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('isActive', false);
    expect(set).toHaveProperty('updatedAt');
  });
});
