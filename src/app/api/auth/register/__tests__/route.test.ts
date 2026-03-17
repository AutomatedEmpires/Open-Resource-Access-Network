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
      username: 'test-user',
      email: 'Test@Example.com',
      password: 'StrongPass123',
      displayName: '  Test User ',
      phone: ' 1234567890 ',
    }));

    expect(res.status).toBe(201);
    const pool = dbMocks.getPgPool.mock.results[0].value;
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(bcryptMocks.hash).toHaveBeenCalledWith('StrongPass123', 12);
    expect(pool.query.mock.calls[0][1]).toEqual(['test@example.com', 'test-user', '1234567890']);
    expect(pool.query.mock.calls[1][1]).toEqual([
      'uuid-1',
      'Test User',
      'test-user',
      'test@example.com',
      'hashed-password',
      '1234567890',
    ]);
  });

  it('returns 400 for invalid JSON bodies', async () => {
    const headers = new Headers();
    headers.set('x-forwarded-for', '9.8.7.6');

    const { POST } = await import('../route');
    const res = await POST({
      headers,
      json: vi.fn().mockRejectedValue(new Error('bad json')),
    } as never);

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid JSON body' });
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
      username: 'user',
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
      username: 'user',
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

  it('returns 400 for whitespace-only display names', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({
      username: 'user-one',
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: '   ',
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Display name is required' });
  });

  it('returns 400 for passwords missing character class diversity', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({
      username: 'user-one',
      email: 'user@example.com',
      password: 'alllowercase1',
      displayName: 'User One',
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Password must include uppercase, lowercase, and numeric characters',
    });
  });

  it('returns 400 for passwords derived from account identity', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({
      username: 'caseworker',
      email: 'caseworker@example.com',
      password: 'Caseworker2026',
      displayName: 'Case Worker',
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: 'Password cannot contain your username, email name, or display name',
    });
  });

  it('swallows honeypot submissions without creating an account', async () => {
    const { POST } = await import('../route');
    const res = await POST(createRequest({
      username: 'test-user',
      email: 'test@example.com',
      password: 'StrongPass123',
      displayName: 'Test User',
      website: 'https://spam.invalid',
    }));

    expect(res.status).toBe(201);
    expect(dbMocks.getPgPool).not.toHaveBeenCalled();
    expect(bcryptMocks.hash).not.toHaveBeenCalled();
  });

  it('returns 409 for duplicate email', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ email_exists: true, username_exists: false, phone_exists: false }] });
    dbMocks.getPgPool.mockReturnValueOnce({ query });

    const { POST } = await import('../route');
    const res = await POST(createRequest({
      username: 'user',
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: 'User',
    }));

    expect(res.status).toBe(409);
  });

  it('returns 409 for duplicate username', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ email_exists: false, username_exists: true, phone_exists: false }] });
    dbMocks.getPgPool.mockReturnValueOnce({ query });

    const { POST } = await import('../route');
    const res = await POST(createRequest({
      username: 'user',
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: 'User',
    }));

    expect(res.status).toBe(409);
  });

  it('returns 409 for duplicate phone', async () => {
    const query = vi.fn();
    query.mockResolvedValueOnce({ rows: [{ email_exists: false, username_exists: false, phone_exists: true }] });
    dbMocks.getPgPool.mockReturnValueOnce({ query });

    const { POST } = await import('../route');
    const res = await POST(createRequest({
      username: 'user',
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: 'User',
      phone: '(555) 123-4567',
    }));

    expect(res.status).toBe(409);
  });

  it('returns 500 on unexpected error', async () => {
    dbMocks.getPgPool.mockImplementationOnce(() => {
      throw new Error('db crash');
    });

    const { POST } = await import('../route');
    const res = await POST(createRequest({
      username: 'user',
      email: 'user@example.com',
      password: 'StrongPass123',
      displayName: 'User',
    }));

    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  // B3: bcrypt silently truncates passwords >72 bytes — Zod must reject them
  it('accepts a password that is exactly 72 characters', async () => {
    const { POST } = await import('../route');
    const password = 'Aa1' + 'x'.repeat(69); // 72 chars with required complexity
    const res = await POST(createRequest({
      username: 'user72',
      email: 'user72@example.com',
      password,
      displayName: 'User Seventy Two',
    }));
    // Should pass validation (not a 400)
    expect(res.status).not.toBe(400);
  });

  it('rejects a password of 73 characters (B3)', async () => {
    const { POST } = await import('../route');
    const password = 'Aa1' + 'x'.repeat(70); // 73 chars
    const res = await POST(createRequest({
      username: 'user73',
      email: 'user73@example.com',
      password,
      displayName: 'User Seventy Three',
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/72/);
  });
});
