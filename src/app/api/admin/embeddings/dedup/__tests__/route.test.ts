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
const vectorMocks = vi.hoisted(() => ({
  buildVectorTopKQuery: vi.fn(),
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
vi.mock('@/services/search/vectorSearch', () => vectorMocks);

function createRequest(options: {
  body?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const headers = new Headers();
  headers.set('x-forwarded-for', options.ip ?? '127.0.0.1');

  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('bad json'))
      : vi.fn().mockResolvedValue(options.body ?? {}),
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
  vectorMocks.buildVectorTopKQuery.mockReturnValue({
    sql: 'SELECT id, similarity FROM mock_neighbors',
    params: ['[0.1,0.2]', 6],
  });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('POST /api/admin/embeddings/dedup', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await import('../route');

    const res = await POST(createRequest());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'Database not configured.' });
  });

  it('enforces rate limiting and authz', async () => {
    const { POST } = await import('../route');

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 9 });
    const limited = await POST(createRequest({ ip: '198.51.100.9' }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('9');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await POST(createRequest());
    expect(unauth.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await POST(createRequest());
    expect(forbidden.status).toBe(403);
  });

  it('rejects invalid inputs', async () => {
    const { POST } = await import('../route');

    const res = await POST(createRequest({ body: { probeLimit: 0, threshold: 0.2 } }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid input.');
    expect(body.details).toBeDefined();
  });

  it('returns dedup clusters using similarity threshold and pair de-duplication', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([
        { id: 'svc-a', name: 'A', embedding: '[0.11,0.22]' },
        { id: 'svc-b', name: 'B', embedding: '[0.33,0.44]' },
        { id: 'svc-bad', name: 'Bad', embedding: 'not-json' },
      ])
      .mockResolvedValueOnce([
        { id: 'svc-a', similarity: 1 },
        { id: 'svc-b', similarity: 0.9312 },
        { id: 'svc-c', similarity: 0.70 },
      ])
      .mockResolvedValueOnce([
        { id: 'svc-b', similarity: 1 },
        { id: 'svc-a', similarity: 0.9411 },
      ]);

    vectorMocks.buildVectorTopKQuery
      .mockReturnValueOnce({ sql: 'neighbors-a', params: ['a', 6] })
      .mockReturnValueOnce({ sql: 'neighbors-b', params: ['b', 6] });

    const { POST } = await import('../route');
    const res = await POST(createRequest({ body: { probeLimit: 10, threshold: 0.92 } }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      clusters: [{ ids: ['svc-a', 'svc-b'], similarity: 0.931 }],
      probesScanned: 3,
      threshold: 0.92,
    });

    expect(vectorMocks.buildVectorTopKQuery).toHaveBeenCalledTimes(2);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(3);
  });

  it('returns 500 when downstream calls throw', async () => {
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('query failed'));
    const { POST } = await import('../route');

    const res = await POST(createRequest({ body: { probeLimit: 2 } }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Internal server error.' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error));
  });
});
