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
  requireOrgAccess: vi.fn(),
  requireOrgRole: vi.fn(),
  isOranAdmin: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth', () => authMocks);
vi.mock('@/services/ingestion/hostPortalIntake', () => ({
  createHostPortalSourceAssertion: vi.fn().mockResolvedValue({ sourceRecordId: 'source-mock' }),
}));

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

async function loadOrganizationsCollectionRoute() {
  return import('../organizations/route');
}

async function loadOrganizationDetailRoute() {
  return import('../organizations/[id]/route');
}

async function loadServiceDetailRoute() {
  return import('../services/[id]/route');
}

async function loadLocationDetailRoute() {
  return import('../locations/[id]/route');
}

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const SVC_ID = '33333333-3333-4333-8333-333333333333';
const LOC_ID = '44444444-4444-4444-8444-444444444444';

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
  authMocks.requireOrgAccess.mockReturnValue(true);
  authMocks.requireOrgRole.mockReturnValue(true);
  authMocks.isOranAdmin.mockReturnValue(false);
});

describe('host organizations collection extra coverage', () => {
  it('covers GET auth, scoped-empty, filtered success, and error branches', async () => {
    const { GET } = await loadOrganizationsCollectionRoute();

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await GET(createRequest());
    expect(unauthorized.status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, role: 'host_member', orgIds: [], orgRoles: new Map() });
    const empty = await GET(createRequest({ search: '?page=2' }));
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ results: [], total: 0, page: 2, hasMore: false });

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, role: 'host_admin', orgIds: [ORG_ID], orgRoles: new Map([[ORG_ID, 'host_admin']]) });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ id: ORG_ID, name: 'Org One' }]);
    const filtered = await GET(createRequest({ search: '?q=org&page=1&limit=5' }));
    expect(filtered.status).toBe(200);
    expect(dbMocks.executeQuery.mock.calls[0]?.[0]).toContain('id = ANY');
    expect(dbMocks.executeQuery.mock.calls[0]?.[0]).toContain('to_tsvector');

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, role: 'host_admin', orgIds: [ORG_ID], orgRoles: new Map([[ORG_ID, 'host_admin']]) });
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('list failure'));
    const failed = await GET(createRequest());
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_organizations_list',
    });
  });

  it('covers POST db/auth/rate/json/validation/success/catch branches', async () => {
    const { POST } = await loadOrganizationsCollectionRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await POST(createRequest());
    expect(noDb.status).toBe(503);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await POST(createRequest({ jsonBody: { name: 'Org' } }));
    expect(unauthorized.status).toBe(401);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 12 });
    const limited = await POST(createRequest({ jsonBody: { name: 'Org' } }));
    expect(limited.status).toBe(429);

    const badJson = await POST(createRequest({ jsonError: true }));
    expect(badJson.status).toBe(400);

    const invalid = await POST(createRequest({ jsonBody: {} }));
    expect(invalid.status).toBe(400);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, role: 'host_admin', orgIds: [ORG_ID], orgRoles: new Map() });
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: ORG_ID, name: 'Org Created' }] })
      .mockRejectedValueOnce(new Error('missing table')); // swallowed in route
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: { query: typeof query }) => Promise<unknown>) => {
      return callback({ query });
    });
    const created = await POST(createRequest({ jsonBody: { name: 'Org Created' } }));
    expect(created.status).toBe(201);

    dbMocks.withTransaction.mockRejectedValueOnce(new Error('tx blew up'));
    const failed = await POST(createRequest({ jsonBody: { name: 'Broken Org' } }));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_organizations_create',
    });
  });
});

