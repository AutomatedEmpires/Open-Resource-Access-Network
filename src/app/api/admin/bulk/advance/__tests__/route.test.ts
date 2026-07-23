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

function advanceSuccess(submissionId: string, toStatus: string) {
  return {
    success: true,
    submissionId,
    fromStatus: 'under_review',
    toStatus,
    transitionId: 'tr-1',
    gateResults: [],
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
  authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'oran_admin' });
  requireMinRoleMock.mockReturnValue(true);
  scopeMocks.getCommunityAdminScope.mockResolvedValue({ hasExplicitScope: false });
  guardMocks.lockBulkReviewSubmissions.mockResolvedValue(cleanPreflight());
  engineMocks.advanceInTransaction.mockImplementation(
    async (_client: unknown, req: { submissionId: string; toStatus: string }) =>
      advanceSuccess(req.submissionId, req.toStatus),
  );
  engineMocks.sendTerminalStatusEmail.mockResolvedValue(undefined);
});

describe('POST /api/admin/bulk/advance', () => {
  it('uses the shared limiter with the admin write key and honors backend unavailability', async () => {
    const { POST } = await loadRoute();

    rateLimitMock.mockResolvedValueOnce({
      exceeded: false,
      retryAfterSeconds: 45,
      backendUnavailable: true,
    });
    const res = await POST(createRequest({ ip: '203.0.113.4' }));

    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('45');
    expect(rateLimitMock).toHaveBeenCalledWith(
      'admin:bulk:advance:write:203.0.113.4',
      expect.objectContaining({ maxRequests: expect.any(Number) }),
    );
  });

  it('rejects unknown body keys via the strict schema', async () => {
    const { POST } = await loadRoute();

    const res = await POST(createRequest({
      jsonBody: { submissionIds: [ID_ONE], toStatus: 'escalated', sneaky: true },
    }));

    expect(res.status).toBe(400);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('scopes non-admin actors and reports inaccessible ids with 403', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    guardMocks.lockBulkReviewSubmissions.mockResolvedValueOnce(
      cleanPreflight({ inaccessibleIds: [ID_TWO] }),
    );
    const { POST } = await loadRoute();

    const res = await POST(createRequest({
      jsonBody: { submissionIds: [ID_ONE, ID_TWO], toStatus: 'escalated' },
    }));

    expect(guardMocks.lockBulkReviewSubmissions).toHaveBeenCalledWith(
      expect.anything(), [ID_ONE, ID_TWO], expect.anything(), false, 'community-1',
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ inaccessibleIds: [ID_TWO] });
  });

  it('blocks ownership and freshness conflicts for every target status', async () => {
    const { POST } = await loadRoute();

    guardMocks.lockBulkReviewSubmissions.mockResolvedValueOnce(
      cleanPreflight({ reviewOwnershipConflictIds: [ID_ONE] }),
    );
    const ownership = await POST(createRequest({
      jsonBody: { submissionIds: [ID_ONE], toStatus: 'escalated' },
    }));
    expect(ownership.status).toBe(409);

    guardMocks.lockBulkReviewSubmissions.mockResolvedValueOnce(
      cleanPreflight({ structuredFreshnessIds: [ID_ONE] }),
    );
    const freshness = await POST(createRequest({
      jsonBody: { submissionIds: [ID_ONE], toStatus: 'returned' },
    }));
    expect(freshness.status).toBe(409);
    await expect(freshness.json()).resolves.toMatchObject({ blockedIds: [ID_ONE] });

    expect(engineMocks.advanceInTransaction).not.toHaveBeenCalled();
  });

  it('blocks individual-review types only when advancing to approved', async () => {
    const { POST } = await loadRoute();

    guardMocks.lockBulkReviewSubmissions.mockResolvedValueOnce(
      cleanPreflight({ individualReviewRequiredIds: [ID_ONE] }),
    );
    const approved = await POST(createRequest({
      jsonBody: { submissionIds: [ID_ONE], toStatus: 'approved' },
    }));
    expect(approved.status).toBe(409);
    expect(engineMocks.advanceInTransaction).not.toHaveBeenCalled();

    guardMocks.lockBulkReviewSubmissions.mockResolvedValueOnce(
      cleanPreflight({ individualReviewRequiredIds: [ID_ONE] }),
    );
    const escalated = await POST(createRequest({
      jsonBody: { submissionIds: [ID_ONE], toStatus: 'escalated' },
    }));
    expect(escalated.status).toBe(200);
    expect(engineMocks.advanceInTransaction).toHaveBeenCalledTimes(1);
  });

  it('is all-or-nothing: one failed transition yields 409 and no emails', async () => {
    const { POST } = await loadRoute();
    engineMocks.advanceInTransaction
      .mockResolvedValueOnce(advanceSuccess(ID_ONE, 'escalated'))
      .mockResolvedValueOnce({ success: false, error: 'Transition not allowed' });

    const res = await POST(createRequest({
      jsonBody: { submissionIds: [ID_ONE, ID_TWO], toStatus: 'escalated' },
    }));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      failedSubmissionId: ID_TWO,
      reason: 'Transition not allowed',
    });
    expect(engineMocks.sendTerminalStatusEmail).not.toHaveBeenCalled();
  });

  it('advances every id, emails per result post-commit, and reports totals', async () => {
    const { POST } = await loadRoute();

    const res = await POST(createRequest({
      jsonBody: { submissionIds: [ID_ONE, ID_TWO], toStatus: 'denied', reason: 'duplicates' },
    }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      total: 2,
      succeeded: 2,
      failed: 0,
    });
    expect(engineMocks.sendTerminalStatusEmail).toHaveBeenCalledWith(ID_ONE, 'denied');
    expect(engineMocks.sendTerminalStatusEmail).toHaveBeenCalledWith(ID_TWO, 'denied');

    const txnOrder = dbMocks.withTransaction.mock.invocationCallOrder[0];
    const emailOrder = engineMocks.sendTerminalStatusEmail.mock.invocationCallOrder[0];
    expect(txnOrder).toBeLessThan(emailOrder);
  });
});
