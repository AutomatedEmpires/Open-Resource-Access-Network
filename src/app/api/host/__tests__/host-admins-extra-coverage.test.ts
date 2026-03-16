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
  shouldEnforceAuth: vi.fn(),
  requireOrgRole: vi.fn(),
  requireOrgAccess: vi.fn(),
  isOranAdmin: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/security/ip', () => ({
  getIp: () => '127.0.0.1',
}));
vi.mock('@/services/auth', () => authMocks);

type RequestOptions = {
  search?: string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
};

function createRequest(options: RequestOptions = {}) {
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

async function loadAdminsCollectionRoute() {
  return import('../admins/route');
}

async function loadAdminsDetailRoute() {
  return import('../admins/[id]/route');
}

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const MEMBER_ID = '33333333-3333-4333-8333-333333333333';

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

  authMocks.getAuthContext.mockResolvedValue(null);
  authMocks.shouldEnforceAuth.mockReturnValue(false);
  authMocks.requireOrgRole.mockReturnValue(true);
  authMocks.requireOrgAccess.mockReturnValue(true);
  authMocks.isOranAdmin.mockReturnValue(false);
});

describe('host admins collection extra coverage', () => {
  it('returns Unauthorized when auth enforcement is enabled and no user exists', async () => {
    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const { GET } = await loadAdminsCollectionRoute();

    const response = await GET(createRequest({ search: `?organizationId=${ORG_ID}` }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns Authentication required when no user exists and auth enforcement is disabled', async () => {
    const { GET } = await loadAdminsCollectionRoute();

    const response = await GET(createRequest({ search: `?organizationId=${ORG_ID}` }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns 503 when POST is called without database configuration', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(createRequest());

    expect(response.status).toBe(503);
  });

  it('returns 429 when POST write rate limit is exceeded', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 11 });
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(createRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('11');
  });

  it('returns Unauthorized on POST when auth enforcement is enabled and no user exists', async () => {
    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(createRequest({ jsonBody: {} }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns Authentication required on POST when no user exists and enforcement is disabled', async () => {
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(createRequest({ jsonBody: {} }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns 400 for invalid JSON body on POST', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for validation errors on POST', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(createRequest({ jsonBody: { organizationId: ORG_ID } }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 403 on POST when user lacks org role and is not oran admin', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    authMocks.requireOrgRole.mockReturnValueOnce(false);
    authMocks.isOranAdmin.mockReturnValueOnce(false);
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: ORG_ID,
          userId: USER_ID,
          role: 'host_member',
          inviteMode: false,
        },
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('creates pending invite memberships when inviteMode=true', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: ORG_ID }] })
      .mockResolvedValueOnce({ rows: [{ user_id: USER_ID, account_status: 'active' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: MEMBER_ID, user_id: USER_ID, organization_id: ORG_ID, role: 'host_member', status: 'pending_invite' }],
      });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: { query: typeof query }) => Promise<unknown>) => {
      return callback({ query });
    });

    const { POST } = await loadAdminsCollectionRoute();
    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: ORG_ID,
          userId: USER_ID,
          role: 'host_member',
          inviteMode: true,
        },
      }),
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.status).toBe('pending_invite');
    expect(query.mock.calls[3]?.[1]).toEqual([ORG_ID, USER_ID, 'host_member', 'pending_invite']);
  });

  it('blocks inviting or restoring frozen accounts', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: ORG_ID }] })
      .mockResolvedValueOnce({ rows: [{ user_id: USER_ID, account_status: 'frozen' }] });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: { query: typeof query }) => Promise<unknown>) => {
      return callback({ query });
    });

    const { POST } = await loadAdminsCollectionRoute();
    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: ORG_ID,
          userId: USER_ID,
          role: 'host_member',
          inviteMode: false,
        },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'Cannot invite or restore access for a frozen account' });
  });

  it('returns 500 and captures exceptions when POST transaction fails', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('insert failed'));
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: ORG_ID,
          userId: USER_ID,
          role: 'host_member',
          inviteMode: false,
        },
      }),
    );

    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_admins_invite',
    });
  });

  it('covers PATCH auth, validation, not-found, and internal-error paths', async () => {
    const { PATCH } = await loadAdminsCollectionRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const dbOff = await PATCH(createRequest());
    expect(dbOff.status).toBe(503);

    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 8 });
    const limited = await PATCH(createRequest());
    expect(limited.status).toBe(429);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await PATCH(createRequest({ jsonBody: {} }));
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ error: 'Unauthorized' });

    authMocks.shouldEnforceAuth.mockReturnValueOnce(false);
    const authRequired = await PATCH(createRequest({ jsonBody: {} }));
    expect(authRequired.status).toBe(401);
    await expect(authRequired.json()).resolves.toEqual({ error: 'Authentication required' });

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    const badJson = await PATCH(createRequest({ jsonError: true }));
    expect(badJson.status).toBe(400);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    const invalid = await PATCH(createRequest({ jsonBody: { membershipId: MEMBER_ID, action: 'bad' } }));
    expect(invalid.status).toBe(400);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const notFound = await PATCH(createRequest({ jsonBody: { membershipId: MEMBER_ID, action: 'decline' } }));
    expect(notFound.status).toBe(404);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('update failed'));
    const failed = await PATCH(createRequest({ jsonBody: { membershipId: MEMBER_ID, action: 'accept' } }));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_admins_respond_invite',
    });
  });
});