describe('host organization detail extra coverage', () => {
  it('covers GET validation/rate/auth/access/error branches', async () => {
    const { GET } = await loadOrganizationDetailRoute();

    const invalidId = await GET(createRequest(), createRouteContext('bad-id'));
    expect(invalidId.status).toBe(400);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 10 });
    const limited = await GET(createRequest(), createRouteContext(ORG_ID));
    expect(limited.status).toBe(429);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await GET(createRequest(), createRouteContext(ORG_ID));
    expect(unauthorized.status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, orgIds: [], role: 'host_member', orgRoles: new Map() });
    authMocks.requireOrgAccess.mockReturnValueOnce(false);
    const denied = await GET(createRequest(), createRouteContext(ORG_ID));
    expect(denied.status).toBe(403);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, orgIds: [ORG_ID], role: 'host_admin', orgRoles: new Map([[ORG_ID, 'host_admin']]) });
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('query fail'));
    const errored = await GET(createRequest(), createRouteContext(ORG_ID));
    expect(errored.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_org_get',
    });
  });

  it('covers PUT db/auth/rate/json/validation/not-found/error branches', async () => {
    const { PUT } = await loadOrganizationDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await PUT(createRequest(), createRouteContext(ORG_ID));
    expect(noDb.status).toBe(503);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(ORG_ID));
    expect(unauthorized.status).toBe(401);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 4 });
    const limited = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(ORG_ID));
    expect(limited.status).toBe(429);

    const badJson = await PUT(createRequest({ jsonError: true }), createRouteContext(ORG_ID));
    expect(badJson.status).toBe(400);

    const invalid = await PUT(createRequest({ jsonBody: {} }), createRouteContext(ORG_ID));
    expect(invalid.status).toBe(400);

    // executeQuery default returns [] → route returns 404 before withTransaction
    const missing = await PUT(createRequest({ jsonBody: { name: 'Updated' } }), createRouteContext(ORG_ID));
    expect(missing.status).toBe(404);

    dbMocks.executeQuery.mockResolvedValueOnce([{ id: ORG_ID }]);
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('update fail'));
    const failed = await PUT(createRequest({ jsonBody: { name: 'Updated' } }), createRouteContext(ORG_ID));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_org_update',
    });
  });

  it('covers DELETE db/auth/forbidden/rate/not-found/error branches', async () => {
    const { DELETE } = await loadOrganizationDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await DELETE(createRequest(), createRouteContext(ORG_ID));
    expect(noDb.status).toBe(503);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await DELETE(createRequest(), createRouteContext(ORG_ID));
    expect(unauthorized.status).toBe(401);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, role: 'host_member', orgIds: [ORG_ID], orgRoles: new Map() });
    authMocks.requireOrgRole.mockReturnValueOnce(false);
    const forbidden = await DELETE(createRequest(), createRouteContext(ORG_ID));
    expect(forbidden.status).toBe(403);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, role: 'host_admin', orgIds: [ORG_ID], orgRoles: new Map([[ORG_ID, 'host_admin']]) });
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await DELETE(createRequest(), createRouteContext(ORG_ID));
    expect(limited.status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, role: 'host_admin', orgIds: [ORG_ID], orgRoles: new Map([[ORG_ID, 'host_admin']]) });
    // executeQuery default returns [] → route returns 404 before withTransaction
    const missing = await DELETE(createRequest(), createRouteContext(ORG_ID));
    expect(missing.status).toBe(404);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, role: 'host_admin', orgIds: [ORG_ID], orgRoles: new Map([[ORG_ID, 'host_admin']]) });
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: ORG_ID }]);
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('delete fail'));
    const failed = await DELETE(createRequest(), createRouteContext(ORG_ID));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_org_delete',
    });
  });
});

describe('host service detail extra coverage', () => {
  it('covers GET db/validation/auth/rate/access/error branches', async () => {
    const { GET } = await loadServiceDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await GET(createRequest(), createRouteContext(SVC_ID));
    expect(noDb.status).toBe(503);

    const invalidId = await GET(createRequest(), createRouteContext('bad-id'));
    expect(invalidId.status).toBe(400);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await GET(createRequest(), createRouteContext(SVC_ID));
    expect(unauthorized.status).toBe(401);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 7 });
    const limited = await GET(createRequest(), createRouteContext(SVC_ID));
    expect(limited.status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, role: 'host_member', orgIds: [ORG_ID], orgRoles: new Map() });
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: SVC_ID, organization_id: ORG_ID }]);
    authMocks.requireOrgAccess.mockReturnValueOnce(false);
    const denied = await GET(createRequest(), createRouteContext(SVC_ID));
    expect(denied.status).toBe(403);

    dbMocks.executeQuery.mockRejectedValueOnce(new Error('svc read fail'));
    const failed = await GET(createRequest(), createRouteContext(SVC_ID));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_svc_get',
    });
  });

  it('covers PUT db/validation/auth/rate/json/not-found/error branches', async () => {
    const { PUT } = await loadServiceDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await PUT(createRequest(), createRouteContext(SVC_ID));
    expect(noDb.status).toBe(503);

    const invalidId = await PUT(createRequest(), createRouteContext('bad-id'));
    expect(invalidId.status).toBe(400);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(SVC_ID));
    expect(unauthorized.status).toBe(401);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 3 });
    const limited = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(SVC_ID));
    expect(limited.status).toBe(429);

    const badJson = await PUT(createRequest({ jsonError: true }), createRouteContext(SVC_ID));
    expect(badJson.status).toBe(400);

    const invalid = await PUT(createRequest({ jsonBody: {} }), createRouteContext(SVC_ID));
    expect(invalid.status).toBe(400);

    dbMocks.executeQuery.mockRejectedValueOnce(new Error('check failed'));
    const checkFail = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(SVC_ID));
    expect(checkFail.status).toBe(500);

    dbMocks.executeQuery.mockResolvedValueOnce([{ organization_id: ORG_ID }]).mockResolvedValueOnce([]);
    const missing = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(SVC_ID));
    expect(missing.status).toBe(404);

    dbMocks.executeQuery.mockResolvedValueOnce([{ organization_id: ORG_ID }]).mockRejectedValueOnce(new Error('update failed'));
    const updateFail = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(SVC_ID));
    expect(updateFail.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_svc_update',
    });
  });

  it('covers DELETE db/validation/auth/rate/not-found/error branches', async () => {
    const { DELETE } = await loadServiceDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await DELETE(createRequest(), createRouteContext(SVC_ID));
    expect(noDb.status).toBe(503);

    const invalidId = await DELETE(createRequest(), createRouteContext('bad-id'));
    expect(invalidId.status).toBe(400);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await DELETE(createRequest(), createRouteContext(SVC_ID));
    expect(unauthorized.status).toBe(401);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 5 });
    const limited = await DELETE(createRequest(), createRouteContext(SVC_ID));
    expect(limited.status).toBe(429);

    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const missing = await DELETE(createRequest(), createRouteContext(SVC_ID));
    expect(missing.status).toBe(404);

    dbMocks.executeQuery.mockRejectedValueOnce(new Error('delete fail'));
    const failed = await DELETE(createRequest(), createRouteContext(SVC_ID));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_svc_delete',
    });
  });
});

