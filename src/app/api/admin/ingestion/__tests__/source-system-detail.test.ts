import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbConfigMock = vi.hoisted(() => vi.fn());
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const getDrizzleMock = vi.hoisted(() => vi.fn());
const storeFactoryMocks = vi.hoisted(() => ({ createIngestionStores: vi.fn() }));
const controlChangeMocks = vi.hoisted(() => ({
  isHighRiskSourceSystemUpdate: vi.fn(),
  isHighRiskSourceFeedUpdate: vi.fn(),
  queueIngestionControlChange: vi.fn(),
}));
const sourceSystemsStore = vi.hoisted(() => ({ getById: vi.fn(), update: vi.fn(), deactivate: vi.fn() }));
const sourceFeedsStore = vi.hoisted(() => ({ listBySystem: vi.fn(), getById: vi.fn(), update: vi.fn(), deactivate: vi.fn() }));
const sourceFeedStatesStore = vi.hoisted(() => ({ getByFeedId: vi.fn(), upsert: vi.fn() }));

vi.mock('@/services/db/postgres', () => ({ isDatabaseConfigured: dbConfigMock }));
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimitShared: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({ requireMinRole: requireMinRoleMock }));
vi.mock('@/services/db/drizzle', () => ({ getDrizzle: getDrizzleMock }));
vi.mock('@/agents/ingestion/persistence/storeFactory', () => storeFactoryMocks);
vi.mock('@/services/ingestion/controlChanges', () => controlChangeMocks);

function createRequest(jsonBody?: unknown) {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(jsonBody),
  } as never;
}

function createRouteContext(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbConfigMock.mockReturnValue(true);
  rateLimitMock.mockResolvedValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1' });
  requireMinRoleMock.mockReturnValue(true);
  getDrizzleMock.mockReturnValue({ kind: 'db' });
  storeFactoryMocks.createIngestionStores.mockReturnValue({
    sourceSystems: sourceSystemsStore,
    sourceFeeds: sourceFeedsStore,
    sourceFeedStates: sourceFeedStatesStore,
  });
  sourceSystemsStore.getById.mockResolvedValue({ id: 'sys-1', name: '211 National' });
  sourceSystemsStore.update.mockResolvedValue(undefined);
  sourceSystemsStore.deactivate.mockResolvedValue(undefined);
  sourceFeedsStore.listBySystem.mockResolvedValue([{ id: 'feed-1', sourceSystemId: 'sys-1' }]);
  sourceFeedsStore.getById.mockResolvedValue({ id: 'feed-1', sourceSystemId: 'sys-1' });
  sourceFeedsStore.update.mockResolvedValue(undefined);
  sourceFeedsStore.deactivate.mockResolvedValue(undefined);
  sourceFeedStatesStore.getByFeedId.mockResolvedValue({
    sourceFeedId: 'feed-1',
    publicationMode: 'review_required',
    autoPublishApprovedAt: null,
    autoPublishApprovedBy: null,
    checkpointCursor: '12',
    replayFromCursor: null,
    emergencyPause: false,
    includedDataOwners: [],
    excludedDataOwners: [],
    maxOrganizationsPerPoll: null,
    lastAttemptStatus: 'succeeded',
    lastAttemptStartedAt: null,
    lastAttemptCompletedAt: null,
    lastSuccessfulSyncStartedAt: null,
    lastSuccessfulSyncCompletedAt: null,
    lastAttemptSummary: {},
    notes: null,
  });
  sourceFeedStatesStore.upsert.mockResolvedValue({ sourceFeedId: 'feed-1', publicationMode: 'review_required' });
  controlChangeMocks.isHighRiskSourceSystemUpdate.mockReturnValue(false);
  controlChangeMocks.isHighRiskSourceFeedUpdate.mockReturnValue(true);
  controlChangeMocks.queueIngestionControlChange.mockResolvedValue({ submissionId: 'sub-1' });
});

