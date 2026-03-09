import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
  isOranAdmin: vi.fn(),
  shouldEnforceAuth: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth', () => authMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

function createRequest(ip = '203.0.113.10') {
  return {
    headers: new Headers({ 'x-forwarded-for': ip }),
  } as never;
}

async function loadRoute() {
  return import('../dashboard/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  authMocks.getAuthContext.mockResolvedValue(null);
  authMocks.isOranAdmin.mockReturnValue(false);
  authMocks.shouldEnforceAuth.mockReturnValue(false);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('host dashboard route', () => {
  it('returns 503 when the database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Database not configured.' });
  });

  it('returns 401 when auth is required but no session exists', async () => {
    authMocks.shouldEnforceAuth.mockReturnValue(true);
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns an empty summary for non-admin users without org memberships', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_member',
      orgIds: [],
      orgRoles: new Map(),
    });
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      summary: {
        organizations: 0,
        incompleteOrganizations: 0,
        services: 0,
        staleServices: 0,
        locations: 0,
        staleLocations: 0,
        teamMembers: 0,
        pendingInvites: 0,
        pendingReviews: 0,
        claimsInFlight: 0,
      },
      recentSubmissions: [],
    });
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('returns scoped dashboard data for host users', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'host_admin',
      orgIds: ['11111111-1111-4111-8111-111111111111'],
      orgRoles: new Map([['11111111-1111-4111-8111-111111111111', 'host_admin']]),
    });

    dbMocks.executeQuery
      .mockResolvedValueOnce([{ total: 2, incomplete: 1 }])
      .mockResolvedValueOnce([{ total: 9, stale: 2 }])
      .mockResolvedValueOnce([{ total: 4, stale: 1 }])
      .mockResolvedValueOnce([{ exists: true }])
      .mockResolvedValueOnce([{ total: 5, pending: 2 }])
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([
        {
          id: 'sub-1',
          title: 'Review service update',
          submission_type: 'service_verification',
          status: 'under_review',
          organization_name: 'Helping Hands',
          created_at: '2026-03-08T10:00:00.000Z',
        },
      ]);

    const { GET } = await loadRoute();
    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      summary: {
        organizations: 2,
        incompleteOrganizations: 1,
        services: 9,
        staleServices: 2,
        locations: 4,
        staleLocations: 1,
        teamMembers: 5,
        pendingInvites: 2,
        pendingReviews: 3,
        claimsInFlight: 1,
      },
      recentSubmissions: [
        {
          id: 'sub-1',
          title: 'Review service update',
          submission_type: 'service_verification',
          status: 'under_review',
          organization_name: 'Helping Hands',
          created_at: '2026-03-08T10:00:00.000Z',
        },
      ],
    });

    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(8);
    expect(dbMocks.executeQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FROM organizations o'),
      [['11111111-1111-4111-8111-111111111111']],
    );
    expect(dbMocks.executeQuery).toHaveBeenNthCalledWith(
      8,
      expect.stringContaining('ORDER BY sub.created_at DESC'),
      [['11111111-1111-4111-8111-111111111111'], 'user-1'],
    );
  });

  it('returns 429 when rate limiting is exceeded', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 12 });
    const { GET } = await loadRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
    await expect(response.json()).resolves.toEqual({ error: 'Rate limit exceeded.' });
  });

  it('captures and returns 500 on unexpected failures', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'user-1',
      role: 'oran_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    authMocks.isOranAdmin.mockReturnValue(true);
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('dashboard query failed'));

    const { GET } = await loadRoute();
    const response = await GET(createRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      { feature: 'api_host_dashboard' },
    );
  });
});
