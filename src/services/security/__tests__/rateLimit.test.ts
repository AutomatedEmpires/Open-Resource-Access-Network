import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const redisMocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
}));

const databaseMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/cache/redis', () => redisMocks);
vi.mock('@/services/db/postgres', () => databaseMocks);
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));

import { checkRateLimit, checkRateLimitShared, resetRateLimitsForTests } from '@/services/security/rateLimit';

describe('checkRateLimit', () => {
  const windowMs = 60_000;
  const maxRequests = 2;

  beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitsForTests();
    redisMocks.getRedisClient.mockReturnValue(null);
    databaseMocks.isDatabaseConfigured.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('allows up to maxRequests within the window', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    expect(checkRateLimit('k', { windowMs, maxRequests }).exceeded).toBe(false);
    expect(checkRateLimit('k', { windowMs, maxRequests }).exceeded).toBe(false);
    const exceeded = checkRateLimit('k', { windowMs, maxRequests });
    expect(exceeded.exceeded).toBe(true);
    expect(exceeded.retryAfterSeconds).toBe(60);
  });

  it('resets the window after windowMs', () => {
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(1_000);
    expect(checkRateLimit('k', { windowMs, maxRequests }).count).toBe(1);
    expect(checkRateLimit('k', { windowMs, maxRequests }).count).toBe(2);

    now.mockReturnValue(1_000 + windowMs + 1);
    const state = checkRateLimit('k', { windowMs, maxRequests });
    expect(state.count).toBe(1);
    expect(state.exceeded).toBe(false);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('computes retryAfterSeconds based on remaining window time', () => {
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(1_000);
    checkRateLimit('k', { windowMs, maxRequests });

    now.mockReturnValue(1_000 + 59_001);
    const state = checkRateLimit('k', { windowMs, maxRequests });
    expect(state.retryAfterSeconds).toBe(1);

    now.mockReturnValue(1_000 + windowMs);
    const stateAtReset = checkRateLimit('k', { windowMs, maxRequests });
    expect(stateAtReset.retryAfterSeconds).toBeGreaterThanOrEqual(0);
  });

  it('uses the in-memory limiter only when no shared backend is configured locally', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const state = await checkRateLimitShared('shared-fallback', { windowMs, maxRequests });

    expect(state.count).toBe(1);
    expect(state.exceeded).toBe(false);
  });

  it('uses the atomic database limiter when Redis is not configured', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    databaseMocks.isDatabaseConfigured.mockReturnValue(true);
    databaseMocks.executeQuery.mockResolvedValue([{
      request_count: '3',
      window_started_at: '1970-01-01T00:00:01.000Z',
      reset_at: '1970-01-01T00:01:01.000Z',
    }]);

    const state = await checkRateLimitShared('search:ip:203.0.113.4', {
      windowMs,
      maxRequests,
    });

    expect(state).toMatchObject({
      key: 'search:ip:203.0.113.4',
      count: 3,
      windowStart: 1_000,
      exceeded: true,
      retryAfterSeconds: 56,
    });
    const [sql, params] = databaseMocks.executeQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('oran_internal.consume_shared_rate_limit');
    expect(params).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/), 60, maxRequests]);
    expect(params[0]).not.toContain('203.0.113.4');
  });

  it('uses Redis for database-less local shared rate limiting when configured', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    const evalMock = vi.fn().mockResolvedValue([3, 1_000]);
    redisMocks.getRedisClient.mockReturnValue({
      eval: evalMock,
    });

    const state = await checkRateLimitShared('shared-redis', { windowMs, maxRequests });

    expect(state.count).toBe(3);
    expect(state.windowStart).toBe(1_000);
    expect(state.exceeded).toBe(true);
    expect(state.retryAfterSeconds).toBe(56);
    expect(databaseMocks.executeQuery).not.toHaveBeenCalled();
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringMatching(/^rate-limit:[0-9a-f]{64}$/),
      '5000',
      '60000',
    );
  });

  it('keeps the database authoritative when Redis is also configured', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    const evalMock = vi.fn().mockRejectedValue(new Error('redis should not be called'));
    redisMocks.getRedisClient.mockReturnValue({
      eval: evalMock,
    });
    databaseMocks.isDatabaseConfigured.mockReturnValue(true);
    databaseMocks.executeQuery.mockResolvedValue([{
      request_count: 1,
      window_started_at: '1970-01-01T00:00:02.000Z',
      reset_at: '1970-01-01T00:01:02.000Z',
    }]);

    const state = await checkRateLimitShared('shared-error', { windowMs, maxRequests });

    expect(state.count).toBe(1);
    expect(databaseMocks.executeQuery).toHaveBeenCalledOnce();
    expect(evalMock).not.toHaveBeenCalled();
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('fails closed in production when the configured database limiter fails', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(Date, 'now').mockReturnValue(9_000);
    databaseMocks.isDatabaseConfigured.mockReturnValue(true);
    databaseMocks.executeQuery.mockRejectedValue(new Error('database unavailable'));
    const evalMock = vi.fn().mockResolvedValue([1, 9_000]);
    redisMocks.getRedisClient.mockReturnValue({ eval: evalMock });

    const state = await checkRateLimitShared('feedback:ip:203.0.113.8', {
      windowMs,
      maxRequests,
    });

    expect(state).toEqual({
      key: 'feedback:ip:203.0.113.8',
      count: maxRequests + 1,
      windowStart: 9_000,
      exceeded: true,
      retryAfterSeconds: 60,
      backendUnavailable: true,
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      { feature: 'shared_rate_limit_database' },
    );
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('fails closed in production when no shared backend is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(Date, 'now').mockReturnValue(10_000);

    const state = await checkRateLimitShared('admin:write:203.0.113.9', {
      windowMs,
      maxRequests,
    });

    expect(state.exceeded).toBe(true);
    expect(state.backendUnavailable).toBe(true);
    expect(state.count).toBe(maxRequests + 1);
  });
});
