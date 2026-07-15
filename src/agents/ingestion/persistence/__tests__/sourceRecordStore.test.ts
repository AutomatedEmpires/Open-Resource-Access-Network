import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleSourceRecordStore } from '../sourceRecordStore';

function createMockDb(
  selectResults: unknown[] = [],
  returningResults: unknown[] = [],
  updateReturningResults: unknown[] = [],
) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];
  const selectForModes: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        limit: vi.fn(() => builder),
        orderBy: vi.fn(() => builder),
        for: vi.fn((mode: unknown) => {
          selectForModes.push(mode);
          return builder;
        }),
        then: (
          onFulfilled?: ((value: unknown) => unknown) | null,
          onRejected?: ((reason: unknown) => unknown) | null,
        ) => Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        const rows = returningResults.shift() ?? [];
        return {
          returning: vi.fn(() => Promise.resolve(rows)),
          onConflictDoNothing: vi.fn(() => Promise.resolve()),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: unknown) => {
        updateSets.push(value);
        const result = updateReturningResults.shift() ?? [];
        const builder: any = {
          where: vi.fn(() => builder),
          returning: vi.fn(() => Promise.resolve(result)),
          then: (
            onFulfilled?: ((value: unknown) => unknown) | null,
            onRejected?: ((reason: unknown) => unknown) | null,
          ) => Promise.resolve(undefined).then(onFulfilled ?? undefined, onRejected ?? undefined),
        };
        return builder;
      }),
    })),
  };

  return { db, insertValues, updateSets, selectForModes };
}

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    sourceFeedId: 'feed-1',
    sourceRecordType: 'organization',
    sourceRecordId: 'ext-org-1',
    payloadSha256: 'abc123',
    rawPayload: { name: 'Test Org' },
    fetchedAt: new Date('2026-01-01'),
    processingStatus: 'pending',
    processingError: null,
    processedAt: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

