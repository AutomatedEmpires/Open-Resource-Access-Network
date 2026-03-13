import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  withTransaction: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimitShared: rateLimitMock,
}));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

function createRequest(ip = '127.0.0.1') {
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  return {
    headers,
    nextUrl: new URL('https://oran.test/api/user/data-delete'),
    url: 'https://oran.test/api/user/data-delete',
    json: vi.fn().mockResolvedValue({}),
  } as never;
}

let clientQueryMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'user-1',
    role: 'seeker',
    orgIds: [],
    orgRoles: new Map(),
  });
  captureExceptionMock.mockResolvedValue(undefined);

  dbMocks.withTransaction.mockImplementation(async (callback: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
    clientQueryMock = vi.fn().mockResolvedValue({ rows: [] });
    return callback({ query: clientQueryMock });
  });
});

describe('DELETE /api/user/data-delete', () => {
  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { DELETE } = await import('../route');

    const res = await DELETE(createRequest());

    expect(res.status).toBe(503);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 600 });
    const { DELETE } = await import('../route');

    const res = await DELETE(createRequest('203.0.113.20'));

    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { DELETE } = await import('../route');

    const res = await DELETE(createRequest());

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Authentication required' });
  });

  it('deletes user data inside a transaction', async () => {
    const { DELETE } = await import('../route');

    const res = await DELETE(createRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      message: 'All personal data has been deleted.',
    });
    expect(clientQueryMock).toHaveBeenCalledTimes(14);
    expect(clientQueryMock.mock.calls[0]?.[0]).toContain('DELETE FROM saved_services');
    expect(clientQueryMock.mock.calls[11]?.[0]).toContain('UPDATE audit_logs');
    expect(clientQueryMock.mock.calls[13]?.[0]).toContain('INSERT INTO audit_logs');
  });

  it('returns 500 when transaction fails', async () => {
    dbMocks.withTransaction.mockRejectedValueOnce(new Error('db unavailable'));
    const { DELETE } = await import('../route');

    const res = await DELETE(createRequest());

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Failed to delete user data.' });
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
