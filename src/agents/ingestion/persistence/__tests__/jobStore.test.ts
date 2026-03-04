import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDrizzleJobStore } from '../jobStore';

function createMockDb(selectResults: unknown[] = []) {
  const insertValues: unknown[] = [];
  const updateSets: unknown[] = [];

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? [];
      const builder: any = {
        from: vi.fn(() => builder),
        where: vi.fn(() => builder),
        orderBy: vi.fn(() => builder),
        limit: vi.fn(() => Promise.resolve(result)),
        then: (onFulfilled?: ((value: unknown) => unknown) | null, onRejected?: ((reason: unknown) => unknown) | null) =>
          Promise.resolve(result).then(onFulfilled ?? undefined, onRejected ?? undefined),
      };
      return builder;
    }),
    insert: vi.fn(() => ({
      values: vi.fn((value: unknown) => {
        insertValues.push(value);
        return {
          then: (onFulfilled: ((value: void) => unknown) | null | undefined, onRejected?: ((reason: unknown) => unknown) | null | undefined) =>
            Promise.resolve().then(onFulfilled, onRejected),
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
    id: 'job-1',
    correlationId: 'corr-1',
    jobType: 'seed_crawl',
    sourceId: 'src-1',
    seedUrl: 'https://example.gov/feed',
    status: 'queued',
    priority: 0,
    maxUrls: 100,
    currentDepth: 0,
    statsUrlsDiscovered: 2,
    statsUrlsFetched: 1,
    statsCandidatesExtracted: 1,
    statsCandidatesVerified: 0,
    statsErrorsCount: 0,
    errorMessage: null,
    startedAt: new Date('2026-01-01T00:01:00.000Z'),
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:02:00.000Z'),
    ...overrides,
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    correlationId: 'corr-1',
    jobType: 'seed_crawl',
    status: 'queued',
    seedUrls: ['https://example.gov/feed'],
    urlsDiscovered: 2,
    urlsFetched: 1,
    candidatesExtracted: 1,
    candidatesVerified: 0,
    errorsCount: 0,
    queuedAt: '2026-01-01T00:00:00.000Z',
    startedAt: '2026-01-01T00:01:00.000Z',
    completedAt: undefined,
    agentId: 'oran-ingestion-agent/1.0',
    ...overrides,
  };
}

describe('jobStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates jobs with the expected legacy DB field names', async () => {
    const { db, insertValues } = createMockDb();
    const store = createDrizzleJobStore(db as never);

    await store.create(makeJob() as never);

    expect(insertValues).toEqual([
      expect.objectContaining({
        id: 'job-1',
        correlationId: 'corr-1',
        jobType: 'seed_crawl',
        status: 'queued',
        seedUrl: 'https://example.gov/feed',
        statsUrlsDiscovered: 2,
        statsUrlsFetched: 1,
        statsCandidatesExtracted: 1,
        statsCandidatesVerified: 0,
        statsErrorsCount: 0,
        priority: 0,
        startedAt: expect.any(Date),
      }),
    ]);
  });

  it('maps rows back into domain jobs for id and correlation lookups', async () => {
    const { db } = createMockDb([[makeRow()], []]);
    const store = createDrizzleJobStore(db as never);

    await expect(store.getById('job-1')).resolves.toEqual(
      expect.objectContaining({
        id: 'job-1',
        correlationId: 'corr-1',
        seedUrls: ['https://example.gov/feed'],
        urlsDiscovered: 2,
        urlsFetched: 1,
      }),
    );
    await expect(store.getByCorrelationId('missing')).resolves.toBeNull();
  });

  it('updates job status fields and lists jobs by status', async () => {
    const { db, updateSets } = createMockDb([[makeRow({ status: 'running' })]]);
    const store = createDrizzleJobStore(db as never);

    await store.update(
      makeJob({
        status: 'running',
        completedAt: '2026-01-01T00:03:00.000Z',
        errorsCount: 1,
      }) as never,
    );

    const listed = await store.listByStatus('running', 25);

    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        status: 'running',
        statsErrorsCount: 1,
        completedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(listed).toEqual([
      expect.objectContaining({
        status: 'running',
        id: 'job-1',
      }),
    ]);
  });

  it('dequeues the oldest queued job and marks it running', async () => {
    const { db, updateSets } = createMockDb([[makeRow({ status: 'queued' })], []]);
    const store = createDrizzleJobStore(db as never);

    const dequeued = await store.dequeueNext();
    const noneLeft = await store.dequeueNext();

    expect(dequeued).toEqual(
      expect.objectContaining({
        id: 'job-1',
        status: 'running',
        startedAt: expect.any(String),
      }),
    );
    expect(updateSets[0]).toEqual(
      expect.objectContaining({
        status: 'running',
        startedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(noneLeft).toBeNull();
  });

  it('increments only the counters provided for a job', async () => {
    const { db, updateSets } = createMockDb();
    const store = createDrizzleJobStore(db as never);

    await store.incrementStats('job-1', {
      urlsDiscovered: 3,
      candidatesExtracted: 2,
    });

    const setClause = updateSets[0] as Record<string, unknown>;

    expect(setClause.updatedAt).toBeInstanceOf(Date);
    expect(setClause.statsUrlsDiscovered).toBeDefined();
    expect(setClause.statsCandidatesExtracted).toBeDefined();
    expect(setClause.statsUrlsFetched).toBeUndefined();
    expect(setClause.statsCandidatesVerified).toBeUndefined();
    expect(setClause.statsErrorsCount).toBeUndefined();
  });
});
