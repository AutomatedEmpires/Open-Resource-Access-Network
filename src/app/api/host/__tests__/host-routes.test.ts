import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const getIpMock = vi.hoisted(() => vi.fn());

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  isAuthConfigured: vi.fn(),
  isOranAdmin: vi.fn(),
  requireOrgAccess: vi.fn(),
  requireOrgRole: vi.fn(),
  shouldEnforceAuth: vi.fn(),
}));
const hostPortalIntakeMocks = vi.hoisted(() => ({
  createHostPortalSourceAssertion: vi.fn(),
  queueServiceVerificationSubmission: vi.fn(),
}));
const resourceSubmissionMocks = vi.hoisted(() => ({
  createResourceSubmission: vi.fn(),
  getResourceSubmissionDetailForActor: vi.fn(),
}));
const submissionExecutionMocks = vi.hoisted(() => ({
  processSubmittedResourceSubmission: vi.fn(),
}));
const workflowMocks = vi.hoisted(() => ({
  applySla: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/security/ip', () => ({
  getIp: getIpMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth', () => authMocks);
vi.mock('@/services/workflow/engine', () => workflowMocks);
vi.mock('@/services/ingestion/hostPortalIntake', () => hostPortalIntakeMocks);
vi.mock('@/services/resourceSubmissions/service', () => resourceSubmissionMocks);
vi.mock('@/services/resourceSubmissions/submissionExecution', () => submissionExecutionMocks);

type JsonRequestOptions = {
  search?: string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
};

function createRequest(options: JsonRequestOptions = {}) {
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

async function loadServicesCollectionRoute() {
  return import('../services/route');
}

async function loadServiceDetailRoute() {
  return import('../services/[id]/route');
}

async function loadLocationsCollectionRoute() {
  return import('../locations/route');
}

async function loadLocationDetailRoute() {
  return import('../locations/[id]/route');
}

async function loadAdminsCollectionRoute() {
  return import('../admins/route');
}

async function loadAdminDetailRoute() {
  return import('../admins/[id]/route');
}

async function loadClaimRoute() {
  return import('../claim/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: typeof vi.fn }) => Promise<unknown>) => {
    const client = {
      query: vi.fn(),
    };
    return callback(client);
  });

  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  getIpMock.mockReturnValue('127.0.0.1');

  authMocks.getAuthContext.mockResolvedValue(null);
  authMocks.isAuthConfigured.mockReturnValue(false);
  authMocks.isOranAdmin.mockReturnValue(false);
  authMocks.requireOrgAccess.mockReturnValue(true);
  authMocks.requireOrgRole.mockReturnValue(true);
  authMocks.shouldEnforceAuth.mockReturnValue(false);
  hostPortalIntakeMocks.createHostPortalSourceAssertion.mockResolvedValue({
    sourceSystemId: 'source-system-1',
    sourceFeedId: 'source-feed-1',
    sourceRecordId: 'source-record-1',
  });
  hostPortalIntakeMocks.queueServiceVerificationSubmission.mockResolvedValue('submission-1');
  resourceSubmissionMocks.createResourceSubmission.mockResolvedValue({
    instance: {
      id: 'form-1',
      submission_id: 'submission-1',
    },
    draft: { variant: 'listing', channel: 'host' },
    cards: [],
    reviewMeta: {
      submissionId: 'submission-1',
      targetId: null,
      sourceRecordId: 'source-record-1',
    },
    transitions: [],
  });
  resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValue({
    instance: {
      id: 'form-1',
      submission_id: 'submission-1',
      status: 'approved',
    },
    draft: { variant: 'listing', channel: 'host' },
    cards: [],
    reviewMeta: {
      submissionId: 'submission-1',
      targetId: 'svc-live-1',
      sourceRecordId: 'source-record-1',
    },
    transitions: [],
  });
  submissionExecutionMocks.processSubmittedResourceSubmission.mockResolvedValue({
    success: true,
    autoPublished: true,
  });

  captureExceptionMock.mockResolvedValue(undefined);
});

describe('host organizations collection route', () => {
  it('returns 503 when the database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadOrganizationsCollectionRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Database not configured.' });
  });

  it('returns 401 when auth is configured but no session exists', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue(null);
    const { GET } = await loadOrganizationsCollectionRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns an empty result set for non-admin users with no org memberships', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: [],
      orgRoles: new Map(),
    });
    const { GET } = await loadOrganizationsCollectionRoute();

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

  it('returns 400 for invalid query parameters', async () => {
    const { GET } = await loadOrganizationsCollectionRoute();

    const response = await GET(createRequest({ search: '?limit=101' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid parameters');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('creates an organization and auto-assigns membership when authenticated', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });

    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'org-new',
                name: 'New Org',
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return callback(client);
    });

    const { POST } = await loadOrganizationsCollectionRoute();

    getIpMock.mockReturnValue('203.0.113.10');
    const response = await POST(
      createRequest({
        ip: '203.0.113.10',
        jsonBody: { name: 'New Org', email: 'owner@example.org' },
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'org-new',
      name: 'New Org',
      sourceRecordId: 'source-record-1',
    });
    expect(rateLimitMock).toHaveBeenCalledWith(
      'host:org:write:203.0.113.10',
      expect.any(Object),
    );
    expect(dbMocks.withTransaction).toHaveBeenCalledOnce();
  });
});

