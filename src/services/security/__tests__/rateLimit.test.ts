import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit, resetRateLimitsForTests } from '@/services/security/rateLimit';

describe('checkRateLimit', () => {
  const windowMs = 60_000;
  const maxRequests = 2;

  beforeEach(() => {
    resetRateLimitsForTests();
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
});
