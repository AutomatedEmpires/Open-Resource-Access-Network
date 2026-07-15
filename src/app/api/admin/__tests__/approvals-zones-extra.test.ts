import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
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
  advance: vi.fn(),
  advanceInTransaction: vi.fn(),
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  sendTerminalStatusEmail: vi.fn(),
}));
const protectedMutationMocks = vi.hoisted(() => ({
  acquireAuthoritativeMutationGatesShared: vi.fn(),
  assertAuthoritativeEntitiesMutable: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
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
vi.mock('@/services/publication/protectedAuthoritativeMutation', () => ({
  ...protectedMutationMocks,
  ProtectedAuthoritativeMutationConflict: class ProtectedAuthoritativeMutationConflict extends Error {},
}));

function createRequest(options: {
  search?: string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const url = new URL(`https://oran.test${options.search ?? ''}`);
  const headers = new Headers();
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    nextUrl: url,
    url: url.toString(),
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

function createRouteContext(id: string) {
  return {
    params: Promise.resolve({ id }),
  } as never;
}

async function loadApprovalsRoute() {
  return import('../approvals/route');
}

async function loadZoneDetailRoute() {
  return import('../zones/[id]/route');
}

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';
const ZONE_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  engineMocks.advanceInTransaction.mockReset();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
    const client = { query: vi.fn() };
    return callback(client);
  });
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);

  authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1', role: 'oran_admin' });
  requireMinRoleMock.mockReturnValue(true);

  engineMocks.acquireLock.mockResolvedValue(true);
  engineMocks.advance.mockResolvedValue({ success: true, fromStatus: 'submitted', toStatus: 'approved', transitionId: 'tx-1' });
  engineMocks.advanceInTransaction.mockResolvedValue({
    success: true,
    submissionId: SUBMISSION_ID,
    fromStatus: 'submitted',
    toStatus: 'approved',
    transitionId: 'tx-1',
    gateResults: [],
  });
  engineMocks.releaseLock.mockResolvedValue(undefined);
  engineMocks.sendTerminalStatusEmail.mockResolvedValue(undefined);
  protectedMutationMocks.acquireAuthoritativeMutationGatesShared.mockResolvedValue(undefined);
  protectedMutationMocks.assertAuthoritativeEntitiesMutable.mockResolvedValue(undefined);
});

