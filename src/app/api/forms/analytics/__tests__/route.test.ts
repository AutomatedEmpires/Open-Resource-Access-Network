import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
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
  getFormAnalytics: vi.fn(),
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

const USER_ID = 'user-ca-1';

function makeAnalytics() {
  return {
    totalInstances: 15,
    byStatus: { submitted: 5, under_review: 3, approved: 7 },
    avgTimeToReview: 8.2,
    avgTimeToResolve: 36.5,
    slaComplianceRate: 0.93,
    overdueCount: 1,
  };
}

async function loadRoute() {
  return import('../route');
}

function createGetRequest(url = 'http://localhost/api/forms/analytics') {
  return {
    headers: new Headers(),
    nextUrl: new URL(url),
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  authMocks.getAuthContext.mockResolvedValue({
    userId: USER_ID,
    role: 'community_admin',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  vaultMocks.getFormAnalytics.mockResolvedValue(makeAnalytics());
});

describe('GET /api/forms/analytics', () => {
  it('returns analytics for the caller', async () => {
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.analytics.totalInstances).toBe(15);
    expect(body.analytics.byStatus).toEqual({
      submitted: 5,
      under_review: 3,
      approved: 7,
    });
    expect(body.analytics.slaComplianceRate).toBe(0.93);
    expect(vaultMocks.getFormAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      undefined,
    );
  });

  it('passes templateId query param to vault', async () => {
    const templateId = '11111111-1111-4111-8111-111111111111';
    const { GET } = await loadRoute();
    const res = await GET(
      createGetRequest(`http://localhost/api/forms/analytics?templateId=${templateId}`),
    );

    expect(res.status).toBe(200);
    expect(vaultMocks.getFormAnalytics).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      templateId,
    );
  });

  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(503);
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    guardMocks.requireMinRole.mockReturnValue(false);
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 60 });
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('returns 500 on internal errors', async () => {
    vaultMocks.getFormAnalytics.mockRejectedValueOnce(new Error('DB down'));
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it('sets cache-control header', async () => {
    const { GET } = await loadRoute();
    const res = await GET(createGetRequest());
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=30');
  });
});
