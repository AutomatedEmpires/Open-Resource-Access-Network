export interface RateLimitState {
  key: string;
  count: number;
  windowStart: number;
  exceeded: boolean;
  /** Seconds until the current window resets (use for HTTP Retry-After). */
  retryAfterSeconds: number;
}

import { getRedisClient } from '@/services/cache/redis';
import { captureException } from '@/services/telemetry/sentry';

const rateLimitWindows = new Map<string, { count: number; windowStart: number }>();

// ============================================================
// PRUNING — prevents unbounded memory growth
// ============================================================

/** Max staleness before an entry is eligible for pruning (10 minutes) */
const MAX_STALE_MS = 10 * 60 * 1_000;
/** Hard cap on tracked keys; oldest are evicted if exceeded */
const MAX_RATE_LIMIT_ENTRIES = 10_000;
/** Run a full prune sweep every N calls */
const PRUNE_INTERVAL = 100;
let pruneCounter = 0;

function maybePrune(): void {
  pruneCounter++;
  if (pruneCounter < PRUNE_INTERVAL && rateLimitWindows.size <= MAX_RATE_LIMIT_ENTRIES) return;
  pruneCounter = 0;

  const now = Date.now();
  for (const [k, entry] of rateLimitWindows.entries()) {
    if (now - entry.windowStart > MAX_STALE_MS) {
      rateLimitWindows.delete(k);
    }
  }
}

// ============================================================
// CHECK
// ============================================================

export function checkRateLimit(
  key: string,
  options: {
    windowMs: number;
    maxRequests: number;
  }
): RateLimitState {
  maybePrune();

  const now = Date.now();
  const window = rateLimitWindows.get(key);

   const computeRetryAfterSeconds = (windowStart: number): number => {
    const resetAt = windowStart + options.windowMs;
    const msRemaining = resetAt - now;
    return Math.max(0, Math.ceil(msRemaining / 1000));
  };

  if (!window || now - window.windowStart > options.windowMs) {
    rateLimitWindows.set(key, { count: 1, windowStart: now });
    return {
      key,
      count: 1,
      windowStart: now,
      exceeded: false,
      retryAfterSeconds: computeRetryAfterSeconds(now),
    };
  }

  const newCount = window.count + 1;
  rateLimitWindows.set(key, { count: newCount, windowStart: window.windowStart });

  return {
    key,
    count: newCount,
    windowStart: window.windowStart,
    exceeded: newCount > options.maxRequests,
    retryAfterSeconds: computeRetryAfterSeconds(window.windowStart),
  };
}

const SHARED_RATE_LIMIT_LUA = `
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local currentCount = tonumber(redis.call('HGET', KEYS[1], 'count') or '0')
local windowStart = tonumber(redis.call('HGET', KEYS[1], 'windowStart') or '0')

if currentCount == 0 or (now - windowStart) > windowMs then
  currentCount = 1
  windowStart = now
else
  currentCount = currentCount + 1
end

redis.call('HSET', KEYS[1], 'count', currentCount, 'windowStart', windowStart)

local expiresIn = windowMs - (now - windowStart)
if expiresIn <= 0 then
  expiresIn = windowMs
end
redis.call('PEXPIRE', KEYS[1], expiresIn)

return { tostring(currentCount), tostring(windowStart) }
`;

/**
 * Shared-capable limiter for production endpoints. Uses Redis when available
 * and falls back to the in-memory limiter when Redis is unavailable.
 */
export async function checkRateLimitShared(
  key: string,
  options: {
    windowMs: number;
    maxRequests: number;
  }
): Promise<RateLimitState> {
  const client = getRedisClient();
  if (!client) {
    return checkRateLimit(key, options);
  }

  const now = Date.now();
  try {
    const result = await client.eval(
      SHARED_RATE_LIMIT_LUA,
      1,
      `rate-limit:${key}`,
      String(now),
      String(options.windowMs),
    ) as [string | number, string | number];

    const count = Number(result?.[0] ?? 0);
    const windowStart = Number(result?.[1] ?? now);
    const resetAt = windowStart + options.windowMs;
    const retryAfterSeconds = Math.max(0, Math.ceil((resetAt - now) / 1000));

    return {
      key,
      count,
      windowStart,
      exceeded: count > options.maxRequests,
      retryAfterSeconds,
    };
  } catch (error) {
    await captureException(error, { feature: 'shared_rate_limit' });
    return checkRateLimit(key, options);
  }
}

export function resetRateLimitsForTests(): void {
  rateLimitWindows.clear();
  pruneCounter = 0;
}