describe('host organization detail route', () => {
  it('rejects invalid organization ids', async () => {
    const { GET } = await loadOrganizationDetailRoute();

    const response = await GET(createRequest(), createRouteContext('bad-id'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid organization ID' });
  });

  it('returns 403 when the authenticated user lacks org access', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(false);
    const { GET } = await loadOrganizationDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' });
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('requires authentication to fetch an organization when auth enforcement is enabled', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue(null);
    const { GET } = await loadOrganizationDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns 404 when the organization detail lookup misses', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { GET } = await loadOrganizationDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Organization not found' });
  });

  it('returns organization details for authorized users', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'org-1',
        name: 'Neighborhood Center',
        email: 'hello@example.org',
      },
    ]);
    const { GET } = await loadOrganizationDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'org-1',
      name: 'Neighborhood Center',
      email: 'hello@example.org',
    });
  });

  it('blocks updates for users without organization access', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(false);
    const { PUT } = await loadOrganizationDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: { name: 'Updated Org' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' });
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns 404 when updating a missing organization', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    // executeQuery default returns [] → route short-circuits with 404
    // before reaching withTransaction
    const { PUT } = await loadOrganizationDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: { name: 'Updated Org' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Organization not found' });
  });

  it('updates an organization for authorized users', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'org-1' }]);
    const client = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          {
            id: 'org-1',
            name: 'Updated Org',
            email: 'updated@example.org',
          },
        ],
      }),
    };
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (transactionClient: typeof client) => Promise<unknown>) => {
      return callback(client);
    });
    const { PUT } = await loadOrganizationDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          name: 'Updated Org',
          email: 'updated@example.org',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'org-1',
      name: 'Updated Org',
      email: 'updated@example.org',
    });
    expect(hostPortalIntakeMocks.createHostPortalSourceAssertion).toHaveBeenCalledWith(client, {
      actorUserId: 'user-1',
      actorRole: 'host_admin',
      recordType: 'host_org_update',
      recordId: 'org-1',
      canonicalSourceUrl: 'oran://host-portal/organizations/org-1',
      payload: {
        organizationId: 'org-1',
        requestedChanges: {
          email: 'updated@example.org',
          name: 'Updated Org',
        },
      },
    });
  });

  it('returns 404 when deleting an organization that is already defunct or missing', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgRole.mockReturnValue(true);
    const { DELETE } = await loadOrganizationDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Organization not found' });
  });

  it('archives the organization on delete for authorized admins', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgRole.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'org-1' }]);
    const client = {
      query: vi.fn().mockResolvedValueOnce({
        rows: [{ id: 'org-1' }],
      }),
    };
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (transactionClient: typeof client) => Promise<unknown>) => {
      return callback(client);
    });
    const { DELETE } = await loadOrganizationDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      archived: true,
      id: 'org-1',
    });
    expect(hostPortalIntakeMocks.createHostPortalSourceAssertion).toHaveBeenCalledWith(client, {
      actorUserId: 'user-1',
      actorRole: 'host_admin',
      recordType: 'host_org_archive',
      recordId: 'org-1',
      canonicalSourceUrl: 'oran://host-portal/organizations/org-1',
      payload: {
        organizationId: 'org-1',
        status: 'defunct',
      },
    });
  });
});

