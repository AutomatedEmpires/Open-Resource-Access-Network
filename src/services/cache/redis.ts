/**
 * Azure Cache for Redis — Client Wrapper
 *
 * Provides a lazy-initialized Redis connection for caching.
 * Requires REDIS_URL in environment (Azure Cache for Redis connection string).
 *
 * Connection format:
 *   rediss://:password@hostname:6380  (Azure Cache for Redis, TLS)
 *
 * Falls back gracefully when Redis is not configured — all operations
 * become no-ops so the app works without Redis in local dev.
 */

import Redis from 'ioredis';
import { captureException } from '@/services/telemetry/sentry';

// ============================================================
// CLIENT SINGLETON
// ============================================================

let redis: Redis | null = null;
let connectionFailed = false;

/**
 * Returns true when Redis is configured via REDIS_URL.
 */
export function isRedisConfigured(): boolean {
  return !!process.env.REDIS_URL;
}

/**
 * Get the Redis client singleton. Returns null if not configured
 * or if a previous connection attempt failed.
 */
function getRedis(): Redis | null {
  if (connectionFailed) return null;
  if (redis) return redis;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) {
          connectionFailed = true;
          return null; // stop retrying
        }
        return Math.min(times * 200, 2000);
      },
      enableReadyCheck: true,
      connectTimeout: 5000,
      // Azure Cache for Redis uses TLS on port 6380
      tls: url.startsWith('rediss://') ? {} : undefined,
    });

    redis.on('error', (err) => {
      console.error('[redis] Connection error:', err.message);
    });

    return redis;
  } catch (error) {
    connectionFailed = true;
    console.error('[redis] Failed to initialize:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Exposes the shared Redis client for infrastructure helpers such as the
 * distributed rate limiter. Returns null when Redis is unavailable.
 */
export function getRedisClient(): Redis | null {
  return getRedis();
}

// ============================================================
// CACHE OPERATIONS
// ============================================================

/**
 * Get a cached value. Returns null on miss or when Redis is unavailable.
 */
export async function cacheGet(key: string): Promise<string | null> {
  const client = getRedis();
  if (!client) return null;

  try {
    return await client.get(key);
  } catch (error) {
    await captureException(error, { feature: 'redis_get' });
    return null;
  }
}

/**
 * Set a cached value with TTL in seconds.
 */
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    await client.set(key, value, 'EX', ttlSeconds);
  } catch (error) {
    await captureException(error, { feature: 'redis_set' });
  }
}

/**
 * Delete a cached key (for cache invalidation).
 */
export async function cacheDel(key: string): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    await client.del(key);
  } catch (error) {
    await captureException(error, { feature: 'redis_del' });
  }
}

/**
 * Delete all keys matching a pattern (e.g., "search:*").
 * Uses SCAN to avoid blocking Redis.
 */
export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  const client = getRedis();
  if (!client) return;

  try {
    const stream = client.scanStream({ match: pattern, count: 100 });
    const pipeline = client.pipeline();
    let count = 0;

    for await (const keys of stream) {
      for (const key of keys as string[]) {
        pipeline.del(key);
        count++;
      }
    }

    if (count > 0) {
      await pipeline.exec();
    }
  } catch (error) {
    await captureException(error, { feature: 'redis_invalidate' });
  }
}

// ============================================================
// TEST HELPERS
// ============================================================

/** @internal — reset singleton for tests */
export async function _resetRedis(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => {});
    redis = null;
  }
  connectionFailed = false;
}
