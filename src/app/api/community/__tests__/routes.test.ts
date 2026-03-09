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
      query: vi.fn().mockResolvedValue({ rows: [] }),
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
  engineMocks.advance.mockResolvedValue({ success: true, fromStatus: 'submitted', toStatus: 'under_review', transitionId: 'tx-1' });
  engineMocks.acquireLock.mockResolvedValue(true);
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
        {
          coverage_zone_id: 'zone-1',
          coverage_zone_name: 'Central Texas',
          coverage_zone_description: 'Austin metro community review zone.',
          coverage_states: ['TX'],
          coverage_counties: ['TX_Travis'],
          has_geometry: true,
        },
      ])
      .mockResolvedValueOnce([
        { status: 'submitted', count: 2 },
        { status: 'approved', count: 3 },
      ])
      .mockResolvedValueOnce([
        { submission_type: 'service_verification', count: 4 },
      ])
      .mockResolvedValueOnce([{ date: '2026-03-01', approved: 1, denied: 0, escalated: 0 }])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([{ organization_id: 'org-1', organization_name: 'Org', pending_count: 2 }]);
    const { GET } = await loadCoverageRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toEqual({
      submitted: 2,
      underReview: 0,
      pendingSecondApproval: 0,
      approved: 3,
      denied: 0,
      escalated: 0,
      returned: 0,
      withdrawn: 0,
      total: 5,
      stale: 1,
      slaBreached: 0,
    });
    expect(body.byType).toEqual({ service_verification: 4 });
    expect(body.topOrganizations).toEqual([
      { organization_id: 'org-1', organization_name: 'Org', pending_count: 2 },
    ]);
    expect(body.zone).toEqual({
      id: 'zone-1',
      name: 'Central Texas',
      description: 'Austin metro community review zone.',
      states: ['TX'],
      counties: ['TX_Travis'],
      hasGeometry: true,
      hasExplicitScope: true,
    });
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
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{ id: 'queue-1', status: 'submitted' }]);
    const { GET } = await loadQueueRoute();

    const response = await GET(createRequest({ search: '?status=submitted' }));

    expect(response.status).toBe(200);
    const body = await response.json() as { results: unknown[]; total: number; page: number; hasMore: boolean };
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(false);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ id: 'queue-1', status: 'submitted' });
    // triage fields are always present (computed server-side)
    expect(body.results[0]).toHaveProperty('triage_tier');
    expect(body.results[0]).toHaveProperty('triage_priority');
    expect(body.results[0]).toHaveProperty('triage_explanations');
  });

  it('returns 400 when assigning a queue entry has invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { POST } = await loadQueueRoute();

    const response = await POST(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 409 when claiming a submission that is already locked', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    engineMocks.acquireLock.mockResolvedValueOnce(false);
    const { POST } = await loadQueueRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          submissionId: '11111111-1111-4111-8111-111111111111',
        },
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Submission not found, already locked, or already assigned',
    });
  });

  it('claims a submission for the current community admin', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    engineMocks.acquireLock.mockResolvedValueOnce(true);
    engineMocks.advance.mockResolvedValueOnce({ success: true, fromStatus: 'submitted', toStatus: 'under_review', transitionId: 'tx-1' });
    const { POST } = await loadQueueRoute();

    const response = await POST(
      createRequest({
        jsonBody: {
          submissionId: '11111111-1111-4111-8111-111111111111',
        },
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, id: '11111111-1111-4111-8111-111111111111' });
  });

  it('validates queue detail ids', async () => {
    const { GET } = await loadQueueDetailRoute();

    const response = await GET(createRequest(), createRouteContext('bad-id'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid submission ID' });
  });

  it('returns a detailed submission payload', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: '11111111-1111-4111-8111-111111111111',
          service_id: 'svc-1',
          service_name: 'Food Pantry',
          submission_type: 'service_verification',
          status: 'under_review',
        },
      ])
      .mockResolvedValueOnce([{ id: 'loc-1', name: 'Main Site' }])
      .mockResolvedValueOnce([{ id: 'phone-1', number: '555-0100' }])
      .mockResolvedValueOnce([{ score: 75 }])
      .mockResolvedValueOnce([{ id: 'tx-1', from_status: 'submitted', to_status: 'under_review', actor_user_id: 'u-1', created_at: '2026-01-01' }]);
    const { GET } = await loadQueueDetailRoute();

    const response = await GET(
      createRequest(),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.locations).toEqual([{ id: 'loc-1', name: 'Main Site' }]);
    expect(body.phones).toEqual([{ id: 'phone-1', number: '555-0100' }]);
    expect(body.confidenceScore).toEqual({ score: 75 });
    expect(body.transitions).toEqual([{ id: 'tx-1', from_status: 'submitted', to_status: 'under_review', actor_user_id: 'u-1', created_at: '2026-01-01' }]);
  });

  it('returns 400 when queue decisions have invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { PUT } = await loadQueueDetailRoute();

    const response = await PUT(createRequest({ jsonError: true }), createRouteContext('11111111-1111-4111-8111-111111111111'));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 409 when a submission cannot be advanced', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: '11111111-1111-4111-8111-111111111111' }]);
    engineMocks.advance.mockResolvedValueOnce({ success: false, error: 'Invalid transition' });
    const { PUT } = await loadQueueDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: { decision: 'approved' },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid transition',
    });
  });

  it('approves a submission and updates confidence scores', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    engineMocks.advance.mockResolvedValueOnce({ success: true, fromStatus: 'under_review', toStatus: 'approved', transitionId: 'tx-2' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])                         // scope lookup
      .mockResolvedValueOnce([])                         // notes update
      .mockResolvedValueOnce([{ service_id: 'svc-1' }]) // service lookup
      .mockResolvedValueOnce([]);                        // confidence upsert
    const { PUT } = await loadQueueDetailRoute();

    const response = await PUT(
      createRequest({
        jsonBody: {
          decision: 'approved',
          notes: 'Confirmed by phone.',
        },
      }),
      createRouteContext('11111111-1111-4111-8111-111111111111'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.fromStatus).toBe('under_review');
    expect(body.toStatus).toBe('approved');
    expect(body.message).toBe('Record approved. Confidence score updated.');
  });
});