describe('host services collection route', () => {
  it('returns 403 when filtering by an organization the user cannot access', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(false);
    const { GET } = await loadServicesCollectionRoute();

    const response = await GET(
      createRequest({ search: '?organizationId=11111111-1111-4111-8111-111111111111' }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' });
  });

  it('rejects invalid POST payloads', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    const { POST } = await loadServicesCollectionRoute();

    const response = await POST(
      createRequest({
        jsonBody: { name: 'Missing organization id' },
      }),
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('prevents creating services under defunct organizations', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'org-1', status: 'defunct' }]);
    const { POST } = await loadServicesCollectionRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          name: 'Shelter Intake',
        },
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot add services to a defunct organization',
    });
  });

  it('creates host services through the shared resource submission flow', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'org-1', status: 'active' }]);
    const { POST } = await loadServicesCollectionRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          name: 'Shelter Intake',
          description: 'Walk-in intake service',
        },
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      detail: expect.any(Object),
      queuedForReview: false,
      published: true,
      submissionId: 'submission-1',
      serviceId: 'svc-live-1',
      sourceRecordId: 'source-record-1',
      message: 'Service published and added to your live listings.',
    });
    expect(resourceSubmissionMocks.createResourceSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'listing',
        channel: 'host',
        ownerOrganizationId: '11111111-1111-4111-8111-111111111111',
        submittedByUserId: 'user-1',
      }),
    );
    expect(submissionExecutionMocks.processSubmittedResourceSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        actorRole: 'host_admin',
        allowAutoApprove: true,
      }),
    );
  });
});

describe('host service detail route', () => {
  it('requires authentication to fetch a service when auth enforcement is enabled', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue(null);
    const { GET } = await loadServiceDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns 404 when a service detail lookup misses', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { GET } = await loadServiceDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Service not found' });
  });

  it('returns 403 when reading a service outside the user organization scope', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(false);
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'svc-1',
        organization_id: 'org-1',
        name: 'Food Pantry',
      },
    ]);
    const { GET } = await loadServiceDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' });
  });

  it('returns service details for authorized users', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'svc-1',
        organization_id: 'org-1',
        name: 'Food Pantry',
        status: 'active',
      },
    ]);
    const { GET } = await loadServiceDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'svc-1',
      organization_id: 'org-1',
      name: 'Food Pantry',
      status: 'active',
    });
  });

  it('returns 404 when a service is missing during update authorization lookup', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { PUT } = await loadServiceDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: { name: 'Updated Name' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Service not found' });
  });

  it('returns 403 when updating a service outside the user organization scope', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(false);
    dbMocks.executeQuery.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
    const { PUT } = await loadServiceDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: { name: 'Updated Name' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' });
  });

  it('updates a service for authorized users', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ organization_id: 'org-1', status: 'active', name: 'Updated Name' }])
      .mockResolvedValueOnce([
        {
          organization_id: 'org-1',
          status: 'active',
          name: 'Updated Name',
        },
      ]);
    const { PUT } = await loadServiceDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          name: 'Updated Name',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queuedForReview: true,
      serviceId: '11111111-1111-4111-8111-111111111111',
      submissionId: 'submission-1',
      sourceRecordId: 'source-record-1',
      message: 'Changes submitted for review. The live listing will stay unchanged until approval.',
    });
  });

  it('returns 404 when deleting a missing service', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { DELETE } = await loadServiceDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Service not found' });
  });

  it('returns 403 when deleting a service outside the user org scope', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(false);
    dbMocks.executeQuery.mockResolvedValueOnce([{ organization_id: 'org-1' }]);
    const { DELETE } = await loadServiceDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' });
  });

  it('archives the service for authorized users', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ organization_id: 'org-1', status: 'active', name: 'Food Pantry' }]);
    const { DELETE } = await loadServiceDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      queuedForReview: true,
      archived: false,
      id: '11111111-1111-4111-8111-111111111111',
      submissionId: 'submission-1',
      sourceRecordId: 'source-record-1',
      message: 'Archive request submitted for review. The live listing remains visible until approval.',
    });
  });
});

