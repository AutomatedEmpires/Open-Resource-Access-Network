import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));
const authMocks = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const guardMocks = vi.hoisted(() => ({ requireMinRole: vi.fn() }));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));

function createRequest(url = 'http://localhost/api/forms/zones?limit=10&offset=5') {
  const headers = new Headers();
  headers.set('x-forwarded-for', '5.6.7.8');
  return { headers, nextUrl: new URL(url) } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([{ id: 'z1', name: 'Zone 1', description: null }]);
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'u1',
    role: 'host_member',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('GET /api/forms/zones', () => {
  it('lists active zones', async () => {
    const { GET } = await import('../route');
    const res = await GET(createRequest());

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect(dbMocks.executeQuery).toHaveBeenCalledWith(expect.stringContaining('FROM coverage_zones'), [10, 5]);
  });

  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest());

    expect(res.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 30 });
    const { GET } = await import('../route');
    const res = await GET(createRequest());

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { GET } = await import('../route');
    const res = await GET(createRequest());

    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid query params', async () => {
    const { GET } = await import('../route');
    const res = await GET(createRequest('http://localhost/api/forms/zones?limit=1000'));

    expect(res.status).toBe(400);
  });

  it('returns 500 when query fails', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('db failed'));
    const { GET } = await import('../route');
    const res = await GET(createRequest());

    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
