import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleFeedStore } from '../feedStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      return {
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(result)),
        })),
      };
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
    id: 'feed-1',
    sourceRegistryId: 'src-1',
    feedUrl: 'https://example.gov/feed.xml',
    feedType: 'rss',
    displayName: 'County Updates',
    pollIntervalHours: 6,
    lastPolledAt: new Date('2026-01-01T06:00:00.000Z'),
    lastEtag: 'etag-1',
    lastModified: 'Wed, 01 Jan 2026 06:00:00 GMT',
    isActive: true,
    errorCount: 1,
    lastError: 'timeout',
    jurisdictionState: 'WA',
    jurisdictionCounty: 'King',
    ...overrides,
  };
}

function makeFeed(overrides: Record<string, unknown> = {}) {
  return {
    sourceRegistryId: 'src-1',
    feedUrl: 'https://example.gov/feed.xml',
    feedType: 'rss',
    displayName: 'County Updates',
    pollIntervalHours: 6,
    isActive: true,
    errorCount: 0,
    jurisdictionState: 'WA',
    jurisdictionCounty: 'King',
    ...overrides,
  };
}

describe('feedStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds feeds with the expected persistence payload', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleFeedStore(db as never);

    await store.add(makeFeed() as never);

    expect(insertValues).toEqual([
      expect.objectContaining({
        sourceRegistryId: 'src-1',
        feedUrl: 'https://example.gov/feed.xml',
        feedType: 'rss',
        displayName: 'County Updates',
        pollIntervalHours: 6,
        isActive: true,
        jurisdictionState: 'WA',
        jurisdictionCounty: 'King',
      }),
    ]);
  });

  it('updates poll state for both successful and failed polls', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleFeedStore(db as never);

    await store.updateAfterPoll('feed-1', {
      lastPolledAt: '2026-01-01T07:00:00.000Z',
      lastEtag: 'etag-2',
      lastModified: 'Wed, 01 Jan 2026 07:00:00 GMT',
    });
    await store.updateAfterPoll('feed-1', {
      lastPolledAt: '2026-01-01T08:00:00.000Z',
      error: 'server_error',
    });

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        lastPolledAt: expect.any(Date),
        lastEtag: 'etag-2',
        lastModified: 'Wed, 01 Jan 2026 07:00:00 GMT',
        errorCount: 0,
        lastError: null,
        updatedAt: expect.any(Date),
      })
    );

    expect(updateSets[1]).toEqual(
      expect.objectContaining({
        lastPolledAt: expect.any(Date),
        lastError: 'server_error',
        updatedAt: expect.any(Date),
      })
    );
    expect((updateSets[1] as Record<string, unknown>).errorCount).toBeDefined();
    expect((updateSets[1] as Record<string, unknown>).lastEtag).toBeUndefined();
  });

  it('maps rows back into feed subscriptions for due and active listings', async () => {
    const { db } = createMockDb([
      [makeRow()],
      [makeRow({ id: 'feed-2', lastPolledAt: null, lastEtag: null, lastError: null })],
    ]);
    const store = createDrizzleFeedStore(db as never);

    await expect(store.listDueForPoll()).resolves.toEqual([
      expect.objectContaining({
        id: 'feed-1',
        lastPolledAt: '2026-01-01T06:00:00.000Z',
        lastEtag: 'etag-1',
        lastError: 'timeout',
      }),
    ]);
    await expect(store.listActive()).resolves.toEqual([
      expect.objectContaining({
        id: 'feed-2',
        lastPolledAt: undefined,
        lastEtag: undefined,
        lastError: undefined,
      }),
    ]);
  });

  it('deactivates feeds without deleting historical state', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleFeedStore(db as never);

    await store.deactivate('feed-1');

    expect(updateSets).toEqual([
      expect.objectContaining({
        isActive: false,
        updatedAt: expect.any(Date),
      }),
    ]);
  });
});
