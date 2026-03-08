import { beforeEach, describe, expect, it, vi } from 'vitest';

const processUrlMock = vi.hoisted(() => vi.fn());
const processUrlDetailedMock = vi.hoisted(() => vi.fn());
const createPipelineOrchestratorMock = vi.hoisted(() => vi.fn(() => ({
  processUrl: processUrlMock,
  processUrlDetailed: processUrlDetailedMock,
})));
const createIngestionJobMock = vi.hoisted(() => vi.fn());
const materializePipelineArtifactsMock = vi.hoisted(() => vi.fn());

vi.mock('../pipeline/orchestrator', () => ({
  createPipelineOrchestrator: createPipelineOrchestratorMock,
}));
vi.mock('../jobs', () => ({
  createIngestionJob: createIngestionJobMock,
}));
vi.mock('../materialize', () => ({
  materializePipelineArtifacts: materializePipelineArtifactsMock,
}));

async function loadServiceModule() {
  return import('../service');
}

function createStores() {
  return {
    sourceRegistry: {
      findForUrl: vi.fn(),
      listActive: vi.fn(),
    },
    jobs: {
      create: vi.fn(),
      update: vi.fn(),
    },
    audit: {
      append: vi.fn(),
    },
    feeds: {
      listDueForPoll: vi.fn(),
      updateAfterPoll: vi.fn(),
    },
    candidates: {
      listDueForReverify: vi.fn(),
    },
    assignments: {
      listOverdue: vi.fn(),
      updateStatus: vi.fn(),
    },
  };
}

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    correlationId: 'job-corr-1',
    sourceRegistryId: 'src-1',
    jobType: 'seed_crawl',
    status: 'queued',
    seedUrls: ['https://example.gov/feed'],
    urlsDiscovered: 0,
    urlsFetched: 0,
    candidatesExtracted: 0,
    candidatesVerified: 0,
    errorsCount: 0,
    queuedAt: '2026-01-01T00:00:00.000Z',
    agentId: 'oran-ingestion-agent/1.0',
    ...overrides,
  };
}

function makePipelineResult(overrides: Record<string, unknown> = {}) {
  return {
    sourceUrl: 'https://example.gov/feed',
    canonicalUrl: 'https://example.gov/feed',
    correlationId: 'pipe-corr-1',
    status: 'completed',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:05.000Z',
    totalDurationMs: 5000,
    stages: [
      {
        stage: 'source_check',
        status: 'completed',
        metrics: {},
      },
      {
        stage: 'build_candidate',
        status: 'completed',
        metrics: {},
      },
    ],
    finalStage: 'build_candidate',
    sourceCheck: {
      allowed: true,
      trustLevel: 'allowlisted',
      sourceId: 'src-1',
    },
    evidenceId: 'ev-1',
    extractionId: 'ext-1',
    candidateId: 'cand-1',
    confidenceScore: 88,
    confidenceTier: 'green',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  createIngestionJobMock.mockReturnValue(makeJob());
  processUrlMock.mockResolvedValue(makePipelineResult());
  processUrlDetailedMock.mockResolvedValue({
    result: makePipelineResult(),
    artifacts: {},
  });
  materializePipelineArtifactsMock.mockResolvedValue({
    candidateId: 'cand-1',
    evidenceId: 'ev-1',
    deduped: false,
    assignedToRole: 'community_admin',
    reviewStatus: 'pending',
  });
});

