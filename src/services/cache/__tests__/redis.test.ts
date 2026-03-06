import { beforeEach, describe, expect, it, vi } from 'vitest';

const redisCtorMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());

vi.mock('ioredis', () => ({
  default: redisCtorMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));

type MockRedisClient = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  scanStream: ReturnType<typeof vi.fn>;
  pipeline: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
};

function createClient(overrides: Partial<MockRedisClient> = {}): MockRedisClient {
  const pipelineDel = vi.fn();
  const pipelineExec = vi.fn().mockResolvedValue([]);

  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    scanStream: vi.fn().mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield ['search:a', 'search:b'];
      },
    }),
    pipeline: vi.fn().mockReturnValue({
      del: pipelineDel,
      exec: pipelineExec,
    }),
    quit: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('Redis Cache', () => {
  it('reports whether REDIS_URL is configured', async () => {
    vi.stubEnv('REDIS_URL', '');
    const redisModule = await import('../redis');
    expect(redisModule.isRedisConfigured()).toBe(false);

    vi.resetModules();
    vi.stubEnv('REDIS_URL', 'rediss://:pass@host:6380');
    const configuredModule = await import('../redis');
    expect(configuredModule.isRedisConfigured()).toBe(true);
  });

  it('is a no-op when redis is not configured', async () => {
    vi.stubEnv('REDIS_URL', '');
    const { cacheGet, cacheSet, cacheDel, cacheInvalidatePattern } = await import('../redis');

    await expect(cacheGet('some-key')).resolves.toBeNull();
    await expect(cacheSet('k', 'v', 60)).resolves.toBeUndefined();
    await expect(cacheDel('k')).resolves.toBeUndefined();
    await expect(cacheInvalidatePattern('search:*')).resolves.toBeUndefined();

    expect(redisCtorMock).not.toHaveBeenCalled();
  });

  it('uses a singleton client for get/set/del operations', async () => {
    vi.stubEnv('REDIS_URL', 'rediss://:pass@host:6380');
    const client = createClient({
      get: vi.fn().mockResolvedValue('cached-value'),
    });
    redisCtorMock.mockImplementation(function mockRedisCtor() {
      return client;
    });

    const { cacheGet, cacheSet, cacheDel } = await import('../redis');

    await expect(cacheGet('search:1')).resolves.toBe('cached-value');
    await cacheSet('search:1', 'value', 300);
    await cacheDel('search:1');

    expect(redisCtorMock).toHaveBeenCalledTimes(1);
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(client.get).toHaveBeenCalledWith('search:1');
    expect(client.set).toHaveBeenCalledWith('search:1', 'value', 'EX', 300);
    expect(client.del).toHaveBeenCalledWith('search:1');
  });

  it('captures exceptions from get/set/del', async () => {
    vi.stubEnv('REDIS_URL', 'rediss://:pass@host:6380');
    const client = createClient({
      get: vi.fn().mockRejectedValue(new Error('get failed')),
      set: vi.fn().mockRejectedValue(new Error('set failed')),
      del: vi.fn().mockRejectedValue(new Error('del failed')),
    });
    redisCtorMock.mockImplementation(function mockRedisCtor() {
      return client;
    });

    const { cacheGet, cacheSet, cacheDel } = await import('../redis');

    await expect(cacheGet('k1')).resolves.toBeNull();
    await cacheSet('k1', 'v', 60);
    await cacheDel('k1');

    expect(captureExceptionMock).toHaveBeenCalledTimes(3);
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), { feature: 'redis_get' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), { feature: 'redis_set' });
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), { feature: 'redis_del' });
  });

  it('invalidates keys by pattern using scan + pipeline', async () => {
    vi.stubEnv('REDIS_URL', 'rediss://:pass@host:6380');
    const pipelineDel = vi.fn();
    const pipelineExec = vi.fn().mockResolvedValue([]);
    const client = createClient({
      scanStream: vi.fn().mockReturnValue({
        async *[Symbol.asyncIterator]() {
          yield ['search:a', 'search:b'];
        },
      }),
      pipeline: vi.fn().mockReturnValue({ del: pipelineDel, exec: pipelineExec }),
    });
    redisCtorMock.mockImplementation(function mockRedisCtor() {
      return client;
    });

    const { cacheInvalidatePattern } = await import('../redis');

    await cacheInvalidatePattern('search:*');

    expect(client.scanStream).toHaveBeenCalledWith({ match: 'search:*', count: 100 });
    expect(pipelineDel).toHaveBeenCalledTimes(2);
    expect(pipelineDel).toHaveBeenNthCalledWith(1, 'search:a');
    expect(pipelineDel).toHaveBeenNthCalledWith(2, 'search:b');
    expect(pipelineExec).toHaveBeenCalledTimes(1);
  });

  it('handles invalidate failures and supports reset helper', async () => {
    vi.stubEnv('REDIS_URL', 'rediss://:pass@host:6380');
    const client = createClient({
      scanStream: vi.fn().mockImplementation(() => {
        throw new Error('scan failed');
      }),
    });
    redisCtorMock.mockImplementation(function mockRedisCtor() {
      return client;
    });

    const redisModule = await import('../redis');

    await redisModule.cacheInvalidatePattern('search:*');
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), {
      feature: 'redis_invalidate',
    });

    await redisModule._resetRedis();
    expect(client.quit).toHaveBeenCalledTimes(1);

    await redisModule.cacheGet('after-reset');
    expect(redisCtorMock).toHaveBeenCalledTimes(2);
  });

  it('marks connection as failed after retry threshold and stops future use', async () => {
    vi.stubEnv('REDIS_URL', 'rediss://:pass@host:6380');
    const client = createClient({
      get: vi.fn().mockResolvedValue('first-call'),
    });
    redisCtorMock.mockImplementation(function mockRedisCtor() {
      return client;
    });

    const { cacheGet } = await import('../redis');

    await expect(cacheGet('k')).resolves.toBe('first-call');
    const options = redisCtorMock.mock.calls[0]?.[1] as {
      retryStrategy: (times: number) => number | null;
    };
    expect(options.retryStrategy(4)).toBeNull();

    await expect(cacheGet('k')).resolves.toBeNull();
    expect(client.get).toHaveBeenCalledTimes(1);
  });
});