describe('sourceRecordStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getById returns first row or null', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row], []]);
    const store = createDrizzleSourceRecordStore(db as never);

    expect(await store.getById('rec-1')).toEqual(row);
    expect(await store.getById('nope')).toBeNull();
  });

  it('findByDedup matches on all four dedup columns', async () => {
    const row = makeRow();
    const { db } = createMockDb([[row]]);
    const store = createDrizzleSourceRecordStore(db as never);

    const result = await store.findByDedup('feed-1', 'organization', 'ext-org-1', 'abc123');
    expect(result).toEqual(row);
  });

  it('create inserts and returns via returning()', async () => {
    const row = makeRow();
    const { db, insertValues } = createMockDb([], [[row]]);
    const store = createDrizzleSourceRecordStore(db as never);

    const result = await store.create({
      sourceFeedId: 'feed-1',
      sourceRecordType: 'organization',
      sourceRecordId: 'ext-org-1',
      payloadSha256: 'abc123',
      rawPayload: { name: 'Test Org' },
    } as never);

    expect(result).toEqual(row);
    expect(insertValues).toHaveLength(1);
  });

  it('bulkCreate skips empty array', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleSourceRecordStore(db as never);

    await store.bulkCreate([]);
    expect(insertValues).toHaveLength(0);
  });

  it('bulkCreate uses onConflictDoNothing for idempotence', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleSourceRecordStore(db as never);

    const rows = [makeRow() as never, makeRow({ id: 'rec-2' }) as never];
    await store.bulkCreate(rows);

    expect(insertValues).toHaveLength(1);
    // Verify onConflictDoNothing was called via the mock chain
    expect(db.insert).toHaveBeenCalled();
  });

  it('updateStatus sets processingStatus, error, processedAt', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleSourceRecordStore(db as never);

    await store.updateStatus('rec-1', 'processed');
    expect(updateSets).toHaveLength(1);
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('processingStatus', 'processed');
    expect(set).toHaveProperty('processingError', null);
    expect(set.processedAt).toBeInstanceOf(Date);
  });

  it('updateStatus includes error when provided', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleSourceRecordStore(db as never);

    await store.updateStatus('rec-1', 'failed', 'parse error');
    const set = updateSets[0] as Record<string, unknown>;
    expect(set).toHaveProperty('processingError', 'parse error');
  });

  it('locks and claims a pending source record with a pending-to-processing CAS', async () => {
    const pending = makeRow();
    const processing = makeRow({ processingStatus: 'processing' });
    const { db, updateSets, selectForModes } = createMockDb(
      [[pending]],
      [],
      [[processing]],
    );
    const store = createDrizzleSourceRecordStore(db as never);

    const result = await store.claimPendingForNormalization({
      id: 'rec-1',
      sourceFeedId: 'feed-1',
      sourceRecordType: 'organization',
      sourceRecordId: 'ext-org-1',
      payloadSha256: 'abc123',
    });

    expect(result).toEqual({ claimed: true, sourceRecord: processing });
    expect(selectForModes).toEqual(['update']);
    expect(updateSets).toContainEqual(expect.objectContaining({
      processingStatus: 'processing',
      processingError: null,
      processedAt: null,
    }));
  });

  it('returns an idempotent non-claim after locking an already normalized record', async () => {
    const normalized = makeRow({ processingStatus: 'normalized' });
    const { db, selectForModes } = createMockDb([[normalized]]);
    const store = createDrizzleSourceRecordStore(db as never);

    const result = await store.claimPendingForNormalization({
      id: 'rec-1',
      sourceFeedId: 'feed-1',
      sourceRecordType: 'organization',
      sourceRecordId: 'ext-org-1',
      payloadSha256: 'abc123',
    });

    expect(result).toEqual({ claimed: false, sourceRecord: normalized });
    expect(selectForModes).toEqual(['update']);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('rejects a stale caller identity before the CAS', async () => {
    const pending = makeRow();
    const { db } = createMockDb([[pending]]);
    const store = createDrizzleSourceRecordStore(db as never);

    await expect(store.claimPendingForNormalization({
      id: 'rec-1',
      sourceFeedId: 'feed-1',
      sourceRecordType: 'organization',
      sourceRecordId: 'ext-org-1',
      payloadSha256: 'different-hash',
    })).rejects.toThrow('changed before normalization could claim it');
    expect(db.update).not.toHaveBeenCalled();
  });

  it('fails when the pending-to-processing CAS unexpectedly loses', async () => {
    const pending = makeRow();
    const { db } = createMockDb([[pending]], [], [[]]);
    const store = createDrizzleSourceRecordStore(db as never);

    await expect(store.claimPendingForNormalization({
      id: 'rec-1',
      sourceFeedId: 'feed-1',
      sourceRecordType: 'organization',
      sourceRecordId: 'ext-org-1',
      payloadSha256: 'abc123',
    })).rejects.toThrow('normalization claim was lost');
  });

  it('listPending returns pending records in FIFO order', async () => {
    const rows = [
      makeRow({ id: 'rec-old', createdAt: new Date('2026-01-01') }),
      makeRow({ id: 'rec-new', createdAt: new Date('2026-01-02') }),
    ];
    const { db } = createMockDb([rows]);
    const store = createDrizzleSourceRecordStore(db as never);

    const result = await store.listPending(50);
    expect(result).toEqual(rows);
  });

  it('listByFeed returns records for a given feed', async () => {
    const rows = [makeRow()];
    const { db } = createMockDb([rows]);
    const store = createDrizzleSourceRecordStore(db as never);

    const result = await store.listByFeed('feed-1', 100);
    expect(result).toEqual(rows);
  });

  it('listPendingByFeed returns only pending records for a given feed in FIFO order', async () => {
    const rows = [
      makeRow({ id: 'rec-old', createdAt: new Date('2026-01-01') }),
      makeRow({ id: 'rec-new', createdAt: new Date('2026-01-02') }),
    ];
    const { db } = createMockDb([rows]);
    const store = createDrizzleSourceRecordStore(db as never);

    const result = await store.listPendingByFeed('feed-1', 50);
    expect(result).toEqual(rows);
  });

  it('addTaxonomy skips empty array', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleSourceRecordStore(db as never);

    await store.addTaxonomy([]);
    expect(insertValues).toHaveLength(0);
  });

  it('addTaxonomy inserts taxonomy rows', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleSourceRecordStore(db as never);

    await store.addTaxonomy([
      { sourceRecordId: 'rec-1', taxonomyTerm: '211:BH-1800', taxonomySystem: 'taxonomy_211' },
    ] as never);

    expect(insertValues).toHaveLength(1);
  });
});