describe('host admins detail extra coverage', () => {
  it('covers GET db/validation/rate/auth/error branches', async () => {
    const { GET } = await loadAdminsDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await GET(createRequest(), createRouteContext(MEMBER_ID));
    expect(noDb.status).toBe(503);

    const invalidId = await GET(createRequest(), createRouteContext('bad-id'));
    expect(invalidId.status).toBe(400);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 5 });
    const limited = await GET(createRequest(), createRouteContext(MEMBER_ID));
    expect(limited.status).toBe(429);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await GET(createRequest(), createRouteContext(MEMBER_ID));
    expect(unauthorized.status).toBe(401);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(false);
    const authRequired = await GET(createRequest(), createRouteContext(MEMBER_ID));
    expect(authRequired.status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('select failed'));
    const errored = await GET(createRequest(), createRouteContext(MEMBER_ID));
    expect(errored.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_admins_get',
    });
  });

  it('covers PUT db/validation/rate/auth/result/catch branches', async () => {
    const { PUT } = await loadAdminsDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await PUT(createRequest(), createRouteContext(MEMBER_ID));
    expect(noDb.status).toBe(503);

    const invalidId = await PUT(createRequest(), createRouteContext('bad-id'));
    expect(invalidId.status).toBe(400);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 6 });
    const limited = await PUT(createRequest(), createRouteContext(MEMBER_ID));
    expect(limited.status).toBe(429);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await PUT(createRequest({ jsonBody: {} }), createRouteContext(MEMBER_ID));
    expect(unauthorized.status).toBe(401);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(false);
    const authRequired = await PUT(createRequest({ jsonBody: {} }), createRouteContext(MEMBER_ID));
    expect(authRequired.status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    const badJson = await PUT(createRequest({ jsonError: true }), createRouteContext(MEMBER_ID));
    expect(badJson.status).toBe(400);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    const invalid = await PUT(createRequest({ jsonBody: {} }), createRouteContext(MEMBER_ID));
    expect(invalid.status).toBe(400);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    dbMocks.withTransaction.mockResolvedValueOnce({ error: 'Member not found', status: 404 });
    const missing = await PUT(createRequest({ jsonBody: { role: 'host_member' } }), createRouteContext(MEMBER_ID));
    expect(missing.status).toBe(404);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    dbMocks.withTransaction.mockResolvedValueOnce({ error: 'Forbidden', status: 403 });
    const forbidden = await PUT(createRequest({ jsonBody: { role: 'host_member' } }), createRouteContext(MEMBER_ID));
    expect(forbidden.status).toBe(403);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('tx fail'));
    const failed = await PUT(createRequest({ jsonBody: { role: 'host_member' } }), createRouteContext(MEMBER_ID));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_admins_update',
    });
  });

  it('covers DELETE db/validation/rate/auth/result/catch branches', async () => {
    const { DELETE } = await loadAdminsDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await DELETE(createRequest(), createRouteContext(MEMBER_ID));
    expect(noDb.status).toBe(503);

    const invalidId = await DELETE(createRequest(), createRouteContext('bad-id'));
    expect(invalidId.status).toBe(400);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await DELETE(createRequest(), createRouteContext(MEMBER_ID));
    expect(limited.status).toBe(429);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await DELETE(createRequest(), createRouteContext(MEMBER_ID));
    expect(unauthorized.status).toBe(401);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(false);
    const authRequired = await DELETE(createRequest(), createRouteContext(MEMBER_ID));
    expect(authRequired.status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    dbMocks.withTransaction.mockResolvedValueOnce({ error: 'Member not found', status: 404 });
    const notFound = await DELETE(createRequest(), createRouteContext(MEMBER_ID));
    expect(notFound.status).toBe(404);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    dbMocks.withTransaction.mockResolvedValueOnce({ error: 'Forbidden', status: 403 });
    const forbidden = await DELETE(createRequest(), createRouteContext(MEMBER_ID));
    expect(forbidden.status).toBe(403);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID });
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('tx failed'));
    const failed = await DELETE(createRequest(), createRouteContext(MEMBER_ID));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_admins_delete',
    });
  });
});
