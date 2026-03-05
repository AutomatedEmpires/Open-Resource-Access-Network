import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/auth/session', () => authMocks);

function createRequest(options: {
  search?: string;
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
    json: vi.fn().mockResolvedValue({}),
  } as never;
}

async function loadScopesRoute() {
  return import('../scopes/route');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  rateLimitMock.mockReturnValue({
    exceeded: false,
    retryAfterSeconds: 0,
  });
  authMocks.getAuthContext.mockResolvedValue(null);
  captureExceptionMock.mockResolvedValue(undefined);
});

// ============================================================
// GET /api/user/scopes
// ============================================================

describe('GET /api/user/scopes', () => {
  it('returns 401 when unauthenticated', async () => {
    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(401);
  });

  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(429);
  });

  it('returns direct and role grants for authenticated user', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    dbMocks.executeQuery
      .mockResolvedValueOnce([{
        id: 'grant-1', scope_name: 'admin.reports', scope_description: 'Reports',
        organization_id: null, granted_at: '2024-01-01', expires_at: null, source: 'direct',
      }])
      .mockResolvedValueOnce([{
        scope_name: 'basic.read', scope_description: 'Read access', source: 'role',
      }]);

    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.directGrants).toHaveLength(1);
    expect(body.directGrants[0].scope_name).toBe('admin.reports');
    expect(body.roleGrants).toHaveLength(1);
    expect(body.roleGrants[0].scope_name).toBe('basic.read');
  });

  it('handles database errors gracefully', async () => {
    authMocks.getAuthContext.mockResolvedValue({ userId: 'user-1' });
    dbMocks.executeQuery.mockRejectedValue(new Error('DB connection failed'));

    const { GET } = await loadScopesRoute();
    const response = await GET(createRequest());
    expect(response.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
