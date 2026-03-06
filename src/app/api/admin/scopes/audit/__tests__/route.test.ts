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

function createRequest(search = '', ip = '127.0.0.1') {
  const url = new URL(`https://oran.test/api/admin/scopes/audit${search}`);
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);

  return {
    headers,
    nextUrl: url,
    url: url.toString(),
    json: vi.fn().mockResolvedValue({}),
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({ userId: 'oran-1', role: 'oran_admin' });
  requireMinRoleMock.mockReturnValue(true);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('GET /api/admin/scopes/audit', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('../route');

    const res = await GET(createRequest());

    expect(res.status).toBe(503);
  });

  it('enforces rate limiting and authz', async () => {
    const { GET } = await import('../route');

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 13 });
    const limited = await GET(createRequest('', '203.0.113.13'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('13');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await GET(createRequest());
    expect(unauth.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await GET(createRequest());
    expect(forbidden.status).toBe(403);
  });

  it('returns 400 for invalid list params', async () => {
    const { GET } = await import('../route');

    const res = await GET(createRequest('?page=0&limit=2'));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid parameters');
    expect(Array.isArray(body.details)).toBe(true);
  });

  it('returns paginated scope audit entries', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: 3 }])
      .mockResolvedValueOnce([
        { id: 'a1', action: 'grant_created' },
        { id: 'a2', action: 'grant_approved' },
      ]);

    const { GET } = await import('../route');
    const res = await GET(createRequest('?page=1&limit=2'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    await expect(res.json()).resolves.toEqual({
      results: [
        { id: 'a1', action: 'grant_created' },
        { id: 'a2', action: 'grant_approved' },
      ],
      total: 3,
      page: 1,
      hasMore: true,
    });
  });

  it('returns 500 when queries fail', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('db failed'));
    const { GET } = await import('../route');

    const res = await GET(createRequest());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Internal server error' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'api_admin_scopes_audit',
    });
  });
});