describe('admin approvals extra coverage', () => {
  it('covers GET db/rate/permission/validation/error branches', async () => {
    const { GET } = await loadApprovalsRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await GET(createRequest());
    expect(noDb.status).toBe(503);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await GET(createRequest());
    expect(limited.status).toBe(429);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await GET(createRequest());
    expect(forbidden.status).toBe(403);

    const invalid = await GET(createRequest({ search: '?page=0' }));
    expect(invalid.status).toBe(400);

    dbMocks.executeQuery.mockRejectedValueOnce(new Error('list fail'));
    const failed = await GET(createRequest());
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_approvals_list',
    });
  });

  it('covers POST db/rate/auth/permission/json/validation/lock-fail branches', async () => {
    const { POST } = await loadApprovalsRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await POST(createRequest());
    expect(noDb.status).toBe(503);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 7 });
    const limited = await POST(createRequest());
    expect(limited.status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await POST(createRequest());
    expect(unauth.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await POST(createRequest());
    expect(forbidden.status).toBe(403);

    const badJson = await POST(createRequest({ jsonError: true }));
    expect(badJson.status).toBe(400);

    const invalid = await POST(createRequest({ jsonBody: { submissionId: 'bad' } }));
    expect(invalid.status).toBe(400);

    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce({
            rows: [{
              service_id: null,
              target_id: null,
              submitted_by_user_id: 'user-1',
              account_status: 'active',
            }],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return callback(client);
    });
    const lockFail = await POST(
      createRequest({
        jsonBody: { submissionId: SUBMISSION_ID, decision: 'approved' },
      }),
    );
    expect(lockFail.status).toBe(409);
  });

  it('releases the transaction-scoped lock when advance fails and returns 409', async () => {
    const { POST } = await loadApprovalsRoute();

    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            service_id: null,
            target_id: 'org-1',
            submitted_by_user_id: 'user-1',
            account_status: 'active',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ id: SUBMISSION_ID }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (value: typeof client) => Promise<unknown>) => callback(client));
    engineMocks.advanceInTransaction.mockResolvedValueOnce({
      success: false,
      error: 'Invalid transition',
    });

    const response = await POST(
      createRequest({
        jsonBody: { submissionId: SUBMISSION_ID, decision: 'denied' },
      }),
    );

    expect(response.status).toBe(409);
    expect(client.query.mock.calls.some((call) =>
      String(call[0]).includes('locked_by_user_id = NULL'),
    )).toBe(true);
  });

  it('blocks approving claims for frozen submitters', async () => {
    const { POST } = await loadApprovalsRoute();

    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => callback({
      query: vi.fn().mockResolvedValueOnce({
        rows: [{
          service_id: null,
          target_id: 'org-1',
          submitted_by_user_id: 'user-1',
          account_status: 'frozen',
        }],
      }),
    }));

    const response = await POST(
      createRequest({
        jsonBody: { submissionId: SUBMISSION_ID, decision: 'approved' },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Cannot approve an organization claim for a frozen account' });
    expect(engineMocks.advanceInTransaction).not.toHaveBeenCalled();
  });

  it('updates reviewer notes and returns success payload', async () => {
    const { POST } = await loadApprovalsRoute();

    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            service_id: null,
            target_id: 'org-1',
            submitted_by_user_id: 'user-1',
            account_status: 'active',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ id: SUBMISSION_ID }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (value: typeof client) => Promise<unknown>) => callback(client));
    engineMocks.advanceInTransaction.mockResolvedValueOnce({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'under_review',
      toStatus: 'denied',
      transitionId: 'tx-2',
      gateResults: [],
    });

    const response = await POST(
      createRequest({
        jsonBody: {
          submissionId: SUBMISSION_ID,
          decision: 'denied',
          notes: 'insufficient evidence',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('reviewer_notes = $1'),
      ['insufficient evidence', SUBMISSION_ID],
    );
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.id).toBe(SUBMISSION_ID);
  });

  it('best-effort releases lock on unexpected failures and returns 500', async () => {
    const { POST } = await loadApprovalsRoute();

    const client = {
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            service_id: null,
            target_id: 'org-1',
            submitted_by_user_id: 'user-1',
            account_status: 'active',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ id: SUBMISSION_ID }] }),
    };
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (value: typeof client) => Promise<unknown>) => callback(client));
    engineMocks.advanceInTransaction.mockRejectedValueOnce(new Error('engine crash'));

    const response = await POST(
      createRequest({
        jsonBody: {
          submissionId: SUBMISSION_ID,
          decision: 'approved',
        },
      }),
    );

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_approvals_decide',
    });
  });

  it('rejects a UUID from another submission lane before any mutation', async () => {
    const { POST } = await loadApprovalsRoute();
    const client = { query: vi.fn().mockResolvedValueOnce({ rows: [] }) };
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (value: typeof client) => Promise<unknown>) => callback(client));

    const response = await POST(createRequest({
      jsonBody: { submissionId: SUBMISSION_ID, decision: 'approved' },
    }));

    expect(response.status).toBe(404);
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(String(client.query.mock.calls[0]?.[0])).toContain("submission_type = 'org_claim'");
    expect(engineMocks.advanceInTransaction).not.toHaveBeenCalled();
  });

  it('grants an inactive service owner access without reactivating the listing', async () => {
    const { POST } = await loadApprovalsRoute();
    const client = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT sub.service_id')) {
          return {
            rows: [{
              service_id: 'service-1',
              target_id: null,
              submitted_by_user_id: 'user-1',
              account_status: 'active',
            }],
          };
        }
        if (sql.includes('SELECT id, status, integrity_hold_at')) {
          return { rows: [{ id: 'service-1', status: 'inactive', integrity_hold_at: null }] };
        }
        if (sql.includes('SET is_locked = true')) return { rows: [{ id: SUBMISSION_ID }] };
        return { rows: [] };
      }),
    };
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (value: typeof client) => Promise<unknown>) => callback(client));

    const response = await POST(createRequest({
      jsonBody: { submissionId: SUBMISSION_ID, decision: 'approved' },
    }));

    expect(response.status).toBe(200);
    expect(dbMocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(engineMocks.advanceInTransaction).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ submissionId: SUBMISSION_ID, toStatus: 'approved' }),
    );
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE services')
    ))).toBe(false);
    expect(engineMocks.sendTerminalStatusEmail).toHaveBeenCalled();
  });

  it('blocks a claim approval while the linked service has an integrity hold', async () => {
    const { POST } = await loadApprovalsRoute();
    const client = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT sub.service_id')) {
          return {
            rows: [{
              service_id: 'service-1',
              target_id: null,
              submitted_by_user_id: 'user-1',
              account_status: 'active',
            }],
          };
        }
        if (sql.includes('SELECT id, status, integrity_hold_at')) {
          return {
            rows: [{
              id: 'service-1',
              status: 'inactive',
              integrity_hold_at: '2026-07-14T00:00:00.000Z',
            }],
          };
        }
        return { rows: [] };
      }),
    };
    dbMocks.withTransaction.mockImplementationOnce(
      async (callback: (value: typeof client) => Promise<unknown>) => callback(client),
    );

    const response = await POST(createRequest({
      jsonBody: { submissionId: SUBMISSION_ID, decision: 'approved' },
    }));

    expect(response.status).toBe(409);
    expect(engineMocks.advanceInTransaction).not.toHaveBeenCalled();
    expect(client.query.mock.calls.some(([sql]) => (
      String(sql).includes('UPDATE services')
    ))).toBe(false);
  });
});

