export interface RateLimitState {
  key: string;
  count: number;
  windowStart: number;
  exceeded: boolean;
}

const rateLimitWindows = new Map<string, { count: number; windowStart: number }>();

export function checkRateLimit(
  key: string,
  options: {
    windowMs: number;
    maxRequests: number;
  }
): RateLimitState {
  const now = Date.now();
  const window = rateLimitWindows.get(key);

  if (!window || now - window.windowStart > options.windowMs) {
    rateLimitWindows.set(key, { count: 1, windowStart: now });
    return { key, count: 1, windowStart: now, exceeded: false };
  }

  const newCount = window.count + 1;
  rateLimitWindows.set(key, { count: newCount, windowStart: window.windowStart });

  return {
    key,
    count: newCount,
    windowStart: window.windowStart,
    exceeded: newCount > options.maxRequests,
  };
}

export function resetRateLimitsForTests(): void {
  rateLimitWindows.clear();
}
