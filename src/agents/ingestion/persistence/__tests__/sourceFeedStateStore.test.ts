import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleSourceFeedStateStore } from '../sourceFeedStateStore';

function createMockDb(selectResults: unknown[] = [], returningResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];
  const conflictSets: unknown[] = [];

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
        return {
          onConflictDoUpdate: vi.fn((value: unknown) => {
            conflictSets.push(value);
            const rows = returningResults.shift() ?? [];
            return {
              returning: vi.fn(() => Promise.resolve(rows)),
            };
          }),
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

  return { db, insertValues, updateSets, conflictSets };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    sourceFeedId: 'feed-1',
    publicationMode: 'review_required',
    emergencyPause: false,
    includedDataOwners: [],
    excludedDataOwners: [],
    maxOrganizationsPerPoll: null,
    checkpointCursor: null,
    replayFromCursor: null,
    lastAttemptStatus: 'idle',
    lastAttemptStartedAt: null,
    lastAttemptCompletedAt: null,
    lastSuccessfulSyncStartedAt: null,
    lastSuccessfulSyncCompletedAt: null,
    lastAttemptSummary: {},
    notes: null,
    createdAt: new Date('2026-03-13T00:00:00Z'),
    updatedAt: new Date('2026-03-13T00:00:00Z'),
    ...overrides,
  };
}

describe('sourceFeedStateStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getByFeedId returns first row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleSourceFeedStateStore(db as never);

    expect(await store.getByFeedId('feed-1')).toEqual(row);
    expect(await store.getByFeedId('feed-2')).toBeNull();
  });

  it('upsert inserts and returns the current row', async () => {
    const row = makeRow({ publicationMode: 'auto_publish' });
    const { db, insertValues, conflictSets } = createMockDb([], [[row]]);
    const store = createDrizzleSourceFeedStateStore(db as never);

    const result = await store.upsert({
      sourceFeedId: 'feed-1',
      publicationMode: 'auto_publish',
      emergencyPause: false,
      includedDataOwners: ['211ventura'],
      excludedDataOwners: [],
    } as never);

    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
    expect(conflictSets).toHaveLength(1);
  });

  it('update applies partial changes and stamps updatedAt', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleSourceFeedStateStore(db as never);

    await store.update('feed-1', {
      emergencyPause: true,
      lastAttemptStatus: 'failed',
    });

    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('emergencyPause', true);
    expect(set).toHaveProperty('lastAttemptStatus', 'failed');
    expect(set.updatedAt).toBeInstanceOf(Date);
  });
});
