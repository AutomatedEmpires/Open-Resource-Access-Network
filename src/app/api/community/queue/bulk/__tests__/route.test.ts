import { beforeEach, describe, expect, it, vi } from 'vitest';

const clientQueryMock = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const engineMocks = vi.hoisted(() => ({
  advanceInTransaction: vi.fn(),
  sendTerminalStatusEmail: vi.fn(),
}));
const guardMocks = vi.hoisted(() => ({
  lockBulkReviewSubmissions: vi.fn(),
}));
const gateMocks = vi.hoisted(() => ({
  acquireLivePublicationGateShared: vi.fn(),
}));
const scopeMocks = vi.hoisted(() => ({
  getCommunityAdminScope: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: requireMinRoleMock,
}));
vi.mock('@/services/workflow/engine', () => engineMocks);
vi.mock('@/services/queue/bulkReviewGuard', () => guardMocks);
vi.mock('@/services/publication/liveEntityMerge', () => gateMocks);
vi.mock('@/services/community/scope', () => scopeMocks);

function createRequest(options: { jsonBody?: unknown; jsonError?: boolean; ip?: string } = {}) {
  const headers = new Headers();
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

async function loadRoute() {
  return import('../route');
}

const ID_ONE = '11111111-1111-4111-8111-111111111111';
const ID_TWO = '22222222-2222-4222-8222-222222222222';

function cleanPreflight(overrides: Record<string, unknown> = {}) {
  return {
    submissions: [],
    inaccessibleIds: [],
    reviewOwnershipConflictIds: [],
    structuredFreshnessIds: [],
    individualReviewRequiredIds: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.withTransaction.mockImplementation(
    async (fn: (client: { query: typeof clientQueryMock }) => Promise<unknown>) =>
      fn({ query: clientQueryMock }),
  );
  clientQueryMock.mockResolvedValue({ rows: [] });
  rateLimitMock.mockResolvedValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
  requireMinRoleMock.mockReturnValue(true);
  scopeMocks.getCommunityAdminScope.mockResolvedValue({ hasExplicitScope: false });
  guardMocks.lockBulkReviewSubmissions.mockResolvedValue(cleanPreflight());
  engineMocks.advanceInTransaction.mockResolvedValue({ success: true });
  engineMocks.sendTerminalStatusEmail.mockResolvedValue(undefined);
});

describe('PATCH /api/community/queue/bulk', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { PATCH } = await loadRoute();

    const res = await PATCH(createRequest());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'Database not configured.' });
  });

  it('returns 503 with Retry-After when the shared rate-limit backend is unavailable', async () => {
    rateLimitMock.mockResolvedValueOnce({
      exceeded: false,
      retryAfterSeconds: 30,
      backendUnavailable: true,
    });
    const { PATCH } = await loadRoute();

    const res = await PATCH(createRequest({ ip: '203.0.113.9' }));

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('enforces rate limiting and authz gates', async () => {
    const { PATCH } = await loadRoute();

    rateLimitMock.mockResolvedValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await PATCH(createRequest({ ip: '203.0.113.9' }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauthenticated = await PATCH(createRequest());
    expect(unauthenticated.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await PATCH(createRequest());
    expect(forbidden.status).toBe(403);
  });

  it('rejects malformed bodies before opening a transaction', async () => {
    const { PATCH } = await loadRoute();

    const invalidJson = await PATCH(createRequest({ jsonError: true }));
    expect(invalidJson.status).toBe(400);

    const emptyIds = await PATCH(createRequest({ jsonBody: { ids: [], decision: 'approved' } }));
    expect(emptyIds.status).toBe(400);

    const unknownKey = await PATCH(createRequest({
      jsonBody: { ids: [ID_ONE], decision: 'approved', sneaky: true },
    }));
    expect(unknownKey.status).toBe(400);

    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('dedupes ids and passes the unrestricted flag only for oran_admin', async () => {
    const { PATCH } = await loadRoute();

    await PATCH(createRequest({
      jsonBody: { ids: [ID_ONE, ID_ONE, ID_TWO], decision: 'denied' },
    }));
    expect(guardMocks.lockBulkReviewSubmissions).toHaveBeenCalledWith(
      expect.anything(), [ID_ONE, ID_TWO], expect.anything(), false, 'community-1',
    );

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: 'admin-1', role: 'oran_admin' });
    await PATCH(createRequest({ jsonBody: { ids: [ID_ONE], decision: 'denied' } }));
    expect(guardMocks.lockBulkReviewSubmissions).toHaveBeenLastCalledWith(
      expect.anything(), [ID_ONE], expect.anything(), true, 'admin-1',
    );
  });

  it('acquires the publication gate before locking the review rows', async () => {
    const { PATCH } = await loadRoute();

    await PATCH(createRequest({ jsonBody: { ids: [ID_ONE], decision: 'denied' } }));

    const gateOrder = gateMocks.acquireLivePublicationGateShared.mock.invocationCallOrder[0];
    const guardOrder = guardMocks.lockBulkReviewSubmissions.mock.invocationCallOrder[0];
    expect(gateOrder).toBeLessThan(guardOrder);
  });

  it('maps each preflight block to its status and applies nothing', async () => {
    const { PATCH } = await loadRoute();

    guardMocks.lockBulkReviewSubmissions.mockResolvedValueOnce(
      cleanPreflight({ inaccessibleIds: [ID_ONE] }),
    );
    const scoped = await PATCH(createRequest({ jsonBody: { ids: [ID_ONE], decision: 'denied' } }));
    expect(scoped.status).toBe(403);
    await expect(scoped.json()).resolves.toMatchObject({
      succeeded: [],
      failed: [{ id: ID_ONE, error: expect.stringContaining('scope') }],
    });

    guardMocks.lockBulkReviewSubmissions.mockResolvedValueOnce(
      cleanPreflight({ reviewOwnershipConflictIds: [ID_ONE] }),
    );
    const ownership = await PATCH(createRequest({ jsonBody: { ids: [ID_ONE], decision: 'denied' } }));
    expect(ownership.status).toBe(409);

    guardMocks.lockBulkReviewSubmissions.mockResolvedValueOnce(
      cleanPreflight({ structuredFreshnessIds: [ID_ONE] }),
    );
    const freshness = await PATCH(createRequest({ jsonBody: { ids: [ID_ONE], decision: 'denied' } }));
    expect(freshness.status).toBe(409);
    await expect(freshness.json()).resolves.toMatchObject({ blockedIds: [ID_ONE] });

    expect(engineMocks.advanceInTransaction).not.toHaveBeenCalled();
    expect(engineMocks.sendTerminalStatusEmail).not.toHaveBeenCalled();
  });

  it('refuses bulk approval for types requiring individual review, but lets denial proceed', async () => {
    const { PATCH } = await loadRoute();

    guardMocks.lockBulkReviewSubmissions.mockResolvedValueOnce(
      cleanPreflight({ individualReviewRequiredIds: [ID_ONE] }),
    );
    const approved = await PATCH(createRequest({ jsonBody: { ids: [ID_ONE], decision: 'approved' } }));
    expect(approved.status).toBe(409);
    await expect(approved.json()).resolves.toMatchObject({ blockedIds: [ID_ONE] });
    expect(engineMocks.advanceInTransaction).not.toHaveBeenCalled();

    guardMocks.lockBulkReviewSubmissions.mockResolvedValueOnce(
      cleanPreflight({ individualReviewRequiredIds: [ID_ONE] }),
    );
    const denied = await PATCH(createRequest({ jsonBody: { ids: [ID_ONE], decision: 'denied' } }));
    expect(denied.status).toBe(200);
    expect(engineMocks.advanceInTransaction).toHaveBeenCalledTimes(1);
  });

  it('persists reviewer notes on each row before advancing it', async () => {
    const { PATCH } = await loadRoute();

    const res = await PATCH(createRequest({
      jsonBody: { ids: [ID_ONE, ID_TWO], decision: 'denied', notes: 'stale listing' },
    }));

    expect(res.status).toBe(200);
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('reviewer_notes'),
      ['stale listing', ID_ONE],
    );
    expect(clientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('reviewer_notes'),
      ['stale listing', ID_TWO],
    );
    expect(engineMocks.advanceInTransaction).toHaveBeenCalledTimes(2);
  });

  it('rolls back everything and sends no email when one advance fails', async () => {
    const { PATCH } = await loadRoute();
    engineMocks.advanceInTransaction
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, error: 'Gate check failed' });

    const res = await PATCH(createRequest({
      jsonBody: { ids: [ID_ONE, ID_TWO], decision: 'denied' },
    }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('no changes were applied'),
      succeeded: [],
      failed: [{ id: ID_TWO, error: 'Gate check failed' }],
    });
    expect(engineMocks.sendTerminalStatusEmail).not.toHaveBeenCalled();
  });

  it('applies the decision to every id and emails after the transaction resolves', async () => {
    const { PATCH } = await loadRoute();

    const res = await PATCH(createRequest({
      jsonBody: { ids: [ID_ONE, ID_TWO], decision: 'approved' },
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ succeeded: [ID_ONE, ID_TWO], failed: [] });
    expect(engineMocks.sendTerminalStatusEmail).toHaveBeenCalledTimes(2);
    expect(engineMocks.sendTerminalStatusEmail).toHaveBeenCalledWith(ID_ONE, 'approved');
    expect(engineMocks.sendTerminalStatusEmail).toHaveBeenCalledWith(ID_TWO, 'approved');

    const txnOrder = dbMocks.withTransaction.mock.invocationCallOrder[0];
    const emailOrder = engineMocks.sendTerminalStatusEmail.mock.invocationCallOrder[0];
    expect(txnOrder).toBeLessThan(emailOrder);
  });

  it('captures unexpected failures and returns 500', async () => {
    const { PATCH } = await loadRoute();
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('connection lost'));

    const res = await PATCH(createRequest({ jsonBody: { ids: [ID_ONE], decision: 'denied' } }));

    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      { feature: 'api_community_queue_bulk' },
    );
  });
});
