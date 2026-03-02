/**
 * Rate Limit Pruning and Edge Case Tests
 *
 * Tests the pruning behavior that prevents unbounded memory growth
 * in the in-memory rate limiter.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit, resetRateLimitsForTests } from '@/services/security/rateLimit';

describe('rate limit pruning', () => {
  const windowMs = 60_000;
  const maxRequests = 100;

  beforeEach(() => {
    resetRateLimitsForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stale entries are pruned after MAX_STALE_MS (10 minutes)', () => {
    const now = vi.spyOn(Date, 'now');

    // Create an entry at t=0
    now.mockReturnValue(0);
    checkRateLimit('stale-key', { windowMs, maxRequests });

    // Advance past the 10-minute stale threshold and trigger prune
    // Pruning runs every 100 calls
    now.mockReturnValue(11 * 60 * 1_000); // 11 minutes later
    for (let i = 0; i < 101; i++) {
      checkRateLimit(`prune-trigger-${i}`, { windowMs, maxRequests });
    }

    // The stale entry should have been pruned — next check starts fresh
    now.mockReturnValue(11 * 60 * 1_000 + 1);
    const state = checkRateLimit('stale-key', { windowMs, maxRequests });
    expect(state.count).toBe(1); // Fresh start, not carried over
  });

  it('different keys are tracked independently', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    checkRateLimit('key-a', { windowMs, maxRequests: 2 });
    checkRateLimit('key-b', { windowMs, maxRequests: 2 });
    checkRateLimit('key-a', { windowMs, maxRequests: 2 });

    const stateA = checkRateLimit('key-a', { windowMs, maxRequests: 2 });
    const stateB = checkRateLimit('key-b', { windowMs, maxRequests: 2 });

    expect(stateA.count).toBe(3);
    expect(stateA.exceeded).toBe(true);
    expect(stateB.count).toBe(2);
    expect(stateB.exceeded).toBe(false);
  });

  it('returns correct state shape', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5_000);

    const state = checkRateLimit('shape-test', { windowMs, maxRequests });
    expect(state).toHaveProperty('key', 'shape-test');
    expect(state).toHaveProperty('count', 1);
    expect(state).toHaveProperty('windowStart', 5_000);
    expect(state).toHaveProperty('exceeded', false);
  });

  it('handles rapid sequential calls correctly', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    // Burst of 5 requests with max 3
    for (let i = 0; i < 5; i++) {
      checkRateLimit('burst', { windowMs, maxRequests: 3 });
    }

    const state = checkRateLimit('burst', { windowMs, maxRequests: 3 });
    expect(state.count).toBe(6);
    expect(state.exceeded).toBe(true);
  });
});
