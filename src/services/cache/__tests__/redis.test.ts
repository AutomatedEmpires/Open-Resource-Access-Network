import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sentry
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: vi.fn(),
}));

describe('Redis Cache', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('isRedisConfigured returns false when REDIS_URL is not set', async () => {
    vi.stubEnv('REDIS_URL', '');
    const { isRedisConfigured } = await import('../redis');
    expect(isRedisConfigured()).toBe(false);
  });

  it('isRedisConfigured returns true when REDIS_URL is set', async () => {
    vi.stubEnv('REDIS_URL', 'rediss://:pass@host:6380');
    const { isRedisConfigured } = await import('../redis');
    expect(isRedisConfigured()).toBe(true);
  });

  it('cacheGet returns null when Redis is not configured', async () => {
    vi.stubEnv('REDIS_URL', '');
    const { cacheGet } = await import('../redis');
    const result = await cacheGet('some-key');
    expect(result).toBeNull();
  });

  it('cacheSet is a no-op when Redis is not configured', async () => {
    vi.stubEnv('REDIS_URL', '');
    const { cacheSet } = await import('../redis');
    // Should not throw
    await cacheSet('key', 'value', 300);
  });

  it('cacheDel is a no-op when Redis is not configured', async () => {
    vi.stubEnv('REDIS_URL', '');
    const { cacheDel } = await import('../redis');
    // Should not throw
    await cacheDel('key');
  });

  it('cacheInvalidatePattern is a no-op when Redis is not configured', async () => {
    vi.stubEnv('REDIS_URL', '');
    const { cacheInvalidatePattern } = await import('../redis');
    // Should not throw
    await cacheInvalidatePattern('search:*');
  });
});
