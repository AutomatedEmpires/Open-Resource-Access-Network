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
const flagServiceMocks = vi.hoisted(() => ({
  getAllFlags: vi.fn(),
  getFlag: vi.fn(),
  setFlag: vi.fn(),
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
vi.mock('@/services/flags/flags', () => ({
  flagService: flagServiceMocks,
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

async function loadAuditRoute() {
  return import('../audit/route');
}

async function loadRulesRoute() {
  return import('../rules/route');
}

async function loadZonesRoute() {
  return import('../zones/route');
}

async function loadZoneDetailRoute() {
  return import('../zones/[id]/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
    const client = {
      query: vi.fn(),
    };
    return callback(client);
  });
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  authMocks.getAuthContext.mockResolvedValue(null);
  requireMinRoleMock.mockReturnValue(true);
  flagServiceMocks.getAllFlags.mockResolvedValue([]);
  flagServiceMocks.getFlag.mockResolvedValue(null);
  flagServiceMocks.setFlag.mockResolvedValue(undefined);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('admin api routes', () => {
  it('requires authentication to list approvals', async () => {
    const { GET } = await loadApprovalsRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('lists approval queue entries for ORAN admins', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([
        {
          id: 'queue-1',
          service_id: 'svc-1',
          status: 'pending',
        },
      ]);
    const { GET } = await loadApprovalsRoute();

    const response = await GET(createRequest({ search: '?status=pending&page=2' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ id: 'queue-1', service_id: 'svc-1', status: 'pending' }],
      total: 1,
      page: 2,
      hasMore: false,
    });
  });

  it('approves a queue entry in a transaction', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      const result = await callback(client);
      expect(client.query).toHaveBeenCalledTimes(2);
      return result;
    });
    const { POST } = await loadApprovalsRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          queueEntryId: '11111111-1111-4111-8111-111111111111',
          decision: 'approved',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'Claim approved. Organization is now active.',
    });
  });

  it('validates audit log query parameters', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    const { GET } = await loadAuditRoute();

    const response = await GET(createRequest({ search: '?action=not-valid' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid parameters');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('lists audit entries for ORAN admins', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ id: 'audit-1', action: 'approve' }]);
    const { GET } = await loadAuditRoute();

    const response = await GET(createRequest({ search: '?action=approve' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ id: 'audit-1', action: 'approve' }],
      total: 1,
      page: 1,
      hasMore: false,
    });
  });

  it('blocks rules access for insufficient permissions', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    requireMinRoleMock.mockReturnValue(false);
    const { GET } = await loadRulesRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Insufficient permissions' });
  });

  it('returns feature flags for ORAN admins', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    flagServiceMocks.getAllFlags.mockResolvedValueOnce([
      { name: 'chat-summary', enabled: true, rolloutPct: 100 },
    ]);
    const { GET } = await loadRulesRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      flags: [{ name: 'chat-summary', enabled: true, rolloutPct: 100 }],
    });
  });

  it('updates a feature flag', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    flagServiceMocks.getFlag.mockResolvedValueOnce({
      name: 'chat-summary',
      enabled: false,
      rolloutPct: 50,
    });
    const { PUT } = await loadRulesRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          name: 'chat-summary',
          enabled: false,
          rolloutPct: 50,
        },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.flag).toEqual({
      name: 'chat-summary',
      enabled: false,
      rolloutPct: 50,
    });
  });

  it('returns 503 when the database is unavailable for zones', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadZonesRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'Database not configured.' });
  });

  it('lists coverage zones', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ id: 'zone-1', name: 'North' }]);
    const { GET } = await loadZonesRoute();

    const response = await GET(createRequest({ search: '?status=active' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ id: 'zone-1', name: 'North' }],
      total: 1,
      page: 1,
      hasMore: false,
    });
  });

  it('creates a coverage zone', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'zone-1' }]);
    const { POST } = await loadZonesRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          name: 'North',
        },
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      success: true,
      zoneId: 'zone-1',
      message: 'Coverage zone "North" created.',
    });
  });

  it('validates zone ids on the detail route', async () => {
    const { PUT } = await loadZoneDetailRoute();

    const response = await PUT(createRequest(), createRouteContext('bad-id'));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid zone ID format');
  });

  it('returns 404 when updating a missing zone', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { PUT } = await loadZoneDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: { name: 'Updated Zone' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Zone not found' });
  });

  it('deletes a coverage zone', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'admin-1' });
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'zone-1' }]);
    const { DELETE } = await loadZoneDetailRoute();

    const response = await DELETE(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      message: 'Zone deleted.',
    });
  });
});
