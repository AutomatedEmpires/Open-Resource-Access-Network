import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  getPgPool: vi.fn(),
}));
const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const bcryptMocks = vi.hoisted(() => ({ hash: vi.fn() }));
const credentialsAuthEnabledMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimitShared: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));
vi.mock('bcryptjs', () => ({ default: bcryptMocks }));
vi.mock('@/lib/auth', () => ({ isCredentialsAuthEnabled: credentialsAuthEnabledMock }));

function createRequest(body: unknown, ip = '9.8.7.6') {
  const headers = new Headers();
  headers.set('x-forwarded-for', ip);
  return {
    headers,
    json: vi.fn().mockResolvedValue(body),
  } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();

  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'uuid-1') });
  credentialsAuthEnabledMock.mockReturnValue(true);

  const query = vi.fn();
  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.getPgPool.mockReturnValue({ query });
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  bcryptMocks.hash.mockResolvedValue('hashed-password');

  query.mockResolvedValueOnce({ rows: [] });
  query.mockResolvedValueOnce({ rowCount: 1 });
});

describe('POST /api/auth/register', () => {
  it('creates account for valid payload', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({
      email: 'Test@Example.com',
      password: 'StrongPass123',
      displayName: '  Test User ',
      phone: ' 1234567890 ',
    }));

    expect(res.status).toBe(201);
    const pool = dbMocks.getPgPool.mock.results[0].value;
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(bcryptMocks.hash).toHaveBeenCalledWith('StrongPass123', 12);
  });

  it('returns 503 when database is unavailable', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValueOnce(false);
    const { POST } = await import('../route');
    const res = await POST(createRequest({}));

    expect(res.status).toBe(503);
  });

  it('returns 403 when credentials auth is disabled in production', async () => {
    credentialsAuthEnabledMock.mockReturnValue(false);

    const { POST } = await import('../route');
    const res = await POST(createRequest({
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: 'User',
    }));

    expect(res.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 60 });
    const { POST } = await import('../route');
    const res = await POST(createRequest({
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: 'User',
    }));

    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid request body', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({ email: 'not-email' }));

    expect(res.status).toBe(400);
  });

  it('returns 409 for duplicate email', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ 1: 1 }] });
    dbMocks.getPgPool.mockReturnValueOnce({ query });

    const { POST } = await import('../route');
    const res = await POST(createRequest({
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: 'User',
    }));

    expect(res.status).toBe(409);
  });

  it('returns 500 on unexpected error', async () => {
    dbMocks.getPgPool.mockImplementationOnce(() => {
      throw new Error('db crash');
    });

    const { POST } = await import('../route');
    const res = await POST(createRequest({
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: 'User',
    }));

    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
