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
  isOranAdmin: vi.fn(),
  requireOrgAccess: vi.fn(),
  shouldEnforceAuth: vi.fn(),
}));
const hostPortalIntakeMocks = vi.hoisted(() => ({
  createHostPortalSourceAssertion: vi.fn(),
  queueServiceVerificationSubmission: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth', () => authMocks);
vi.mock('@/services/workflow/engine', () => ({
  applySla: vi.fn(),
}));
vi.mock('@/services/ingestion/hostPortalIntake', () => hostPortalIntakeMocks);

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

async function loadLocationsCollectionRoute() {
  return import('../locations/route');
}

async function loadServicesCollectionRoute() {
  return import('../services/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
    const client = { query: vi.fn() };
    return callback(client);
  });

  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  captureExceptionMock.mockResolvedValue(undefined);

  authMocks.getAuthContext.mockResolvedValue(null);
  authMocks.isOranAdmin.mockReturnValue(false);
  authMocks.requireOrgAccess.mockReturnValue(true);
  authMocks.shouldEnforceAuth.mockReturnValue(false);
  hostPortalIntakeMocks.createHostPortalSourceAssertion.mockResolvedValue({
    sourceSystemId: 'source-system-1',
    sourceFeedId: 'source-feed-1',
    sourceRecordId: 'source-record-1',
  });
  hostPortalIntakeMocks.queueServiceVerificationSubmission.mockResolvedValue('submission-1');
});

describe('host locations collection route coverage', () => {
  it('returns 429 when read rate limit is exceeded and uses first forwarded IP', async () => {
    rateLimitMock.mockReturnValueOnce({
      exceeded: true,
      retryAfterSeconds: 17,
    });
    const { GET } = await loadLocationsCollectionRoute();

    const response = await GET(createRequest({ ip: '203.0.113.10, 10.0.0.1' }));

    expect(rateLimitMock).toHaveBeenCalledWith(
      'host:loc:read:203.0.113.10',
      expect.any(Object),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('17');
  });

  it('returns empty results for scoped users with no organization memberships', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-1',
      role: 'host_member',
      orgIds: [],
      orgRoles: new Map(),
    });
    const { GET } = await loadLocationsCollectionRoute();

    const response = await GET(createRequest({ search: '?page=3' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [],
      total: 0,
      page: 3,
      hasMore: false,
    });
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('lists locations with pagination metadata', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.isOranAdmin.mockReturnValueOnce(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([
        { id: 'loc-1', name: 'A' },
        { id: 'loc-2', name: 'B' },
      ]);
    const { GET } = await loadLocationsCollectionRoute();

    const response = await GET(createRequest({ search: '?page=1&limit=2' }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(response.json()).resolves.toEqual({
      results: [
        { id: 'loc-1', name: 'A' },
        { id: 'loc-2', name: 'B' },
      ],
      total: 3,
      page: 1,
      hasMore: true,
    });
  });

  it('captures exceptions and returns 500 when location listing fails', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('db exploded'));
    const { GET } = await loadLocationsCollectionRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      { feature: 'api_host_locations_list' },
    );
  });

  it('returns 400 for invalid JSON and 403 for disallowed organization writes', async () => {
    const { POST } = await loadLocationsCollectionRoute();

    const badJsonResponse = await POST(createRequest({ jsonError: true }));
    expect(badJsonResponse.status).toBe(400);
    await expect(badJsonResponse.json()).resolves.toEqual({ error: 'Invalid JSON body' });

    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-2',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValueOnce(false);

    const forbiddenResponse = await POST(
      createRequest({
        jsonBody: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          name: 'Downtown Office',
        },
      }),
    );
    expect(forbiddenResponse.status).toBe(403);
    await expect(forbiddenResponse.json()).resolves.toEqual({
      error: 'Access denied to this organization',
    });
  });

  it('creates location + address in a transaction and returns 201', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'org-1', status: 'active' }]);

    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'loc-1', organization_id: '11111111-1111-4111-8111-111111111111', name: 'Downtown Office' }],
      })
      .mockResolvedValueOnce({ rows: [] });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: { query: typeof clientQuery }) => Promise<unknown>) => {
      return callback({ query: clientQuery });
    });

    const { POST } = await loadLocationsCollectionRoute();
    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          name: 'Downtown Office',
          address1: '123 Main St',
          city: 'Seattle',
          stateProvince: 'WA',
          postalCode: '98101',
        },
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'loc-1',
      organization_id: '11111111-1111-4111-8111-111111111111',
      name: 'Downtown Office',
    });
    expect(hostPortalIntakeMocks.createHostPortalSourceAssertion).toHaveBeenCalledWith(
      { query: clientQuery },
      {
        actorUserId: 'user-1',
        actorRole: 'host_admin',
        recordType: 'host_location_create',
        recordId: 'loc-1',
        canonicalSourceUrl: 'oran://host-portal/locations/loc-1',
        payload: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          locationId: 'loc-1',
          name: 'Downtown Office',
          alternateName: null,
          description: null,
          transportation: null,
          latitude: null,
          longitude: null,
          address: {
            address1: '123 Main St',
            address2: null,
            city: 'Seattle',
            stateProvince: 'WA',
            postalCode: '98101',
            country: 'US',
          },
          phones: [],
          schedule: [],
        },
      },
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO addresses'),
      expect.arrayContaining(['loc-1', '123 Main St', 'Seattle', 'WA', '98101']),
    );
  });
});