describe('host locations routes', () => {
  it('returns 403 when listing locations for an organization outside the user scope', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(false);
    const { GET } = await loadLocationsCollectionRoute();

    const response = await GET(
      createRequest({ search: '?organizationId=11111111-1111-4111-8111-111111111111' }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' });
  });

  it('returns 404 when creating a location for a missing organization', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { POST } = await loadLocationsCollectionRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          name: 'Downtown Office',
        },
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Organization not found' });
  });

  it('requires authentication to fetch a location when auth enforcement is enabled', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue(null);
    const { GET } = await loadLocationDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns 404 when a location detail lookup misses', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { GET } = await loadLocationDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Location not found' });
  });

  it('returns 403 when reading a location outside the user organization scope', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(false);
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'loc-1',
        organization_id: 'org-1',
        name: 'Downtown Office',
      },
    ]);
    const { GET } = await loadLocationDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied' });
  });

  it('returns a location detail payload for authorized users', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'loc-1',
        organization_id: 'org-1',
        name: 'Downtown Office',
        address_1: '123 Main St',
        city: 'Denver',
      },
    ]);
    const { GET } = await loadLocationDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'loc-1',
      organization_id: 'org-1',
      name: 'Downtown Office',
      address_1: '123 Main St',
      city: 'Denver',
    });
  });

  it('returns 404 when updating a missing location', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi.fn().mockResolvedValueOnce({ rows: [] }),
      };
      return callback(client);
    });
    const { PUT } = await loadLocationDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: { name: 'Updated Office' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Location not found' });
  });

  it('returns 403 when updating a location outside the user organization scope', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(false);
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi.fn().mockResolvedValueOnce({
          rows: [{ id: 'loc-1', organization_id: 'org-1' }],
        }),
      };
      return callback(client);
    });
    const { PUT } = await loadLocationDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: { name: 'Updated Office' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('updates a location and inserts a new address when none exists', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [{ id: 'loc-1', organization_id: 'org-1' }],
          })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'loc-1',
                organization_id: 'org-1',
                name: 'Updated Office',
                address_1: '123 Main St',
                city: 'Denver',
                state_province: 'CO',
                postal_code: '80202',
                country: 'US',
              },
            ],
          }),
      };
      const result = await callback(client);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO addresses'),
        [
          '11111111-1111-4111-8111-111111111111',
          '123 Main St',
          null,
          'Denver',
          'CO',
          '80202',
          'US',
        ],
      );
      return result;
    });
    const { PUT } = await loadLocationDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          name: 'Updated Office',
          address1: '123 Main St',
          city: 'Denver',
          stateProvince: 'CO',
          postalCode: '80202',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'loc-1',
      organization_id: 'org-1',
      name: 'Updated Office',
      address_1: '123 Main St',
      city: 'Denver',
      state_province: 'CO',
      postal_code: '80202',
      country: 'US',
    });
    expect(hostPortalIntakeMocks.createHostPortalSourceAssertion).toHaveBeenCalledWith(
      expect.objectContaining({ query: expect.any(Function) }),
      {
        actorUserId: 'user-1',
        actorRole: 'host_admin',
        recordType: 'host_location_update',
        recordId: '11111111-1111-4111-8111-111111111111',
        canonicalSourceUrl: 'oran://host-portal/locations/11111111-1111-4111-8111-111111111111',
        payload: {
          organizationId: 'org-1',
          locationId: '11111111-1111-4111-8111-111111111111',
          requestedChanges: {
            name: 'Updated Office',
            address1: '123 Main St',
            city: 'Denver',
            stateProvince: 'CO',
            postalCode: '80202',
          },
        },
      },
    );
  });

  it('returns 404 when deleting a missing location', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { DELETE } = await loadLocationDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Location not found' });
  });

  it('returns 403 when deleting a location outside the user organization scope', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_member']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(false);
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'loc-1', organization_id: 'org-1' }]);
    const { DELETE } = await loadLocationDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('soft-deletes a location when the status column is available', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'loc-1', organization_id: 'org-1' }]);
    const client = {
      query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 'loc-1' }] }),
    };
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (transactionClient: typeof client) => Promise<unknown>) => {
      return callback(client);
    });
    const { DELETE } = await loadLocationDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true, id: 'loc-1' });
    expect(hostPortalIntakeMocks.createHostPortalSourceAssertion).toHaveBeenCalledWith(client, {
      actorUserId: 'user-1',
      actorRole: 'host_admin',
      recordType: 'host_location_archive',
      recordId: '11111111-1111-4111-8111-111111111111',
      canonicalSourceUrl: 'oran://host-portal/locations/11111111-1111-4111-8111-111111111111',
      payload: {
        organizationId: 'org-1',
        locationId: '11111111-1111-4111-8111-111111111111',
        status: 'defunct',
        archiveMode: 'soft_delete',
      },
    });
  });

  it('falls back to hard delete when the locations status column does not exist', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgAccess.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'loc-1', organization_id: 'org-1' }]);
    const client = {
      query: vi
        .fn()
        .mockRejectedValueOnce(new Error('column "status" of relation "locations" does not exist'))
        .mockResolvedValueOnce({ rows: [{ id: 'loc-1' }] }),
    };
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (transactionClient: typeof client) => Promise<unknown>) => {
      return callback(client);
    });
    const { DELETE } = await loadLocationDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: true, id: 'loc-1' });
    expect(hostPortalIntakeMocks.createHostPortalSourceAssertion).toHaveBeenCalledWith(client, {
      actorUserId: 'user-1',
      actorRole: 'host_admin',
      recordType: 'host_location_archive',
      recordId: '11111111-1111-4111-8111-111111111111',
      canonicalSourceUrl: 'oran://host-portal/locations/11111111-1111-4111-8111-111111111111',
      payload: {
        organizationId: 'org-1',
        locationId: '11111111-1111-4111-8111-111111111111',
        status: 'defunct',
        archiveMode: 'hard_delete',
      },
    });
  });
});

