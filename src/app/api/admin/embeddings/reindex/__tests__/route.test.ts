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
const embeddingMocks = vi.hoisted(() => ({
  buildServiceEmbeddingText: vi.fn(),
  embedForIndexing: vi.fn(),
  getServicesNeedingEmbedding: vi.fn(),
  updateServiceEmbedding: vi.fn(),
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
vi.mock('@/services/search/embeddings', () => embeddingMocks);

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
  embeddingMocks.buildServiceEmbeddingText.mockImplementation((svc) => `text:${svc.id}`);
  embeddingMocks.embedForIndexing.mockResolvedValue([0.1, 0.2]);
  embeddingMocks.getServicesNeedingEmbedding.mockResolvedValue([]);
  embeddingMocks.updateServiceEmbedding.mockResolvedValue(undefined);
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('POST /api/admin/embeddings/reindex', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await import('../route');

    const res = await POST(createRequest());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: 'Database not configured.' });
  });

  it('enforces rate limiting and authz', async () => {
    const { POST } = await import('../route');

    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 7 });
    const limited = await POST(createRequest({ ip: '198.51.100.7' }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('7');

    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const unauth = await POST(createRequest());
    expect(unauth.status).toBe(401);

    requireMinRoleMock.mockReturnValueOnce(false);
    const forbidden = await POST(createRequest());
    expect(forbidden.status).toBe(403);
  });

  it('rejects invalid input body', async () => {
    const { POST } = await import('../route');

    const res = await POST(createRequest({ body: { limit: 0 } }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid input.');
    expect(body.details).toBeDefined();
  });

  it('reindexes services and tracks failed embedding attempts', async () => {
    embeddingMocks.getServicesNeedingEmbedding.mockResolvedValueOnce([
      { id: 'svc-1', name: 'Shelter' },
      { id: 'svc-2', name: 'Pantry' },
    ]);
    embeddingMocks.embedForIndexing
      .mockResolvedValueOnce([0.1, 0.2, 0.3])
      .mockResolvedValueOnce(null);

    const { POST } = await import('../route');
    const res = await POST(createRequest({ body: { limit: 2 } }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ reindexed: 1, failed: 1, total: 2 });

    expect(embeddingMocks.getServicesNeedingEmbedding).toHaveBeenCalledWith(2, dbMocks.executeQuery);
    expect(embeddingMocks.updateServiceEmbedding).toHaveBeenCalledWith(
      'svc-1',
      [0.1, 0.2, 0.3],
      dbMocks.executeQuery,
    );
    expect(embeddingMocks.updateServiceEmbedding).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when dependency calls throw', async () => {
    embeddingMocks.getServicesNeedingEmbedding.mockRejectedValueOnce(new Error('search down'));
    const { POST } = await import('../route');

    const res = await POST(createRequest({ body: { limit: 10 } }));

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Internal server error.' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error));
  });
});