describe('host location detail extra coverage', () => {
  it('covers GET db/validation/auth/rate/access/error branches', async () => {
    const { GET } = await loadLocationDetailRoute();

    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const noDb = await GET(createRequest(), createRouteContext(LOC_ID));
    expect(noDb.status).toBe(503);

    const invalidId = await GET(createRequest(), createRouteContext('bad-id'));
    expect(invalidId.status).toBe(400);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const unauthorized = await GET(createRequest(), createRouteContext(LOC_ID));
    expect(unauthorized.status).toBe(401);

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 5 });
    const limited = await GET(createRequest(), createRouteContext(LOC_ID));
    expect(limited.status).toBe(429);

    authMocks.getAuthContext.mockResolvedValueOnce({ userId: USER_ID, role: 'host_member', orgIds: [ORG_ID], orgRoles: new Map() });
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: LOC_ID, organization_id: ORG_ID }]);
    authMocks.requireOrgAccess.mockReturnValueOnce(false);
    const denied = await GET(createRequest(), createRouteContext(LOC_ID));
    expect(denied.status).toBe(403);

    dbMocks.executeQuery.mockRejectedValueOnce(new Error('loc read fail'));
    const failed = await GET(createRequest(), createRouteContext(LOC_ID));
    expect(failed.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_loc_get',
    });
  });

  it('covers PUT/DELETE edge and fallback branches', async () => {
    const { PUT, DELETE } = await loadLocationDetailRoute();

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const putUnauthorized = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(LOC_ID));
    expect(putUnauthorized.status).toBe(401);

    dbMocks.withTransaction.mockResolvedValueOnce({ forbidden: true });
    const putForbidden = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(LOC_ID));
    expect(putForbidden.status).toBe(403);

    dbMocks.withTransaction.mockResolvedValueOnce(null);
    const putMissing = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(LOC_ID));
    expect(putMissing.status).toBe(404);

    dbMocks.withTransaction.mockRejectedValueOnce(new Error('tx failed'));
    const putFailed = await PUT(createRequest({ jsonBody: { name: 'x' } }), createRouteContext(LOC_ID));
    expect(putFailed.status).toBe(500);

    authMocks.shouldEnforceAuth.mockReturnValueOnce(true);
    const deleteUnauthorized = await DELETE(createRequest(), createRouteContext(LOC_ID));
    expect(deleteUnauthorized.status).toBe(401);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{ id: LOC_ID, organization_id: ORG_ID }])
      .mockRejectedValueOnce(new Error('column "status" of relation "locations" does not exist'))
      .mockResolvedValueOnce([{ id: LOC_ID }]);
    const fallbackDeleted = await DELETE(createRequest(), createRouteContext(LOC_ID));
    expect(fallbackDeleted.status).toBe(200);
    await expect(fallbackDeleted.json()).resolves.toEqual({ deleted: true, id: LOC_ID });

    dbMocks.executeQuery
      .mockResolvedValueOnce([{ id: LOC_ID, organization_id: ORG_ID }])
      .mockRejectedValueOnce(new Error('column "status" of relation "locations" does not exist'))
      .mockResolvedValueOnce([]);
    const fallbackMissing = await DELETE(createRequest(), createRouteContext(LOC_ID));
    expect(fallbackMissing.status).toBe(404);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{ id: LOC_ID, organization_id: ORG_ID }])
      .mockRejectedValueOnce(new Error('unexpected db error'));
    const failedDelete = await DELETE(createRequest(), createRouteContext(LOC_ID));
    expect(failedDelete.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_host_loc_delete',
    });
  });
});