describe('host admins routes', () => {
  it('returns 503 when the database is unavailable for admins collection', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadAdminsCollectionRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Database not configured.' });
  });

  it('returns 429 when admins collection reads are rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 17 });
    const { GET } = await loadAdminsCollectionRoute();

    const response = await GET(createRequest({
      search: '?organizationId=11111111-1111-4111-8111-111111111111',
      ip: '203.0.113.10',
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('17');
  });

  it('requires organizationId to list organization members', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    const { GET } = await loadAdminsCollectionRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'organizationId query parameter is required and must be a valid UUID',
    });
  });

  it('returns 403 when listing members without host admin scope', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_member']]),
    });
    authMocks.requireOrgRole.mockReturnValue(false);
    authMocks.isOranAdmin.mockReturnValue(false);
    const { GET } = await loadAdminsCollectionRoute();

    const response = await GET(
      createRequest({ search: '?organizationId=11111111-1111-4111-8111-111111111111' }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('returns an empty member list when the organization_members table does not exist', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgRole.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([{ exists: false }]);
    const { GET } = await loadAdminsCollectionRoute();

    const response = await GET(
      createRequest({ search: '?organizationId=11111111-1111-4111-8111-111111111111' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ members: [], total: 0 });
  });

  it('lists organization members when the backing table exists', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgRole.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([
        {
          id: 'member-1',
          user_id: 'user-2',
          organization_id: '11111111-1111-4111-8111-111111111111',
          role: 'host_member',
          status: null,
          created_at: '2026-03-03T00:00:00.000Z',
          updated_at: null,
        },
      ]);
    const { GET } = await loadAdminsCollectionRoute();

    const response = await GET(
      createRequest({ search: '?organizationId=11111111-1111-4111-8111-111111111111' }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      members: [
        {
          id: 'member-1',
          user_id: 'user-2',
          organization_id: '11111111-1111-4111-8111-111111111111',
          role: 'host_member',
          status: null,
          created_at: '2026-03-03T00:00:00.000Z',
          updated_at: null,
        },
      ],
      total: 1,
    });
  });

  it('returns 409 when inviting an already active organization member', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgRole.mockReturnValue(true);
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
          .mockResolvedValueOnce({ rows: [{ user_id: '22222222-2222-4222-8222-222222222222', account_status: 'active' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'member-1', status: null }] }),
      };
      return callback(client);
    });
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          userId: '22222222-2222-4222-8222-222222222222',
          role: 'host_member',
        },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'User is already a member of this organization',
    });
  });

  it('reactivates a deactivated member during invite', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgRole.mockReturnValue(true);
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [{ id: 'org-1' }] })
          .mockResolvedValueOnce({ rows: [{ user_id: '22222222-2222-4222-8222-222222222222', account_status: 'active' }] })
          .mockResolvedValueOnce({ rows: [{ id: 'member-1', status: 'deactivated' }] })
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'member-1',
                user_id: '22222222-2222-4222-8222-222222222222',
                organization_id: '11111111-1111-4111-8111-111111111111',
                role: 'host_admin',
                status: null,
                created_at: '2026-03-03T00:00:00.000Z',
                updated_at: '2026-03-03T01:00:00.000Z',
              },
            ],
          }),
      };
      return callback(client);
    });
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          userId: '22222222-2222-4222-8222-222222222222',
          role: 'host_admin',
        },
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      id: 'member-1',
      user_id: '22222222-2222-4222-8222-222222222222',
      organization_id: '11111111-1111-4111-8111-111111111111',
      role: 'host_admin',
      status: null,
      created_at: '2026-03-03T00:00:00.000Z',
      updated_at: '2026-03-03T01:00:00.000Z',
    });
  });

  it('returns 404 when inviting into a missing organization', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgRole.mockReturnValue(true);
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi.fn().mockResolvedValueOnce({ rows: [] }),
      };
      return callback(client);
    });
    const { POST } = await loadAdminsCollectionRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationId: '11111111-1111-4111-8111-111111111111',
          userId: '22222222-2222-4222-8222-222222222222',
          role: 'host_member',
        },
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Organization not found' });
  });

  it('blocks removal of the last host_admin in an organization', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    authMocks.requireOrgRole.mockReturnValue(true);
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'member-1',
                organization_id: 'org-1',
                role: 'host_admin',
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [{ count: '1' }] }),
      };
      return callback(client);
    });
    const { DELETE } = await loadAdminDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot remove the last host_admin of an organization',
    });
  });

  it('returns 404 when a member lookup misses on the detail route', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { GET } = await loadAdminDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Member not found' });
  });

  it('returns 403 when viewing a member outside the user role scope', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-2'],
      orgRoles: new Map([['org-2', 'host_admin']]),
    });
    authMocks.requireOrgRole.mockReturnValue(false);
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'member-1',
        user_id: 'user-2',
        organization_id: 'org-1',
        role: 'host_member',
        status: null,
        created_at: '2026-03-03T00:00:00.000Z',
        updated_at: null,
      },
    ]);
    const { GET } = await loadAdminDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
  });

  it('returns member details for authorized host admins', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.executeQuery.mockResolvedValueOnce([
      {
        id: 'member-1',
        user_id: 'user-2',
        organization_id: 'org-1',
        role: 'host_member',
        status: null,
        created_at: '2026-03-03T00:00:00.000Z',
        updated_at: null,
      },
    ]);
    const { GET } = await loadAdminDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'member-1',
      user_id: 'user-2',
      organization_id: 'org-1',
      role: 'host_member',
      status: null,
      created_at: '2026-03-03T00:00:00.000Z',
      updated_at: null,
    });
  });

  it('prevents demoting the last host_admin on the detail route', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'member-1',
                user_id: 'user-2',
                organization_id: 'org-1',
                role: 'host_admin',
                status: null,
                created_at: '2026-03-03T00:00:00.000Z',
                updated_at: null,
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [{ count: '1' }] }),
      };
      return callback(client);
    });
    const { PUT } = await loadAdminDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          role: 'host_member',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot demote the last host_admin of an organization',
    });
  });

  it('updates member roles for authorized admins', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'member-1',
                user_id: 'user-2',
                organization_id: 'org-1',
                role: 'host_member',
                status: null,
                created_at: '2026-03-03T00:00:00.000Z',
                updated_at: null,
              },
            ],
          })
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'member-1',
                user_id: 'user-2',
                organization_id: 'org-1',
                role: 'host_admin',
                status: null,
                created_at: '2026-03-03T00:00:00.000Z',
                updated_at: '2026-03-03T01:00:00.000Z',
              },
            ],
          }),
      };
      return callback(client);
    });
    const { PUT } = await loadAdminDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          role: 'host_admin',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'member-1',
      user_id: 'user-2',
      organization_id: 'org-1',
      role: 'host_admin',
      status: null,
      created_at: '2026-03-03T00:00:00.000Z',
      updated_at: '2026-03-03T01:00:00.000Z',
    });
  });

  it('rejects invalid JSON when updating member roles', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    const { PUT } = await loadAdminDetailRoute();

    const response = await PUT(
      createRequest({ jsonError: true }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('soft-deletes a member for authorized admins', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [
              {
                id: 'member-1',
                user_id: 'user-2',
                organization_id: 'org-1',
                role: 'host_member',
                status: null,
                created_at: '2026-03-03T00:00:00.000Z',
                updated_at: null,
              },
            ],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return callback(client);
    });
    const { DELETE } = await loadAdminDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('returns 404 when deleting a missing member', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['org-1'],
      orgRoles: new Map([['org-1', 'host_admin']]),
    });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: {
      query: ReturnType<typeof vi.fn>;
    }) => Promise<unknown>) => {
      const client = {
        query: vi.fn().mockResolvedValueOnce({ rows: [] }),
      };
      return callback(client);
    });
    const { DELETE } = await loadAdminDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Member not found' });
  });
});

