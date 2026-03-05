/**
 * Search Cache — Redis-backed caching for ServiceSearchEngine queries.
 *
 * Cache strategy:
 *  - Key: "search:{sha256 of canonical query JSON}"
 *  - TTL: 5 minutes (search results can change as services are updated)
 *  - Cache-aside pattern: check cache → miss → query DB → store in cache
 *  - No cache for authenticated/personalized queries
 *
 * When Redis is not configured, all methods pass through to the engine directly.
 */

import { createHash } from 'crypto';
import { cacheGet, cacheSet, isRedisConfigured } from '@/services/cache/redis';
import type { SearchQuery, SearchResponse } from '@/services/search/types';
import type { ServiceSearchEngine } from '@/services/search/engine';

const SEARCH_CACHE_TTL_SECONDS = 300; // 5 minutes
const CACHE_KEY_PREFIX = 'search:';

/**
 * Build a deterministic cache key from a search query.
 * Uses SHA-256 of canonical JSON to avoid key length issues.
 */
export function buildCacheKey(query: SearchQuery): string {
  // Create a canonical representation (sorted keys)
  const canonical = JSON.stringify(query, Object.keys(query).sort());
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return `${CACHE_KEY_PREFIX}${hash}`;
}

/**
 * Execute a search with Redis caching.
 *
 * Returns cached results on hit, or queries the engine and caches
 * the result on miss. Falls through to direct engine call when
 * Redis is unavailable.
 */
export async function cachedSearch(
  engine: ServiceSearchEngine,
  query: SearchQuery,
): Promise<SearchResponse> {
  // Skip cache if Redis is not configured
  if (!isRedisConfigured()) {
    return engine.search(query);
  }

  const key = buildCacheKey(query);

  // Try cache first
  const cached = await cacheGet(key);
  if (cached) {
    try {
      return JSON.parse(cached) as SearchResponse;
    } catch {
      // Corrupted cache entry — fall through to DB
    }
  }

  // Cache miss — query engine
  const result = await engine.search(query);

  // Store in cache (fire-and-forget, don't block response)
  cacheSet(key, JSON.stringify(result), SEARCH_CACHE_TTL_SECONDS).catch(() => {});

  return result;
}
