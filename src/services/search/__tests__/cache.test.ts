import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildCacheKey, cachedSearch } from '../cache';
import type { SearchQuery, SearchResponse } from '../types';

// Mock Redis cache
vi.mock('@/services/cache/redis', () => ({
  isRedisConfigured: vi.fn(),
  cacheGet: vi.fn(),
  cacheSet: vi.fn().mockResolvedValue(undefined),
}));

import { isRedisConfigured, cacheGet, cacheSet } from '@/services/cache/redis';

const mockIsRedisConfigured = vi.mocked(isRedisConfigured);
const mockCacheGet = vi.mocked(cacheGet);
const mockCacheSet = vi.mocked(cacheSet);

const baseQuery: SearchQuery = {
  filters: { status: 'active' },
  pagination: { page: 1, limit: 20 },
};

const mockResponse: SearchResponse = {
  results: [],
  total: 0,
  page: 1,
  limit: 20,
  hasMore: false,
};

const mockEngine = {
  search: vi.fn().mockResolvedValue(mockResponse),
  searchByIds: vi.fn(),
  lookupCityCoords: vi.fn(),
} as unknown as import('../engine').ServiceSearchEngine;

describe('Search Cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildCacheKey', () => {
    it('generates deterministic keys for same query', () => {
      const key1 = buildCacheKey(baseQuery);
      const key2 = buildCacheKey(baseQuery);
      expect(key1).toBe(key2);
      expect(key1).toMatch(/^search:[a-f0-9]{16}$/);
    });

    it('generates different keys for different queries', () => {
      const key1 = buildCacheKey(baseQuery);
      const key2 = buildCacheKey({
        ...baseQuery,
        text: 'food bank',
      });
      expect(key1).not.toBe(key2);
    });
  });

  describe('cachedSearch', () => {
    it('calls engine directly when Redis is not configured', async () => {
      mockIsRedisConfigured.mockReturnValue(false);

      const result = await cachedSearch(mockEngine, baseQuery);

      expect(result).toEqual(mockResponse);
      expect(mockEngine.search).toHaveBeenCalledWith(baseQuery);
      expect(mockCacheGet).not.toHaveBeenCalled();
    });

    it('returns cached result on cache hit', async () => {
      mockIsRedisConfigured.mockReturnValue(true);
      mockCacheGet.mockResolvedValueOnce(JSON.stringify(mockResponse));

      const result = await cachedSearch(mockEngine, baseQuery);

      expect(result).toEqual(mockResponse);
      expect(mockEngine.search).not.toHaveBeenCalled();
    });

    it('queries engine and caches on cache miss', async () => {
      mockIsRedisConfigured.mockReturnValue(true);
      mockCacheGet.mockResolvedValueOnce(null);

      const result = await cachedSearch(mockEngine, baseQuery);

      expect(result).toEqual(mockResponse);
      expect(mockEngine.search).toHaveBeenCalledWith(baseQuery);
      expect(mockCacheSet).toHaveBeenCalledWith(
        expect.stringMatching(/^search:/),
        JSON.stringify(mockResponse),
        300,
      );
    });

    it('falls through to engine on corrupted cache entry', async () => {
      mockIsRedisConfigured.mockReturnValue(true);
      mockCacheGet.mockResolvedValueOnce('not-valid-json{{{');

      const result = await cachedSearch(mockEngine, baseQuery);

      expect(result).toEqual(mockResponse);
      expect(mockEngine.search).toHaveBeenCalled();
    });
  });
});
