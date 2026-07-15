import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));
const transactionQueryMock = vi.hoisted(() => vi.fn());

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));
const requireMinRoleMock = vi.hoisted(() => vi.fn());
const engineMocks = vi.hoisted(() => ({
  advance: vi.fn(),
  acquireLock: vi.fn(),
  advanceInTransaction: vi.fn(),
  sendTerminalStatusEmail: vi.fn(),
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
      query: transactionQueryMock,
    };
    return callback(client);
  });
  transactionQueryMock.mockResolvedValue({ rows: [{ id: '11111111-1111-4111-8111-111111111111' }] });
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  authMocks.getAuthContext.mockResolvedValue(null);
  requireMinRoleMock.mockReturnValue(true);
  captureExceptionMock.mockResolvedValue(undefined);
  engineMocks.advance.mockResolvedValue({ success: true, fromStatus: 'submitted', toStatus: 'under_review', transitionId: 'tx-1' });
  engineMocks.acquireLock.mockResolvedValue(true);
  engineMocks.advanceInTransaction.mockImplementation(async (_client: unknown, request: { toStatus: string }) => ({
    success: true,
    fromStatus: request.toStatus === 'needs_review' ? 'submitted' : 'needs_review',
    toStatus: request.toStatus,
    transitionId: `tx-${request.toStatus}`,
    gateResults: [],
  }));
  engineMocks.sendTerminalStatusEmail.mockResolvedValue(undefined);
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
      counties: ['TX_TRAVIS'],
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

  it('lists review queue entries', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: 1 }])
      .mockResolvedValueOnce([{
        id: 'queue-1',
        status: 'submitted',
        requires_structured_freshness_review: true,
      }]);
    const { GET } = await loadQueueRoute();

    const response = await GET(createRequest({ search: '?status=submitted' }));

    expect(response.status).toBe(200);
    const body = await response.json() as { results: unknown[]; total: number; page: number; hasMore: boolean };
    expect(body.total).toBe(1);
    expect(body.page).toBe(1);
    expect(body.hasMore).toBe(false);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({
      id: 'queue-1',
      status: 'submitted',
      requires_structured_freshness_review: true,
    });
    expect(String(dbMocks.executeQuery.mock.calls[2]?.[0])).toContain("sub.payload ? 'resourceFreshness'");
    // triage fields are always present (computed server-side)
    expect(body.results[0]).toHaveProperty('triage_tier');
    expect(body.results[0]).toHaveProperty('triage_priority');
    expect(body.results[0]).toHaveProperty('triage_explanations');
  });

  it('keeps ORAN admin queue reads global despite a legacy community profile', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        profile_id: 'profile-oran-1',
        is_active: false,
        is_accepting_new: false,
        coverage_zone_id: 'legacy-zone',
        coverage_zone_name: 'Legacy',
        coverage_zone_description: null,
        coverage_states: ['CA'],
        coverage_counties: [],
        has_geometry: false,
      }])
      .mockResolvedValueOnce([{ count: 0 }])
      .mockResolvedValueOnce([]);
    const { GET } = await loadQueueRoute();

    const response = await GET(createRequest());

    expect(response.status).toBe(200);
    expect(String(dbMocks.executeQuery.mock.calls[1]?.[0])).not.toContain('form_instances');
    expect(String(dbMocks.executeQuery.mock.calls[1]?.[0])).not.toContain('service_at_location');
    expect(String(dbMocks.executeQuery.mock.calls[2]?.[0])).not.toContain('form_instances');
    expect(String(dbMocks.executeQuery.mock.calls[2]?.[0])).not.toContain('service_at_location');
  });

  it('denies new claims for inactive or paused community review profiles', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    const { POST } = await loadQueueRoute();

    dbMocks.executeQuery.mockResolvedValueOnce([{
      profile_id: 'profile-1',
      is_active: false,
      is_accepting_new: true,
      coverage_zone_id: null,
      coverage_states: ['TX'],
      coverage_counties: [],
      has_geometry: false,
    }]);
    const inactive = await POST(createRequest({
      jsonBody: { submissionId: '11111111-1111-4111-8111-111111111111' },
    }));
    expect(inactive.status).toBe(403);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();

    vi.clearAllMocks();
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
    requireMinRoleMock.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    dbMocks.executeQuery.mockResolvedValueOnce([{
      profile_id: 'profile-1',
      is_active: true,
      is_accepting_new: false,
      coverage_zone_id: null,
      coverage_states: ['TX'],
      coverage_counties: [],
      has_geometry: false,
    }]);
    const paused = await POST(createRequest({
      jsonBody: { submissionId: '11111111-1111-4111-8111-111111111111' },
    }));
    expect(paused.status).toBe(409);
    await expect(paused.json()).resolves.toEqual({
      error: 'Your community review profile is paused and cannot claim new work.',
    });
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
  });

  it('returns 400 when assigning a queue entry has invalid JSON', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1' });
    const { POST } = await loadQueueRoute();

    const response = await POST(createRequest({ jsonError: true }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 409 when claiming a submission that is already locked', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'needs_review',
        assigned_to_user_id: null,
      }]);
    transactionQueryMock.mockResolvedValueOnce({ rows: [] });
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
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'submitted',
        assigned_to_user_id: null,
      }]);
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
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('assigned_to_user_id = $1');
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('locked_by_user_id = $1');
    expect(engineMocks.advanceInTransaction).toHaveBeenCalledTimes(2);
    expect(engineMocks.advanceInTransaction.mock.calls.map((call) => call[1].toStatus)).toEqual([
      'needs_review',
      'under_review',
    ]);
    expect(dbMocks.executeQuery.mock.invocationCallOrder[1]).toBeLessThan(
      transactionQueryMock.mock.invocationCallOrder[0],
    );
  });

  it('claims scoped needs-review work with one direct workflow transition', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        coverage_zone_id: null,
        coverage_zone_name: null,
        coverage_zone_description: null,
        coverage_states: ['TX'],
        coverage_counties: [],
        has_geometry: false,
      }])
      .mockResolvedValueOnce([{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'needs_review',
        assigned_to_user_id: null,
      }]);
    const { POST } = await loadQueueRoute();

    const response = await POST(createRequest({
      jsonBody: { submissionId: '11111111-1111-4111-8111-111111111111' },
    }));

    expect(response.status).toBe(200);
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('service_at_location');
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('public.admin_review_profiles');
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('review_profile.is_active = true');
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('review_profile.is_accepting_new = true');
    expect(engineMocks.advanceInTransaction).toHaveBeenCalledTimes(1);
    expect(engineMocks.advanceInTransaction.mock.calls[0]?.[1].toStatus).toBe('under_review');
  });

  it('rejects nonclaimable statuses before creating a lock or assignment', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'approved',
        assigned_to_user_id: null,
      }]);
    const { POST } = await loadQueueRoute();

    const response = await POST(createRequest({
      jsonBody: { submissionId: '11111111-1111-4111-8111-111111111111' },
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Submission cannot be claimed from status approved',
    });
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
    expect(transactionQueryMock).not.toHaveBeenCalled();
    expect(engineMocks.advanceInTransaction).not.toHaveBeenCalled();
  });

  it('scope-authorizes claims before locking and hides out-of-scope submissions', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        coverage_zone_id: 'zone-1',
        coverage_zone_name: 'Central',
        coverage_zone_description: null,
        coverage_states: ['TX'],
        coverage_counties: [],
        has_geometry: false,
      }])
      .mockResolvedValueOnce([]);
    const { POST } = await loadQueueRoute();

    const response = await POST(createRequest({
      jsonBody: { submissionId: '11111111-1111-4111-8111-111111111111' },
    }));

    expect(response.status).toBe(404);
    expect(String(dbMocks.executeQuery.mock.calls[1]?.[0])).toContain('form_instances');
    expect(String(dbMocks.executeQuery.mock.calls[1]?.[0])).toContain('service_at_location');
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();
    expect(transactionQueryMock).not.toHaveBeenCalled();
  });

  it('allows only an ORAN admin to take over an escalated claim', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'escalated',
        assigned_to_user_id: 'community-reviewer',
      }]);
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    const { POST } = await loadQueueRoute();

    const forbidden = await POST(createRequest({
      jsonBody: { submissionId: '11111111-1111-4111-8111-111111111111' },
    }));
    expect(forbidden.status).toBe(403);
    expect(dbMocks.withTransaction).not.toHaveBeenCalled();

    vi.clearAllMocks();
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
    requireMinRoleMock.mockReturnValue(true);
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'escalated',
        assigned_to_user_id: 'community-reviewer',
      }]);
    transactionQueryMock.mockResolvedValue({ rows: [{ id: '11111111-1111-4111-8111-111111111111' }] });
    dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => callback({ query: transactionQueryMock }));
    engineMocks.advanceInTransaction.mockResolvedValue({
      success: true,
      fromStatus: 'escalated',
      toStatus: 'under_review',
      transitionId: 'tx-escalated',
      gateResults: [],
    });

    const claimed = await POST(createRequest({
      jsonBody: { submissionId: '11111111-1111-4111-8111-111111111111' },
    }));

    expect(claimed.status).toBe(200);
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('assigned_to_user_id = $1');
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).not.toContain('assigned_to_user_id IS NULL');
    expect(engineMocks.advanceInTransaction).toHaveBeenCalledTimes(1);
    expect(engineMocks.advanceInTransaction.mock.calls[0]?.[1]).toMatchObject({
      toStatus: 'under_review',
      actorRole: 'oran_admin',
    });
  });

  it('releases a claimed item atomically to needs_review and clears assignment', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'community-1', role: 'community_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'under_review',
        assigned_to_user_id: 'community-1',
        is_locked: true,
        locked_by_user_id: 'community-1',
      }]);
    transactionQueryMock
      .mockResolvedValueOnce({ rows: [{ id: '11111111-1111-4111-8111-111111111111' }] })
      .mockResolvedValueOnce({ rows: [{ from_status: 'needs_review' }] });
    engineMocks.advanceInTransaction.mockResolvedValueOnce({
      success: true,
      fromStatus: 'under_review',
      toStatus: 'needs_review',
      transitionId: 'tx-release',
      gateResults: [],
    });
    const { DELETE } = await loadQueueRoute();

    const response = await DELETE(createRequest({
      jsonBody: { submissionId: '11111111-1111-4111-8111-111111111111' },
    }));

    expect(response.status).toBe(200);
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('assigned_to_user_id = $1');
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('FOR UPDATE OF sub');
    expect(engineMocks.advanceInTransaction.mock.calls[0]?.[1]).toMatchObject({
      toStatus: 'needs_review',
      reason: 'Released back to the review queue',
    });
  });

  it('returns an ORAN escalation takeover to the escalated lane when released', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: '11111111-1111-4111-8111-111111111111',
        status: 'under_review',
        assigned_to_user_id: 'oran-1',
        is_locked: true,
        locked_by_user_id: 'oran-1',
      }]);
    transactionQueryMock
      .mockResolvedValueOnce({ rows: [{ id: '11111111-1111-4111-8111-111111111111' }] })
      .mockResolvedValueOnce({ rows: [{ from_status: 'escalated' }] });
    engineMocks.advanceInTransaction.mockResolvedValueOnce({
      success: true,
      fromStatus: 'under_review',
      toStatus: 'escalated',
      transitionId: 'tx-re-escalate',
      gateResults: [],
    });
    const { DELETE } = await loadQueueRoute();

    const response = await DELETE(createRequest({
      jsonBody: { submissionId: '11111111-1111-4111-8111-111111111111' },
    }));

    expect(response.status).toBe(200);
    expect(String(transactionQueryMock.mock.calls[0]?.[0])).toContain('WHERE sub.id = $2');
    expect(transactionQueryMock.mock.calls[0]?.[1]).toEqual([
      'oran-1',
      '11111111-1111-4111-8111-111111111111',
    ]);
    expect(String(transactionQueryMock.mock.calls[1]?.[0])).toContain('st.from_status');
    expect(engineMocks.advanceInTransaction.mock.calls[0]?.[1]).toMatchObject({
      toStatus: 'escalated',
      actorRole: 'oran_admin',
      reason: 'Released back to the ORAN escalation queue',
    });
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
      .mockResolvedValueOnce([])
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
      .mockResolvedValueOnce([{
        id: '11111111-1111-4111-8111-111111111111',
        submission_type: 'service_verification',
        service_id: 'svc-1',
        status: 'under_review',
        assigned_to_user_id: 'community-1',
        is_locked: true,
        locked_by_user_id: 'community-1',
        payload: {},
        has_open_freshness_finding: false,
      }]);
    transactionQueryMock
      .mockResolvedValueOnce({ rows: [] }) // shared publication gate
      .mockResolvedValueOnce({ rows: [{
        id: '11111111-1111-4111-8111-111111111111',
        submission_type: 'service_verification',
        service_id: 'svc-1',
        status: 'under_review',
        assigned_to_user_id: 'community-1',
        is_locked: true,
        locked_by_user_id: 'community-1',
        payload: {},
        has_open_freshness_finding: false,
      }], });
    engineMocks.advanceInTransaction.mockResolvedValueOnce({ success: false, error: 'Invalid transition' });
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
    engineMocks.advanceInTransaction.mockResolvedValueOnce({
      success: true,
      fromStatus: 'under_review',
      toStatus: 'approved',
      transitionId: 'tx-2',
      gateResults: [],
    });
    dbMocks.executeQuery
      .mockResolvedValueOnce([]) // scope lookup
      .mockResolvedValueOnce([{
        id: '11111111-1111-4111-8111-111111111111',
        submission_type: 'service_verification',
        service_id: 'svc-1',
        status: 'under_review',
        assigned_to_user_id: 'community-1',
        is_locked: true,
        locked_by_user_id: 'community-1',
        payload: {},
        has_open_freshness_finding: false,
      }]);
    transactionQueryMock
      .mockResolvedValueOnce({ rows: [] }) // shared publication gate
      .mockResolvedValueOnce({
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          submission_type: 'service_verification',
          service_id: 'svc-1',
          status: 'under_review',
          assigned_to_user_id: 'community-1',
          is_locked: true,
          locked_by_user_id: 'community-1',
          payload: {},
          has_open_freshness_finding: false,
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ submission_type: 'service_verification', service_id: 'svc-1', payload: {} }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'svc-1' }] })
      .mockResolvedValueOnce({ rows: [] });
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
