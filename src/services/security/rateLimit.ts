import { createHash } from 'node:crypto';

import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { getRedisClient } from '@/services/cache/redis';
import { captureException } from '@/services/telemetry/sentry';

export interface RateLimitState {
  key: string;
  count: number;
  windowStart: number;
  exceeded: boolean;
  /** Seconds until the current window resets (use for HTTP Retry-After). */
  retryAfterSeconds: number;
  /** True when production denied the request because no shared backend succeeded. */
  backendUnavailable?: boolean;
}

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

interface DatabaseRateLimitRow {
  request_count: number | string;
  window_started_at: Date | string;
  reset_at: Date | string;
}

function hashSharedRateLimitKey(key: string): string {
  return createHash('sha256')
    .update('oran:shared-rate-limit:v1\0', 'utf8')
    .update(key, 'utf8')
    .digest('hex');
}

function parseDatabaseTimestamp(value: Date | string, field: string): number {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Shared rate limiter returned an invalid ${field}`);
  }
  return timestamp;
}

async function checkRateLimitInDatabase(
  key: string,
  options: {
    windowMs: number;
    maxRequests: number;
  },
): Promise<RateLimitState> {
  const rows = await executeQuery<DatabaseRateLimitRow>(
    `SELECT request_count, window_started_at, reset_at
     FROM oran_internal.consume_shared_rate_limit($1::text, $2::integer, $3::integer)`,
    [
      hashSharedRateLimitKey(key),
      Math.max(1, Math.ceil(options.windowMs / 1_000)),
      options.maxRequests,
    ],
  );

  const row = rows[0];
  const count = Number(row?.request_count);
  if (!row || !Number.isSafeInteger(count) || count < 1) {
    throw new Error('Shared rate limiter returned an invalid count');
  }

  const windowStart = parseDatabaseTimestamp(row.window_started_at, 'window start');
  const resetAt = parseDatabaseTimestamp(row.reset_at, 'reset time');
  const retryAfterSeconds = Math.max(0, Math.ceil((resetAt - Date.now()) / 1_000));

  return {
    key,
    count,
    windowStart,
    exceeded: count > options.maxRequests,
    retryAfterSeconds,
  };
}

function unavailableRateLimitState(
  key: string,
  options: {
    windowMs: number;
    maxRequests: number;
  },
): RateLimitState {
  const now = Date.now();
  return {
    key,
    count: options.maxRequests + 1,
    windowStart: now,
    exceeded: true,
    retryAfterSeconds: Math.max(1, Math.ceil(options.windowMs / 1_000)),
    backendUnavailable: true,
  };
}

/**
 * Shared limiter for horizontally scaled endpoints. The private Postgres
 * limiter is authoritative whenever the application database is configured.
 * This avoids switching between independent counters during a provider outage.
 * Redis remains available for database-less local/test runtimes. Production
 * never falls back to a different counter or to per-instance memory.
 */
export async function checkRateLimitShared(
  key: string,
  options: {
    windowMs: number;
    maxRequests: number;
  }
): Promise<RateLimitState> {
  if (isDatabaseConfigured()) {
    try {
      return await checkRateLimitInDatabase(key, options);
    } catch (error) {
      await captureException(error, { feature: 'shared_rate_limit_database' });
      if (process.env.NODE_ENV === 'production') {
        return unavailableRateLimitState(key, options);
      }
    }
  }

  const client = getRedisClient();
  if (client && process.env.NODE_ENV !== 'production') {
    const now = Date.now();
    try {
      const result = await client.eval(
        SHARED_RATE_LIMIT_LUA,
        1,
        `rate-limit:${hashSharedRateLimitKey(key)}`,
        String(now),
        String(options.windowMs),
      ) as [string | number, string | number];

      const count = Number(result?.[0] ?? 0);
      const windowStart = Number(result?.[1] ?? now);
      if (
        !Number.isSafeInteger(count)
        || count < 1
        || !Number.isFinite(windowStart)
        || windowStart < 0
      ) {
        throw new Error('Redis shared rate limiter returned an invalid result');
      }
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
      await captureException(error, { feature: 'shared_rate_limit_redis' });
    }
  }

  if (process.env.NODE_ENV !== 'production') return checkRateLimit(key, options);
  return unavailableRateLimitState(key, options);
}

export function resetRateLimitsForTests(): void {
  rateLimitWindows.clear();
  pruneCounter = 0;
}
