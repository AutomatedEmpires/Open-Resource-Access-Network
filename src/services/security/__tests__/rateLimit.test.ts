import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const redisMocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
}));

const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/cache/redis', () => redisMocks);
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExceptionMock }));

import { checkRateLimit, checkRateLimitShared, resetRateLimitsForTests } from '@/services/security/rateLimit';

describe('checkRateLimit', () => {
  const windowMs = 60_000;
  const maxRequests = 2;

  beforeEach(() => {
    resetRateLimitsForTests();
    redisMocks.getRedisClient.mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('falls back to the in-memory limiter when Redis is unavailable', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const state = await checkRateLimitShared('shared-fallback', { windowMs, maxRequests });

    expect(state.count).toBe(1);
    expect(state.exceeded).toBe(false);
  });

  it('uses Redis for shared rate limiting when configured', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000);
    redisMocks.getRedisClient.mockReturnValue({
      eval: vi.fn().mockResolvedValue([3, 1_000]),
    });

    const state = await checkRateLimitShared('shared-redis', { windowMs, maxRequests });

    expect(state.count).toBe(3);
    expect(state.windowStart).toBe(1_000);
    expect(state.exceeded).toBe(true);
    expect(state.retryAfterSeconds).toBe(56);
  });

  it('captures Redis errors and falls back to memory', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    redisMocks.getRedisClient.mockReturnValue({
      eval: vi.fn().mockRejectedValue(new Error('redis down')),
    });

    const state = await checkRateLimitShared('shared-error', { windowMs, maxRequests });

    expect(state.count).toBe(1);
    expect(captureExceptionMock).toHaveBeenCalledOnce();
  });
});
