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
  controlChangeMocks.isHighRiskSourceFeedUpdate.mockReturnValue(false);
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

  it('updates a source system', async () => {
    const { PUT } = await import('../source-systems/[id]/route');
    const response = await PUT(createRequest({ name: 'Updated 211', isActive: false }), createRouteContext('sys-1'));

    expect(sourceSystemsStore.update).toHaveBeenCalledWith('sys-1', { name: 'Updated 211', isActive: false });
    expect(response.status).toBe(200);
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

    expect(sourceFeedsStore.update).toHaveBeenCalledWith('feed-1', { feedName: 'Updated Feed', isActive: false });
    expect(sourceFeedStatesStore.upsert).toHaveBeenCalledWith({
      sourceFeedId: 'feed-1',
      publicationMode: 'auto_publish',
      autoPublishApprovedAt: expect.any(Date),
      autoPublishApprovedBy: 'oran-1',
      emergencyPause: true,
      includedDataOwners: [],
      excludedDataOwners: [],
      maxOrganizationsPerPoll: null,
      checkpointCursor: '12',
      replayFromCursor: null,
      lastAttemptStatus: 'succeeded',
      lastAttemptStartedAt: null,
      lastAttemptCompletedAt: null,
      lastSuccessfulSyncStartedAt: null,
      lastSuccessfulSyncCompletedAt: null,
      lastAttemptSummary: {},
      notes: null,
    });
    expect(controlChangeMocks.queueIngestionControlChange).toHaveBeenCalledOnce();
    expect(sourceFeedsStore.deactivate).not.toHaveBeenCalled();
    expect(updateResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(202);
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

  it('bulk updates feed rollout state and can queue replay from checkpoint', async () => {
    sourceFeedsStore.getById.mockImplementation(async (id: string) => ({ id, sourceSystemId: 'sys-1' }));
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

    expect(sourceFeedsStore.update).toHaveBeenNthCalledWith(1, 'feed-1', { isActive: false });
    expect(sourceFeedsStore.update).toHaveBeenNthCalledWith(2, 'feed-2', { isActive: false });
    expect(sourceFeedStatesStore.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ sourceFeedId: 'feed-1', emergencyPause: true, replayFromCursor: '12' }),
    );
    expect(sourceFeedStatesStore.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ sourceFeedId: 'feed-2', emergencyPause: true, replayFromCursor: '20' }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ updated: 2 });
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
