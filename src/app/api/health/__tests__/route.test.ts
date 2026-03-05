import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));

function createRequest(ip = '127.0.0.1') {
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  return {
    headers,
    nextUrl: new URL('https://oran.test/api/health'),
    url: 'https://oran.test/api/health',
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([{ ok: 1 }]);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
});

describe('GET /api/health', () => {
  it('returns healthy when database is connected', async () => {
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.database).toBe('connected');
    expect(typeof body.latencyMs).toBe('number');
  });

  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.database).toBe('not_configured');
  });

  it('returns 503 when database query fails', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('connection refused'));
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.database).toBe('unreachable');
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { GET } = await import('../route');
    const res = await GET(createRequest());
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });
});