describe('source system and feed detail routes', () => {
  it('gets a source system with feeds', async () => {
    const { GET } = await import('../source-systems/[id]/route');
    const response = await GET(createRequest(), createRouteContext('sys-1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sourceSystem: { id: 'sys-1', name: '211 National', feeds: [{ id: 'feed-1', sourceSystemId: 'sys-1' }] },
    });
  });

  it('queues a complete source-system update for second approval', async () => {
    sourceSystemsStore.getById.mockResolvedValueOnce({
      id: 'sys-1',
      name: '211 National',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const { PUT } = await import('../source-systems/[id]/route');
    const response = await PUT(createRequest({ name: 'Updated 211', isActive: false }), createRouteContext('sys-1'));

    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: 'sys-1',
        payload: expect.objectContaining({
          entityType: 'source_system',
          action: 'update',
          beforeState: expect.objectContaining({ updatedAt: '2026-01-01T00:00:00.000Z' }),
          patch: { name: 'Updated 211', isActive: false },
        }),
      }),
    );
    expect(sourceSystemsStore.update).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
  });

  it('queues high-risk source system trust changes', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
    controlChangeMocks.isHighRiskSourceSystemUpdate.mockReturnValueOnce(true);
    const { PUT } = await import('../source-systems/[id]/route');
    const response = await PUT(createRequest({ trustTier: 'blocked' }), createRouteContext('sys-1'));

    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenCalledOnce();
    expect(sourceSystemsStore.update).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
  });

  it('deactivates a source system', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
    const { DELETE } = await import('../source-systems/[id]/route');
    const response = await DELETE(createRequest(), createRouteContext('sys-1'));

    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenCalledOnce();
    expect(sourceSystemsStore.deactivate).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
  });

  it('gets a source feed', async () => {
    const { GET } = await import('../source-feeds/[id]/route');
    const response = await GET(createRequest(), createRouteContext('feed-1'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      sourceFeed: { id: 'feed-1', sourceSystemId: 'sys-1' },
      state: {
        sourceFeedId: 'feed-1',
        publicationMode: 'review_required',
        autoPublishApprovedAt: null,
        autoPublishApprovedBy: null,
        checkpointCursor: '12',
        replayFromCursor: null,
        emergencyPause: false,
        includedDataOwners: [],
        excludedDataOwners: [],
        maxOrganizationsPerPoll: null,
        lastAttemptStatus: 'succeeded',
        lastAttemptStartedAt: null,
        lastAttemptCompletedAt: null,
        lastSuccessfulSyncStartedAt: null,
        lastSuccessfulSyncCompletedAt: null,
        lastAttemptSummary: {},
        notes: null,
      },
    });
  });

  it('updates and deactivates a source feed', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
    sourceFeedsStore.getById.mockResolvedValue({
      id: 'feed-1',
      sourceSystemId: 'sys-1',
      feedName: '211 feed',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const route = await import('../source-feeds/[id]/route');
    const updateResponse = await route.PUT(
      createRequest({
        feedName: 'Updated Feed',
        isActive: false,
        state: {
          publicationMode: 'auto_publish',
          autoPublishApproved: true,
          emergencyPause: true,
        },
      }),
      createRouteContext('feed-1'),
    );
    const deleteResponse = await route.DELETE(createRequest(), createRouteContext('feed-1'));

    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        targetId: 'feed-1',
        payload: expect.objectContaining({
          action: 'update',
          feedPatch: { feedName: 'Updated Feed', isActive: false },
          nextState: expect.objectContaining({
            publicationMode: 'auto_publish',
            autoPublishApprovedBy: 'oran-1',
            emergencyPause: true,
          }),
        }),
      }),
    );
    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        targetId: 'feed-1',
        payload: expect.objectContaining({ action: 'deactivate' }),
      }),
    );
    expect(sourceFeedsStore.update).not.toHaveBeenCalled();
    expect(sourceFeedStatesStore.upsert).not.toHaveBeenCalled();
    expect(sourceFeedsStore.deactivate).not.toHaveBeenCalled();
    expect(updateResponse.status).toBe(202);
    expect(deleteResponse.status).toBe(202);
  });

  it('rejects changing a non-Azure source feed to the legacy Azure Function handler', async () => {
    sourceFeedsStore.getById.mockResolvedValueOnce({
      id: 'feed-1',
      sourceSystemId: 'sys-1',
      feedName: 'Current HSDS Feed',
      feedHandler: 'hsds_api',
    });
    const { PUT } = await import('../source-feeds/[id]/route');

    const response = await PUT(
      createRequest({ feedHandler: 'azure_function' }),
      createRouteContext('feed-1'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Source feeds cannot be changed to the legacy Azure Function handler.',
      code: 'legacy_feed_handler_read_only',
    });
    expect(sourceFeedsStore.update).not.toHaveBeenCalled();
    expect(sourceFeedStatesStore.upsert).not.toHaveBeenCalled();
  });

  it('queues edits to a legacy Azure feed and migration to a supported handler', async () => {
    sourceFeedsStore.getById.mockResolvedValue({
      id: 'feed-legacy',
      sourceSystemId: 'sys-1',
      feedName: 'Legacy Azure Feed',
      feedHandler: 'azure_function',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const { PUT } = await import('../source-feeds/[id]/route');

    const editResponse = await PUT(
      createRequest({ feedName: 'Legacy Azure Feed (migration pending)' }),
      createRouteContext('feed-legacy'),
    );
    const migrationResponse = await PUT(
      createRequest({ feedHandler: 'hsds_api' }),
      createRouteContext('feed-legacy'),
    );

    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        targetId: 'feed-legacy',
        payload: expect.objectContaining({
          feedPatch: { feedName: 'Legacy Azure Feed (migration pending)' },
        }),
      }),
    );
    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        targetId: 'feed-legacy',
        payload: expect.objectContaining({ feedPatch: { feedHandler: 'hsds_api' } }),
      }),
    );
    expect(sourceFeedsStore.update).not.toHaveBeenCalled();
    expect(editResponse.status).toBe(202);
    expect(migrationResponse.status).toBe(202);
  });

  it('queues high-risk feed rollout changes for second approval', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
    controlChangeMocks.isHighRiskSourceFeedUpdate.mockReturnValueOnce(true);
    const route = await import('../source-feeds/[id]/route');
    const response = await route.PUT(
      createRequest({
        state: {
          publicationMode: 'auto_publish',
          autoPublishApproved: true,
        },
      }),
      createRouteContext('feed-1'),
    );

    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenCalledOnce();
    expect(sourceFeedStatesStore.upsert).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
  });

  it('queues a single feed replay from checkpoint', async () => {
    const { POST } = await import('../source-feeds/[id]/replay/route');
    const response = await POST(createRequest(), createRouteContext('feed-1'));

    expect(sourceFeedStatesStore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFeedId: 'feed-1',
        checkpointCursor: '12',
        replayFromCursor: '12',
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ queued: true, replayFromCursor: '12' });
  });

  it('queues bulk feed rollout state and checkpoint replay for second approval', async () => {
    sourceFeedsStore.getById.mockImplementation(async (id: string) => ({
      id,
      sourceSystemId: 'sys-1',
      feedName: `Feed ${id}`,
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    sourceFeedStatesStore.getByFeedId.mockImplementation(async (id: string) => ({
      sourceFeedId: id,
      publicationMode: 'review_required',
      autoPublishApprovedAt: null,
      autoPublishApprovedBy: null,
      checkpointCursor: id === 'feed-1' ? '12' : '20',
      replayFromCursor: null,
      emergencyPause: false,
      includedDataOwners: [],
      excludedDataOwners: [],
      maxOrganizationsPerPoll: null,
      lastAttemptStatus: 'succeeded',
      lastAttemptStartedAt: null,
      lastAttemptCompletedAt: null,
      lastSuccessfulSyncStartedAt: null,
      lastSuccessfulSyncCompletedAt: null,
      lastAttemptSummary: {},
      notes: null,
    }));

    const { POST } = await import('../source-feeds/bulk/route');
    const response = await POST(createRequest({
      feedIds: ['feed-1', 'feed-2'],
      isActive: false,
      state: { publicationMode: 'review_required', emergencyPause: true },
      useCheckpointAsReplay: true,
    }));

    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        targetId: 'feed-1',
        payload: expect.objectContaining({
          feedPatch: { isActive: false },
          nextState: expect.objectContaining({ emergencyPause: true, replayFromCursor: '12' }),
        }),
      }),
    );
    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        targetId: 'feed-2',
        payload: expect.objectContaining({
          feedPatch: { isActive: false },
          nextState: expect.objectContaining({ emergencyPause: true, replayFromCursor: '20' }),
        }),
      }),
    );
    expect(sourceFeedsStore.update).not.toHaveBeenCalled();
    expect(sourceFeedStatesStore.upsert).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: 2,
      submissionIds: ['sub-1', 'sub-1'],
      status: 'pending_second_approval',
    });
  });

  it('queues high-risk bulk feed rollout changes instead of applying them directly', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
    sourceFeedsStore.getById.mockImplementation(async (id: string) => ({ id, sourceSystemId: 'sys-1', feedName: `Feed ${id}` }));
    controlChangeMocks.isHighRiskSourceFeedUpdate.mockReturnValueOnce(true);

    const { POST } = await import('../source-feeds/bulk/route');
    const response = await POST(createRequest({
      feedIds: ['feed-1', 'feed-2'],
      state: { publicationMode: 'auto_publish', autoPublishApproved: true },
    }));

    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenCalledTimes(2);
    expect(sourceFeedStatesStore.upsert).not.toHaveBeenCalled();
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queued: 2,
      submissionIds: ['sub-1', 'sub-1'],
      status: 'pending_second_approval',
    });
  });
});