describe('admin zones detail extra coverage', () => {
  it('covers PUT branches including auth/rate/json/validation/not-found/error', async () => {
    const { PUT } = await loadZoneDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await PUT(createRequest(), createRouteContext(ZONE_ID));
    expect(noDb.status).toBe(503);

    const invalidId = await PUT(createRequest(), createRouteContext('bad-id'));
    expect(invalidId.status).toBe(400);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 4 });
    const limited = await PUT(createRequest(), createRouteContext(ZONE_ID));
    expect(limited.status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await PUT(createRequest(), createRouteContext(ZONE_ID));
    expect(unauth.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await PUT(createRequest(), createRouteContext(ZONE_ID));
    expect(forbidden.status).toBe(403);

    const badJson = await PUT(createRequest({ jsonError: true }), createRouteContext(ZONE_ID));
    expect(badJson.status).toBe(400);

    const invalidBody = await PUT(createRequest({ jsonBody: { status: 'broken' } }), createRouteContext(ZONE_ID));
    expect(invalidBody.status).toBe(400);

    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const missing = await PUT(createRequest({ jsonBody: { name: 'Updated Zone' } }), createRouteContext(ZONE_ID));
    expect(missing.status).toBe(404);

    dbMocks.executeQuery.mockRejectedValueOnce(new Error('update fail'));
    const failed = await PUT(createRequest({ jsonBody: { name: 'Updated Zone' } }), createRouteContext(ZONE_ID));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_zones_update',
    });
  });

  it('covers DELETE branches including auth/rate/not-found/error', async () => {
    const { DELETE } = await loadZoneDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await DELETE(createRequest(), createRouteContext(ZONE_ID));
    expect(noDb.status).toBe(503);

    const invalidId = await DELETE(createRequest(), createRouteContext('bad-id'));
    expect(invalidId.status).toBe(400);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 4 });
    const limited = await DELETE(createRequest(), createRouteContext(ZONE_ID));
    expect(limited.status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await DELETE(createRequest(), createRouteContext(ZONE_ID));
    expect(unauth.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await DELETE(createRequest(), createRouteContext(ZONE_ID));
    expect(forbidden.status).toBe(403);

    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const missing = await DELETE(createRequest(), createRouteContext(ZONE_ID));
    expect(missing.status).toBe(404);

    dbMocks.executeQuery.mockRejectedValueOnce(new Error('delete fail'));
    const failed = await DELETE(createRequest(), createRouteContext(ZONE_ID));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_zones_delete',
    });
  });
});
