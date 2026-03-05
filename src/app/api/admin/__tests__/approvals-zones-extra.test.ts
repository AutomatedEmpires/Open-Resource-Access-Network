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
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({
  requireMinRole: requireMinRoleMock,
}));
vi.mock('@/services/workflow/engine', () => engineMocks);

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
  engineMocks.releaseLock.mockResolvedValue(undefined);
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

    engineMocks.acquireLock.mockResolvedValueOnce(false);
    const lockFail = await POST(
      createRequest({
        jsonBody: { submissionId: SUBMISSION_ID, decision: 'approved' },
      }),
    );
    expect(lockFail.status).toBe(409);
  });

  it('releases lock when advance fails and returns 409', async () => {
    const { POST } = await loadApprovalsRoute();

    engineMocks.acquireLock.mockResolvedValueOnce(true);
    engineMocks.advance.mockResolvedValueOnce({ success: false, error: 'Invalid transition' });

    const response = await POST(
      createRequest({
        jsonBody: { submissionId: SUBMISSION_ID, decision: 'denied' },
      }),
    );

    expect(response.status).toBe(409);
    expect(engineMocks.releaseLock).toHaveBeenCalledWith(SUBMISSION_ID, 'admin-1', false);
  });

  it('updates reviewer notes and returns success payload', async () => {
    const { POST } = await loadApprovalsRoute();

    dbMocks.executeQuery.mockResolvedValueOnce([]); // reviewer_notes update
    engineMocks.acquireLock.mockResolvedValueOnce(true);
    engineMocks.advance.mockResolvedValueOnce({ success: true, fromStatus: 'under_review', toStatus: 'denied', transitionId: 'tx-2' });

    // withTransaction for 'approved' path runs first (no-op since decision is denied)
    // then denial cleanup withTransaction runs — client.query for SELECT returns no rows
    dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
      const client = { query: vi.fn().mockResolvedValue({ rows: [] }) };
      return callback(client);
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
    expect(dbMocks.executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE submissions SET reviewer_notes'),
      ['insufficient evidence', SUBMISSION_ID],
    );
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.id).toBe(SUBMISSION_ID);
  });

  it('best-effort releases lock on unexpected failures and returns 500', async () => {
    const { POST } = await loadApprovalsRoute();

    engineMocks.acquireLock.mockResolvedValueOnce(true);
    engineMocks.advance.mockRejectedValueOnce(new Error('engine crash'));
    engineMocks.releaseLock.mockRejectedValueOnce(new Error('release failed'));

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