describe('host claim route', () => {
  it('returns 401 when auth is configured but no user is signed in', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue(null);
    const { POST } = await loadClaimRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationName: 'Claimable Org',
        },
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Authentication required to submit claims',
    });
  });

  it('creates a claim transaction for an authenticated user', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: [],
      orgRoles: new Map(),
    });
    resourceSubmissionMocks.createResourceSubmission.mockResolvedValueOnce({
      instance: {
        id: 'claim-form-1',
        submission_id: 'claim-sub-1',
      },
      draft: { variant: 'claim', channel: 'host' },
      cards: [],
      reviewMeta: {
        submissionId: 'claim-sub-1',
        targetId: null,
        sourceRecordId: 'source-record-1',
      },
      transitions: [],
    });
    resourceSubmissionMocks.getResourceSubmissionDetailForActor.mockResolvedValueOnce({
      instance: {
        id: 'claim-form-1',
        submission_id: 'claim-sub-1',
        status: 'needs_review',
      },
      draft: { variant: 'claim', channel: 'host' },
      cards: [],
      reviewMeta: {
        submissionId: 'claim-sub-1',
        targetId: null,
        sourceRecordId: 'source-record-1',
      },
      transitions: [],
    });
    submissionExecutionMocks.processSubmittedResourceSubmission.mockResolvedValueOnce({
      success: true,
      autoPublished: false,
    });
    const { POST } = await loadClaimRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          organizationName: 'Claimable Org',
          claimNotes: 'I am the director.',
        },
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      success: true,
      queuedForReview: true,
      submissionId: 'claim-sub-1',
      instanceId: 'claim-form-1',
      detail: expect.any(Object),
      message: 'Claim submitted. A community administrator will review your request.',
    });
    expect(resourceSubmissionMocks.createResourceSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'claim',
        channel: 'host',
        submittedByUserId: 'user-1',
      }),
    );
  });

  it('returns 405 for GET requests', async () => {
    const { GET } = await loadClaimRoute();

    const response = await GET();

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({ error: 'Method not allowed' });
  });
});
