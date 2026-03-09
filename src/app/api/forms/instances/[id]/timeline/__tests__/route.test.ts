import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

const guardMocks = vi.hoisted(() => ({
  requireMinRole: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const vaultMocks = vi.hoisted(() => ({
  getAccessibleFormInstance: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/forms/vault', () => vaultMocks);
vi.mock('@/domain/constants', () => ({
  HOST_READ_RATE_LIMIT_MAX_REQUESTS: 100,
  RATE_LIMIT_WINDOW_MS: 60_000,
}));

const INSTANCE_ID = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = 'user-host-1';

function makeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTANCE_ID,
    submission_id: SUBMISSION_ID,
    template_id: '11111111-1111-4111-8111-111111111111',
    title: 'Test Instance',
    status: 'submitted',
    ...overrides,
  };
}

function makeTransitionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    from_status: 'draft',
    to_status: 'submitted',
    actor_role: 'host_member',
    reason: null,
    gates_passed: true,
    created_at: '2026-04-01T12:00:00.000Z',
    ...overrides,
  };
}

async function loadRoute() {
  return import('../route');
}

function makeGetRequest() {
  return {
    headers: new Headers(),
  } as never;
}

function makeRouteContext(id = INSTANCE_ID) {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([makeTransitionRow()]);
  authMocks.getAuthContext.mockResolvedValue({
    userId: USER_ID,
    role: 'host_member',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance());
});

describe('GET /api/forms/instances/[id]/timeline', () => {
  it('returns timeline entries on success', async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.timeline).toHaveLength(1);
    expect(json.timeline[0].fromStatus).toBe('draft');
    expect(json.timeline[0].toStatus).toBe('submitted');
    expect(json.timeline[0].actorRole).toBe('host_member');
    expect(json.submissionId).toBe(SUBMISSION_ID);
  });

  it('returns empty timeline for instance with no transitions', async () => {
    dbMocks.executeQuery.mockResolvedValue([]);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.timeline).toHaveLength(0);
  });

  it('returns multiple timeline entries in order', async () => {
    dbMocks.executeQuery.mockResolvedValue([
      makeTransitionRow({ from_status: 'draft', to_status: 'submitted', created_at: '2026-04-01T12:00:00.000Z' }),
      makeTransitionRow({ id: '55555555-5555-5555-8555-555555555555', from_status: 'submitted', to_status: 'under_review', created_at: '2026-04-02T12:00:00.000Z' }),
    ]);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.timeline).toHaveLength(2);
    expect(json.timeline[0].toStatus).toBe('submitted');
    expect(json.timeline[1].toStatus).toBe('under_review');
  });

  it('returns 400 for invalid UUID', async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('returns 503 when database not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(503);
  });

  it('returns 401 when not authenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(401);
  });

  it('returns 403 when insufficient role', async () => {
    guardMocks.requireMinRole.mockReturnValue(false);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(403);
  });

  it('returns 404 when instance not found', async () => {
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(404);
  });

  it('returns 429 on rate limit', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toBe('Rate limit exceeded.');
  });

  it('returns 500 on internal error', async () => {
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance());
    dbMocks.executeQuery.mockRejectedValue(new Error('DB fail'));
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
