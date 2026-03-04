import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { PoolMock, poolInstances } = vi.hoisted(() => {
  const poolInstances: Array<{
    query: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    client: {
      query: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
    };
  }> = [];

  const PoolMock = vi.fn(function MockPool() {
    const client = {
      query: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    const instance = {
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(client),
      client,
    };
    poolInstances.push(instance);
    return instance;
  });

  return { PoolMock, poolInstances };
});

vi.mock('pg', () => ({
  Pool: PoolMock,
  PoolClient: class {},
}));

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const globalWithPool = globalThis as typeof globalThis & { __oranPgPool?: unknown };
const mutableEnv = process.env as Record<string, string | undefined>;

type MockPoolInstance = (typeof poolInstances)[number];

function asMockPool(value: unknown): MockPoolInstance {
  return value as MockPoolInstance;
}

async function loadPostgresModule() {
  return import('../postgres');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  poolInstances.length = 0;
  delete process.env.DATABASE_URL;
  mutableEnv.NODE_ENV = 'test';
  delete globalWithPool.__oranPgPool;
});

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }

  if (originalNodeEnv === undefined) {
    delete mutableEnv.NODE_ENV;
  } else {
    mutableEnv.NODE_ENV = originalNodeEnv;
  }

  delete globalWithPool.__oranPgPool;
});

describe('postgres utilities', () => {
  it('detects whether the database is configured', async () => {
    const postgres = await loadPostgresModule();

    expect(postgres.isDatabaseConfigured()).toBe(false);

    process.env.DATABASE_URL = 'postgres://oran:test@localhost:5432/oran';

    expect(postgres.isDatabaseConfigured()).toBe(true);
  });

  it('throws when asking for a pool without DATABASE_URL', async () => {
    const postgres = await loadPostgresModule();

    expect(() => postgres.getPgPool()).toThrow('DATABASE_URL is not configured');
  });

  it('reuses a global singleton pool outside production', async () => {
    process.env.DATABASE_URL = 'postgres://oran:test@localhost:5432/oran';
    mutableEnv.NODE_ENV = 'development';
    const postgres = await loadPostgresModule();

    const first = postgres.getPgPool();
    const second = postgres.getPgPool();

    expect(first).toBe(second);
    expect(PoolMock).toHaveBeenCalledTimes(1);
    const firstCall = PoolMock.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(firstCall?.[0]).toMatchObject({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 30_000,
    });
    expect(globalWithPool.__oranPgPool).toBe(first);
  });

  it('reuses a module singleton pool in production without touching globalThis', async () => {
    process.env.DATABASE_URL = 'postgres://oran:test@localhost:5432/oran';
    mutableEnv.NODE_ENV = 'production';
    const postgres = await loadPostgresModule();

    const first = postgres.getPgPool();
    const second = postgres.getPgPool();

    expect(first).toBe(second);
    expect(PoolMock).toHaveBeenCalledTimes(1);
    expect(globalWithPool.__oranPgPool).toBeUndefined();
  });

  it('executes queries and returns row payloads', async () => {
    process.env.DATABASE_URL = 'postgres://oran:test@localhost:5432/oran';
    const postgres = await loadPostgresModule();
    const pool = asMockPool(postgres.getPgPool());
    pool.query.mockResolvedValue([{ rows: [{ id: 'svc-1' }] }][0]);

    await expect(postgres.executeQuery('SELECT * FROM services WHERE id = $1', ['svc-1'])).resolves.toEqual([
      { id: 'svc-1' },
    ]);
    expect(pool.query).toHaveBeenCalledWith('SELECT * FROM services WHERE id = $1', ['svc-1']);
  });

  it('parses count queries and falls back to zero for invalid values', async () => {
    process.env.DATABASE_URL = 'postgres://oran:test@localhost:5432/oran';
    const postgres = await loadPostgresModule();
    const pool = asMockPool(postgres.getPgPool());

    pool.query.mockResolvedValueOnce({ rows: [{ count: '7' }] });
    await expect(postgres.executeCount('SELECT COUNT(*) AS count FROM services', [])).resolves.toBe(7);

    pool.query.mockResolvedValueOnce({ rows: [{ count: 'not-a-number' }] });
    await expect(postgres.executeCount('SELECT COUNT(*) AS count FROM services', [])).resolves.toBe(0);
  });

  it('wraps successful work in BEGIN/COMMIT and releases the client', async () => {
    process.env.DATABASE_URL = 'postgres://oran:test@localhost:5432/oran';
    const postgres = await loadPostgresModule();
    const pool = asMockPool(postgres.getPgPool());

    const result = await postgres.withTransaction(async (client) => {
      expect(client).toBe(pool.client);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(pool.client.query.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'COMMIT']);
    expect(pool.client.release).toHaveBeenCalledOnce();
  });

  it('rolls back and rethrows when the transaction body fails', async () => {
    process.env.DATABASE_URL = 'postgres://oran:test@localhost:5432/oran';
    const postgres = await loadPostgresModule();
    const pool = asMockPool(postgres.getPgPool());

    await expect(
      postgres.withTransaction(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(pool.client.query.mock.calls.map((call) => call[0])).toEqual(['BEGIN', 'ROLLBACK']);
    expect(pool.client.release).toHaveBeenCalledOnce();
  });
});
