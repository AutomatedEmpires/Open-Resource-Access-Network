import { beforeEach, describe, expect, it, vi } from 'vitest';

const processUrlMock = vi.hoisted(() => vi.fn());
const processUrlDetailedMock = vi.hoisted(() => vi.fn());
const createPipelineOrchestratorMock = vi.hoisted(() => vi.fn(() => ({
  processUrl: processUrlMock,
  processUrlDetailed: processUrlDetailedMock,
})));
const createIngestionJobMock = vi.hoisted(() => vi.fn());
const materializePipelineArtifactsMock = vi.hoisted(() => vi.fn());
const poll211NdpFeedMock = vi.hoisted(() => vi.fn());
const pollHsdsFeedMock = vi.hoisted(() => vi.fn());
const normalize211SourceRecordMock = vi.hoisted(() => vi.fn());
const normalizeSourceRecordMock = vi.hoisted(() => vi.fn());
const autoPublishMock = vi.hoisted(() => vi.fn());
const publishCandidateToLiveServiceMock = vi.hoisted(() => vi.fn());

vi.mock('../pipeline/orchestrator', () => ({
  createPipelineOrchestrator: createPipelineOrchestratorMock,
}));
vi.mock('../jobs', () => ({
  createIngestionJob: createIngestionJobMock,
}));
vi.mock('../materialize', () => ({
  materializePipelineArtifacts: materializePipelineArtifactsMock,
}));
vi.mock('../ndp211Connector', () => ({
  poll211NdpFeed: poll211NdpFeedMock,
}));
vi.mock('../hsdsFeedConnector', () => ({
  pollHsdsFeed: pollHsdsFeedMock,
}));
vi.mock('../ndp211Normalizer', () => ({
  normalize211SourceRecord: normalize211SourceRecordMock,
}));
vi.mock('../normalizeSourceRecord', () => ({
  normalizeSourceRecord: normalizeSourceRecordMock,
}));
vi.mock('../autoPublish', () => ({
  autoPublish: autoPublishMock,
}));
vi.mock('../livePublish', () => ({
  publishCandidateToLiveService: publishCandidateToLiveServiceMock,
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
    sourceSystems: {
      getById: vi.fn(),
    },
    sourceFeeds: {
      listDueForPoll: vi.fn(),
      updateAfterPoll: vi.fn(),
    },
    sourceFeedStates: {
      getByFeedId: vi.fn().mockResolvedValue({
        sourceFeedId: 'source-feed-1',
        publicationMode: 'canonical_only',
        autoPublishApprovedAt: null,
        autoPublishApprovedBy: null,
        emergencyPause: false,
      }),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    sourceRecords: {
      listPendingByFeed: vi.fn(),
      listByFeed: vi.fn(),
      updateStatus: vi.fn(),
    },
    canonicalOrganizations: {
      updatePublicationStatus: vi.fn(),
    },
    canonicalServices: {
      updatePublicationStatus: vi.fn(),
    },
    canonicalLocations: {
      updatePublicationStatus: vi.fn(),
    },
    candidates: {
      getById: vi.fn(),
      listDueForReverify: vi.fn(),
    },
    publishReadiness: {
      meetsThreshold: vi.fn().mockResolvedValue(false),
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
  poll211NdpFeedMock.mockResolvedValue({
    organizationBundlesFetched: 1,
    recordsCreated: 1,
    recordsSkippedDuplicate: 0,
    taxonomyCodesAttached: 0,
    errors: [],
  });
  pollHsdsFeedMock.mockResolvedValue({
    recordsCreated: 1,
    recordsSkippedDuplicate: 0,
    errors: [],
  });
  normalize211SourceRecordMock.mockResolvedValue({
    canonicalOrganizationId: 'org-1',
    canonicalServiceIds: ['svc-1'],
    canonicalLocationIds: ['loc-1'],
    provenanceRecordsCreated: 1,
    enrichments: {
      eligibilityTags: [],
      costTags: [],
      languageTags: [],
      taxonomyCrosswalked: false,
      crosswalkDerivedTags: 0,
      crosswalkUnmatchedCodes: 0,
    },
  });
  normalizeSourceRecordMock.mockResolvedValue({
    canonicalOrganizationId: 'org-1',
    canonicalServiceIds: ['svc-1'],
    canonicalLocationIds: ['loc-1'],
    provenanceRecordsCreated: 1,
  });
  autoPublishMock.mockResolvedValue({
    evaluated: 1,
    published: 1,
    skipped: 0,
    decisions: [{ canonicalServiceId: 'svc-1', eligible: true, reason: 'auto-publish' }],
    errors: [],
  });
  publishCandidateToLiveServiceMock.mockResolvedValue({
    serviceId: 'svc-live-1',
    organizationId: 'org-live-1',
    locationId: 'loc-live-1',
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

  it('auto-publishes allowlisted high-readiness pipeline candidates', async () => {
    const stores = createStores();
    stores.sourceRegistry.findForUrl.mockResolvedValue({
      id: 'src-1',
      trustLevel: 'allowlisted',
    });
    stores.sourceRegistry.listActive.mockResolvedValue([{ id: 'src-1' }]);
    stores.publishReadiness.meetsThreshold.mockResolvedValue(true);

    const { createIngestionService } = await loadServiceModule();
    const service = createIngestionService(stores as never);

    await service.runPipeline({
      sourceUrl: 'https://example.gov/feed',
      triggeredBy: 'oran-1',
    });

    expect(publishCandidateToLiveServiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stores,
        candidateId: 'cand-1',
        publishedByUserId: 'oran-1',
      }),
    );
    expect(stores.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'publish.approved',
        actorType: 'human',
        actorId: 'oran-1',
        targetType: 'service',
        targetId: 'svc-live-1',
        inputs: expect.objectContaining({
          candidateId: 'cand-1',
          publicationChannel: 'candidate_auto_publish',
        }),
      }),
    );
  });

  it('keeps candidates in review when readiness threshold is not met', async () => {
    const stores = createStores();
    stores.sourceRegistry.findForUrl.mockResolvedValue({
      id: 'src-1',
      trustLevel: 'allowlisted',
    });
    stores.sourceRegistry.listActive.mockResolvedValue([{ id: 'src-1' }]);
    stores.publishReadiness.meetsThreshold.mockResolvedValue(false);

    const { createIngestionService } = await loadServiceModule();
    const service = createIngestionService(stores as never);

    await service.runPipeline({ sourceUrl: 'https://example.gov/feed' });

    expect(publishCandidateToLiveServiceMock).not.toHaveBeenCalled();
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
    stores.sourceFeeds.listDueForPoll.mockResolvedValue([]);
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

  it('polls 211 source feeds, passes configured data owners, and dispatches 211 normalization for pending source records', async () => {
    const previousDataOwners = process.env.NDP_211_DATA_OWNERS;
    process.env.NDP_211_DATA_OWNERS = '211ventura,211monterey';

    const stores = createStores();
    stores.feeds.listDueForPoll.mockResolvedValue([]);
    stores.sourceFeeds.listDueForPoll.mockResolvedValue([
      {
        id: 'source-feed-1',
        sourceSystemId: 'source-system-1',
        feedHandler: 'ndp_211',
        baseUrl: 'https://api.211.org/resources/v2',
      },
    ]);
    stores.sourceSystems.getById.mockResolvedValue({
      id: 'source-system-1',
      family: 'partner_api',
      name: '211 Monterey',
    });
    stores.sourceRecords.listPendingByFeed.mockResolvedValue([
      {
        id: 'source-record-1',
        processingStatus: 'pending',
        sourceRecordType: 'organization_bundle',
        sourceConfidenceSignals: { source: '211_ndp', trustTier: 'trusted_partner' },
      },
    ]);

    const { createIngestionService } = await loadServiceModule();
    const service = createIngestionService(stores as never);
    const result = await service.pollFeeds();

    expect(poll211NdpFeedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dataOwners: '211ventura,211monterey',
        feed: expect.objectContaining({ id: 'source-feed-1' }),
      }),
    );
    expect(normalize211SourceRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRecord: expect.objectContaining({ id: 'source-record-1' }),
        runCrosswalk: true,
        trustTier: 'trusted_partner',
      }),
    );
    expect(stores.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'feed.poll_started',
        targetType: 'source_feed',
        targetId: 'source-feed-1',
      }),
    );
    expect(stores.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'feed.poll_completed',
        targetType: 'source_feed',
        targetId: 'source-feed-1',
        outputs: expect.objectContaining({ normalized: 1, normalizationErrors: 0 }),
      }),
    );
    expect(result).toEqual({ feedsPolled: 1, newUrls: 1, errors: 0 });

    if (previousDataOwners === undefined) {
      delete process.env.NDP_211_DATA_OWNERS;
    } else {
      process.env.NDP_211_DATA_OWNERS = previousDataOwners;
    }
  });

  it('polls HSDS source feeds and dispatches generic normalization for pending source records', async () => {
    const stores = createStores();
    stores.feeds.listDueForPoll.mockResolvedValue([]);
    stores.sourceFeeds.listDueForPoll.mockResolvedValue([
      {
        id: 'source-feed-1',
        sourceSystemId: 'source-system-1',
        feedHandler: 'hsds_api',
        baseUrl: 'https://example.com/hsds',
      },
    ]);
    stores.sourceSystems.getById.mockResolvedValue({
      id: 'source-system-1',
      family: 'hsds',
      name: 'County HSDS Feed',
    });
    stores.sourceRecords.listPendingByFeed.mockResolvedValue([
      {
        id: 'source-record-1',
        processingStatus: 'pending',
        sourceRecordType: 'organization',
        sourceConfidenceSignals: { source: 'hsds', trustTier: 'curated' },
      },
    ]);

    const { createIngestionService } = await loadServiceModule();
    const service = createIngestionService(stores as never);
    const result = await service.pollFeeds();

    expect(pollHsdsFeedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feed: expect.objectContaining({ id: 'source-feed-1' }),
      }),
    );
    expect(normalizeSourceRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRecord: expect.objectContaining({ id: 'source-record-1' }),
        trustTier: 'curated',
      }),
    );
    expect(result).toEqual({ feedsPolled: 1, newUrls: 1, errors: 0 });
  });

  it('queues review instead of auto-publishing when feed approval is missing', async () => {
    const previousAutoPublish = process.env.SOURCE_FEED_AUTO_PUBLISH_ENABLED;
    process.env.SOURCE_FEED_AUTO_PUBLISH_ENABLED = 'true';

    const stores = createStores();
    stores.feeds.listDueForPoll.mockResolvedValue([]);
    stores.sourceFeeds.listDueForPoll.mockResolvedValue([
      {
        id: 'source-feed-1',
        sourceSystemId: 'source-system-1',
        feedHandler: 'ndp_211',
        baseUrl: 'https://api.211.org/resources/v2',
      },
    ]);
    stores.sourceSystems.getById.mockResolvedValue({
      id: 'source-system-1',
      family: 'partner_api',
      name: '211 Monterey',
    });
    stores.sourceFeedStates.getByFeedId.mockResolvedValue({
      sourceFeedId: 'source-feed-1',
      publicationMode: 'auto_publish',
      autoPublishApprovedAt: null,
      autoPublishApprovedBy: null,
      emergencyPause: false,
    });
    stores.sourceRecords.listPendingByFeed.mockResolvedValue([
      {
        id: 'source-record-1',
        processingStatus: 'pending',
        sourceRecordType: 'organization_bundle',
        sourceConfidenceSignals: { source: '211_ndp', trustTier: 'trusted_partner' },
      },
    ]);

    const { createIngestionService } = await loadServiceModule();
    const service = createIngestionService(stores as never);
    const result = await service.pollFeeds();

    expect(autoPublishMock).not.toHaveBeenCalled();
    expect(stores.canonicalServices.updatePublicationStatus).toHaveBeenCalledWith('svc-1', 'pending_review');
    expect(stores.canonicalOrganizations.updatePublicationStatus).toHaveBeenCalledWith('org-1', 'pending_review');
    expect(stores.canonicalLocations.updatePublicationStatus).toHaveBeenCalledWith('loc-1', 'pending_review');
    expect(stores.sourceFeedStates.update).toHaveBeenCalledWith(
      'source-feed-1',
      expect.objectContaining({
        lastAttemptSummary: expect.objectContaining({
          publicationMode: 'review_required',
          publicationReason: 'auto_publish_approval_missing',
        }),
      }),
    );
    expect(stores.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'feed.poll_completed',
        outputs: expect.objectContaining({
          publicationMode: 'review_required',
          publicationReason: 'auto_publish_approval_missing',
        }),
      }),
    );
    expect(result).toEqual({ feedsPolled: 1, newUrls: 1, errors: 0 });

    if (previousAutoPublish === undefined) {
      delete process.env.SOURCE_FEED_AUTO_PUBLISH_ENABLED;
    } else {
      process.env.SOURCE_FEED_AUTO_PUBLISH_ENABLED = previousAutoPublish;
    }
  });

  it('auto-publishes only after explicit feed approval is recorded', async () => {
    const previousAutoPublish = process.env.SOURCE_FEED_AUTO_PUBLISH_ENABLED;
    process.env.SOURCE_FEED_AUTO_PUBLISH_ENABLED = 'true';

    const stores = createStores();
    stores.feeds.listDueForPoll.mockResolvedValue([]);
    stores.sourceFeeds.listDueForPoll.mockResolvedValue([
      {
        id: 'source-feed-1',
        sourceSystemId: 'source-system-1',
        feedHandler: 'ndp_211',
        baseUrl: 'https://api.211.org/resources/v2',
      },
    ]);
    stores.sourceSystems.getById.mockResolvedValue({
      id: 'source-system-1',
      family: 'partner_api',
      name: '211 Monterey',
    });
    stores.sourceFeedStates.getByFeedId.mockResolvedValue({
      sourceFeedId: 'source-feed-1',
      publicationMode: 'auto_publish',
      autoPublishApprovedAt: new Date('2026-03-13T22:30:00.000Z'),
      autoPublishApprovedBy: 'oran-1',
      emergencyPause: false,
    });
    stores.sourceRecords.listPendingByFeed.mockResolvedValue([
      {
        id: 'source-record-1',
        processingStatus: 'pending',
        sourceRecordType: 'organization_bundle',
        sourceConfidenceSignals: { source: '211_ndp', trustTier: 'trusted_partner' },
      },
    ]);

    const { createIngestionService } = await loadServiceModule();
    const service = createIngestionService(stores as never);
    const result = await service.pollFeeds();

    expect(autoPublishMock).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalServiceIds: ['svc-1'],
        policy: expect.objectContaining({ allowRepublish: false, trustedPartnerMinConfidence: 90 }),
      }),
    );
    expect(stores.sourceFeedStates.update).toHaveBeenCalledWith(
      'source-feed-1',
      expect.objectContaining({
        lastAttemptSummary: expect.objectContaining({
          publicationMode: 'auto_publish',
          publicationReason: 'auto_publish_policy_filtered',
        }),
      }),
    );
    expect(result).toEqual({ feedsPolled: 1, newUrls: 1, errors: 0 });

    if (previousAutoPublish === undefined) {
      delete process.env.SOURCE_FEED_AUTO_PUBLISH_ENABLED;
    } else {
      process.env.SOURCE_FEED_AUTO_PUBLISH_ENABLED = previousAutoPublish;
    }
  });

  it('writes normalize.failed audit events when source-record normalization errors occur', async () => {
    const stores = createStores();
    stores.feeds.listDueForPoll.mockResolvedValue([]);
    stores.sourceFeeds.listDueForPoll.mockResolvedValue([
      {
        id: 'source-feed-1',
        sourceSystemId: 'source-system-1',
        feedHandler: 'hsds_api',
        feedType: 'api',
        baseUrl: 'https://example.com/hsds',
      },
    ]);
    stores.sourceSystems.getById.mockResolvedValue({
      id: 'source-system-1',
      family: 'hsds',
      name: 'County HSDS Feed',
    });
    stores.sourceRecords.listPendingByFeed.mockResolvedValue([
      {
        id: 'source-record-1',
        processingStatus: 'pending',
        sourceRecordType: 'organization',
        sourceConfidenceSignals: { source: 'hsds', trustTier: 'curated' },
      },
    ]);
    normalizeSourceRecordMock.mockRejectedValueOnce(new Error('invalid payload'));

    const { createIngestionService } = await loadServiceModule();
    const service = createIngestionService(stores as never);
    const result = await service.pollFeeds();

    expect(stores.sourceRecords.updateStatus).toHaveBeenCalledWith(
      'source-record-1',
      'error',
      'invalid payload',
    );
    expect(stores.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'normalize.failed',
        targetType: 'source_record',
        targetId: 'source-record-1',
      }),
    );
    expect(result).toEqual({ feedsPolled: 1, newUrls: 1, errors: 1 });
  });

  it('does not count unsupported source feeds as polled by the service', async () => {
    const stores = createStores();
    stores.feeds.listDueForPoll.mockResolvedValue([]);
    stores.sourceFeeds.listDueForPoll.mockResolvedValue([
      {
        id: 'source-feed-1',
        sourceSystemId: 'source-system-1',
        feedHandler: 'none',
        baseUrl: 'https://example.com/feed.csv',
      },
    ]);
    stores.sourceSystems.getById.mockResolvedValue({
      id: 'source-system-1',
      family: 'csv',
      name: 'County CSV Feed',
    });

    const { createIngestionService } = await loadServiceModule();
    const service = createIngestionService(stores as never);
    const result = await service.pollFeeds();

    expect(poll211NdpFeedMock).not.toHaveBeenCalled();
    expect(pollHsdsFeedMock).not.toHaveBeenCalled();
    expect(stores.sourceRecords.listPendingByFeed).not.toHaveBeenCalled();
    expect(result).toEqual({ feedsPolled: 0, newUrls: 0, errors: 0 });
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
