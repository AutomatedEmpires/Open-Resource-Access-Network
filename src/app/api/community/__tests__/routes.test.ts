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

async function loadCoverageRoute() {
  return import('../coverage/route');
}

async function loadQueueRoute() {
  return import('../queue/route');
}

async function loadQueueDetailRoute() {
  return import('../queue/[id]/route');
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
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('community api routes', () => {
  it('requires authentication to fetch coverage stats', async () => {
    const { GET } = await loadCoverageRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('returns community coverage summary data', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        { status: 'pending', count: 2 },
        { status: 'verified', count: 3 },
      ])
      .mockResolvedValueOnce([{ date: '2026-03-01', verified: 1, rejected: 0, escalated: 0 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ organization_id: 'org-1', organization_name: 'Org', pending_count: 2 }]);
    const { GET } = await loadCoverageRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toEqual({
      pending: 2,
      inReview: 0,
      verified: 3,
      rejected: 0,
      escalated: 0,
      total: 5,
      stale: 1,
    });
    expect(body.topOrganizations).toEqual([
      { organization_id: 'org-1', organization_name: 'Org', pending_count: 2 },
    ]);
  });

  it('validates community queue list parameters', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { GET } = await loadQueueRoute();

    const response = await GET(createRequest({ search: '?limit=101' }));

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid parameters');
  });

  it('lists verification queue entries', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ id: 'queue-1', status: 'pending' }]);
    const { GET } = await loadQueueRoute();

    const response = await GET(createRequest({ search: '?status=pending' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      results: [{ id: 'queue-1', status: 'pending' }],
      total: 1,
      page: 1,
      hasMore: false,
    });
  });

  it('returns 400 when assigning a queue entry has invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { POST } = await loadQueueRoute();

    const response = await POST(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 404 when assigning a queue entry that is not pending', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    dbMocks.executeQuery.mockResolvedValueOnce([]);
    const { POST } = await loadQueueRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          queueEntryId: '11111111-1111-4111-8111-111111111111',
        },
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Queue entry not found or already assigned',
    });
  });

  it('assigns a queue entry to the current community admin', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'queue-1' }]);
    const { POST } = await loadQueueRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          queueEntryId: '11111111-1111-4111-8111-111111111111',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: 'queue-1' });
  });

  it('validates queue detail ids', async () => {
    const { GET } = await loadQueueDetailRoute();

    const response = await GET(createRequest(), createRouteContext('bad-id'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid queue entry ID' });
  });

  it('returns a detailed queue entry payload', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        {
          id: 'queue-1',
          service_id: 'svc-1',
          service_name: 'Food Pantry',
        },
      ])
      .mockResolvedValueOnce([{ id: 'loc-1', name: 'Main Site' }])
      .mockResolvedValueOnce([{ id: 'phone-1', number: '555-0100' }])
      .mockResolvedValueOnce([{ score: 75 }]);
    const { GET } = await loadQueueDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe('queue-1');
    expect(body.locations).toEqual([{ id: 'loc-1', name: 'Main Site' }]);
    expect(body.phones).toEqual([{ id: 'phone-1', number: '555-0100' }]);
    expect(body.confidenceScore).toEqual({ score: 75 });
  });

  it('returns 400 when queue decisions have invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { PUT } = await loadQueueDetailRoute();

    const response = await PUT(createRequest({ jsonError: true }), createRouteContext('11111111-1111-4111-8111-111111111111'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 404 when a queue entry has already been reviewed', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
      const client = {
        query: vi.fn().mockResolvedValueOnce({ rows: [] }),
      };
      return callback(client);
    });
    const { PUT } = await loadQueueDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: { decision: 'verified' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Queue entry not found or already reviewed',
    });
  });

  it('verifies a queue entry and updates confidence scores', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    dbMocks.withTransaction.mockImplementationOnce(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
      const client = {
        query: vi
          .fn()
          .mockResolvedValueOnce({
            rows: [{ id: 'queue-1', service_id: 'svc-1' }],
          })
          .mockResolvedValueOnce({ rows: [] }),
      };
      const result = await callback(client);
      expect(client.query).toHaveBeenCalledTimes(2);
      return result;
    });
    const { PUT } = await loadQueueDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          decision: 'verified',
          notes: 'Confirmed by phone.',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.id).toBe('queue-1');
    expect(body.serviceId).toBe('svc-1');
    expect(body.message).toBe('Record verified. Confidence score updated.');
  });
});
