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
    expect(checkRateLimit('k', { windowMs, maxRequests }).exceeded).toBe(true);
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
  });
});