describe('ingestion service', () => {
  it('runs the pipeline, persists completion, and flattens job stats', async () => {
    const stores = createStores();
    stores.sourceRegistry.findForUrl.mockResolvedValue({
      id: 'src-1',
      trustLevel: 'allowlisted',
    });
    stores.sourceRegistry.listActive.mockResolvedValue([{ id: 'src-1' }]);
    const { createIngestionService } = await loadServiceModule();

    const service = createIngestionService(stores as never);
    const result = await service.runPipeline({ sourceUrl: 'https://example.gov/feed' });

    expect(createIngestionJobMock).toHaveBeenCalledWith({
      jobType: 'seed_crawl',
      seedUrls: ['https://example.gov/feed'],
      sourceRegistryId: 'src-1',
    });
    expect(stores.jobs.create).toHaveBeenCalledWith(expect.objectContaining({ id: 'job-1', status: 'queued' }));
    expect(stores.jobs.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: 'job-1', status: 'running', startedAt: expect.any(String) }),
    );
    expect(createPipelineOrchestratorMock).toHaveBeenCalledWith(
      expect.objectContaining({ registry: [{ id: 'src-1' }] }),
    );
    expect(materializePipelineArtifactsMock).toHaveBeenCalledWith(
      stores,
      expect.objectContaining({
        result: expect.objectContaining({ candidateId: 'cand-1' }),
      }),
      expect.objectContaining({
        jobId: 'job-1',
        correlationId: 'job-corr-1',
      }),
    );
    expect(stores.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'extract.completed',
        targetType: 'candidate',
        targetId: 'cand-1',
      }),
    );
    expect(stores.jobs.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: 'completed',
        urlsDiscovered: 1,
        urlsFetched: 1,
        candidatesExtracted: 1,
        candidatesVerified: 1,
        errorsCount: 0,
      }),
    );
    expect(result.pipeline).toEqual(expect.objectContaining({ candidateId: 'cand-1', evidenceId: 'ev-1' }));
  });

  it('falls back to the provided registry when the source registry store cannot list active entries', async () => {
    const stores = createStores();
    stores.sourceRegistry.findForUrl.mockResolvedValue(null);
    stores.sourceRegistry.listActive.mockRejectedValue(new Error('db offline'));
    const { createIngestionService } = await loadServiceModule();

    const fallbackRegistry = [{ id: 'bootstrap-source' }];
    const service = createIngestionService(stores as never, { registry: fallbackRegistry as never });

    await service.runPipeline({ sourceUrl: 'https://example.gov/feed' });

    expect(createPipelineOrchestratorMock).toHaveBeenCalledWith(
      expect.objectContaining({ registry: fallbackRegistry }),
    );
  });

  it('marks jobs as failed, emits audit output, and rethrows when the pipeline crashes', async () => {
    const stores = createStores();
    stores.sourceRegistry.findForUrl.mockResolvedValue(null);
    stores.sourceRegistry.listActive.mockResolvedValue([]);
    processUrlDetailedMock.mockRejectedValueOnce(new Error('pipeline exploded'));
    const { createIngestionService } = await loadServiceModule();

    const service = createIngestionService(stores as never);

    await expect(service.runPipeline({ sourceUrl: 'https://example.gov/feed' })).rejects.toThrow('pipeline exploded');

    expect(stores.jobs.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'pipeline exploded',
      }),
    );
    expect(stores.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'extraction',
        outputs: { error: 'pipeline exploded' },
      }),
    );
  });

  it('continues batch processing after individual failures', async () => {
    const stores = createStores();
    const { createIngestionService } = await loadServiceModule();
    const service = createIngestionService(stores as never);
    const runPipelineSpy = vi.spyOn(service, 'runPipeline');

    runPipelineSpy
      .mockResolvedValueOnce({ job: makeJob(), pipeline: makePipelineResult() } as never)
      .mockRejectedValueOnce(new Error('boom'));

    const results = await service.runBatch(['https://example.gov/1', 'https://example.gov/2'], 'user-1');

    expect(results).toHaveLength(1);
    expect(runPipelineSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sourceUrl: 'https://example.gov/1', triggeredBy: 'user-1' }),
    );
    expect(runPipelineSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sourceUrl: 'https://example.gov/2', triggeredBy: 'user-1' }),
    );
  });

  it('polls due feeds and records both successful and failed poll attempts', async () => {
    const stores = createStores();
    stores.feeds.listDueForPoll.mockResolvedValue([{ id: 'feed-1' }, { id: 'feed-2' }]);
    stores.feeds.updateAfterPoll
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('poll failed'))
      .mockResolvedValueOnce(undefined);
    const { createIngestionService } = await loadServiceModule();

    const service = createIngestionService(stores as never);
    const result = await service.pollFeeds();

    expect(result).toEqual({ feedsPolled: 2, newUrls: 0, errors: 1 });
    expect(stores.feeds.updateAfterPoll).toHaveBeenNthCalledWith(
      1,
      'feed-1',
      expect.objectContaining({ lastPolledAt: expect.any(String) }),
    );
    expect(stores.feeds.updateAfterPoll).toHaveBeenNthCalledWith(
      3,
      'feed-2',
      expect.objectContaining({ error: 'Feed poll failed' }),
    );
  });

  it('reverifies only candidates with source URLs and continues past assignment escalation failures', async () => {
    const stores = createStores();
    stores.candidates.listDueForReverify.mockResolvedValue([
      { fields: { websiteUrl: 'https://example.gov/1' } },
      { fields: { websiteUrl: undefined } },
      { fields: { websiteUrl: 'https://example.gov/2' } },
    ]);
    stores.assignments.listOverdue.mockResolvedValue([
      { id: 'assign-1' },
      { id: 'assign-2' },
    ]);
    stores.assignments.updateStatus
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('locked'));
    const { createIngestionService } = await loadServiceModule();

    const service = createIngestionService(stores as never);
    const runPipelineSpy = vi.spyOn(service, 'runPipeline');
    runPipelineSpy
      .mockResolvedValueOnce({ job: makeJob(), pipeline: makePipelineResult() } as never)
      .mockRejectedValueOnce(new Error('retry failed'));

    const reverify = await service.runReverification(10);
    const escalated = await service.escalateOverdue();

    expect(runPipelineSpy).toHaveBeenCalledTimes(2);
    expect(reverify).toEqual({ candidatesChecked: 3, updated: 1, errors: 1 });
    expect(stores.assignments.updateStatus).toHaveBeenNthCalledWith(1, 'assign-1', 'expired');
    expect(stores.assignments.updateStatus).toHaveBeenNthCalledWith(2, 'assign-2', 'expired');
    expect(escalated).toEqual({ assignmentsEscalated: 1 });
  });
});