describe('host services collection route coverage', () => {
  it('returns empty results for non-admin users with no org memberships', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-1',
      role: 'host_member',
      orgIds: [],
      orgRoles: new Map(),
    });
    const { GET } = await loadServicesCollectionRoute();

    const response = await GET(createRequest({ search: '?page=2' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [],
      total: 0,
      page: 2,
      hasMore: false,
    });
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('applies default non-defunct filter and returns paginated rows', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.isOranAdmin.mockReturnValueOnce(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 2 }])
      .mockResolvedValueOnce([{ id: 'svc-1', name: 'Pantry' }]);
    const { GET } = await loadServicesCollectionRoute();

    const response = await GET(createRequest({ search: '?page=1&limit=1&q=food' }));

    expect(response.status).toBe(200);
    expect(dbMocks.executeQuery.mock.calls[0]?.[0]).toContain("s.status != 'defunct'");
    await expect(response.json()).resolves.toEqual({
      results: [{ id: 'svc-1', name: 'Pantry' }],
      total: 2,
      page: 1,
      hasMore: true,
    });
  });

  it('returns 500 and captures exceptions on service list errors', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('service list failed'));
    const { GET } = await loadServicesCollectionRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      { feature: 'api_host_services_list' },
    );
  });

  it('creates service and submission entry in one transaction', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'org-1', status: 'active' }]);

    const clientQuery = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 'svc-1', organization_id: '11111111-1111-4111-8111-111111111111', name: 'Pantry Service', status: 'inactive' }],
      })
      .mockResolvedValueOnce({ rows: [] });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: { query: typeof clientQuery }) => Promise<unknown>) => {
      return callback({ query: clientQuery });
    });

    const { POST } = await loadServicesCollectionRoute();
    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          name: 'Pantry Service',
        },
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'svc-1',
      organization_id: '11111111-1111-4111-8111-111111111111',
      name: 'Pantry Service',
      status: 'inactive',
      queuedForReview: true,
      submissionId: 'submission-1',
      sourceRecordId: 'source-record-1',
      message: 'Service submitted for review. It will publish after approval.',
    });
  });

  it('returns 500 and captures exceptions on service create failures', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'org-1', status: 'active' }]);
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('insert failed'));
    const { POST } = await loadServicesCollectionRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          name: 'Pantry Service',
        },
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      { feature: 'api_host_services_create' },
    );
  });
});
