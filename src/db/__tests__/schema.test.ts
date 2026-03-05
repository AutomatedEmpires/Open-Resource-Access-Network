import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

const mutableEnv = process.env as Record<string, string | undefined>;

async function loadSchemaModule() {
  return import('../schema');
}

async function loadDbModule() {
  return import('../index');
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  delete mutableEnv.DATABASE_URL;
});

describe('db schema and helpers', () => {
  it('exports the core ingestion tables and relation helpers', async () => {
    const schema = await loadSchemaModule();
    const exportedNames = Object.keys(schema);

    expect(exportedNames).toEqual(
      expect.arrayContaining([
        'ingestionSources',
        'ingestionJobs',
        'evidenceSnapshots',
        'extractedCandidates',
        'resourceTags',
        'discoveredLinks',
        'ingestionAuditEvents',
        'llmSuggestions',
        'adminReviewProfiles',
        'candidateAdminAssignments',
        'tagConfirmationQueue',
        'publishCriteria',
        'candidateReadiness',
        'verificationChecks',
        'verifiedServiceLinks',
        'feedSubscriptions',
        'adminRoutingRules',
      ]),
    );
  });

  it('builds table configs for schema exports with indexes/constraints callbacks', async () => {
    const schema = await loadSchemaModule();
    const tableConfigs = Object.values(schema).flatMap((value) => {
      if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
        return [];
      }
      try {
        return [getTableConfig(value as Parameters<typeof getTableConfig>[0])];
      } catch {
        return [];
      }
    });

    expect(tableConfigs.length).toBeGreaterThan(20);
    expect(tableConfigs.some((cfg) => cfg.name === 'scope_audit_log')).toBe(true);
    expect(tableConfigs.some((cfg) => cfg.name === 'notification_events')).toBe(true);
    expect(tableConfigs.some((cfg) => cfg.name === 'notification_preferences')).toBe(true);

    const withIndexes = tableConfigs.filter((cfg) => cfg.indexes.length > 0);
    expect(withIndexes.length).toBeGreaterThan(10);
  });

  it('fails fast when DATABASE_URL is missing and no-ops on close without a pool', async () => {
    const { closeDb, getDb } = await loadDbModule();

    await expect(closeDb()).resolves.toBeUndefined();
    expect(() => getDb()).toThrow('DATABASE_URL environment variable is required');
  });

  it('creates, reuses, and closes the pool-backed drizzle client', async () => {
    const poolEndMock = vi.fn().mockResolvedValue(undefined);
    const poolInstance = { end: poolEndMock };
    const poolCtorMock = vi.fn(function MockPool() {
      return poolInstance;
    });
    const drizzleMock = vi.fn((pool: unknown, options: unknown) => ({
      pool,
      options,
    }));

    vi.doMock('pg', () => ({
      Pool: poolCtorMock,
    }));
    vi.doMock('drizzle-orm/node-postgres', () => ({
      drizzle: drizzleMock,
    }));
    mutableEnv.DATABASE_URL = 'postgres://oran:test@localhost:5432/oran';

    const { closeDb, getDb, getPool } = await loadDbModule();

    const first = getDb() as unknown as { pool: unknown; options: unknown };
    const second = getDb();
    const pool = getPool();

    expect(poolCtorMock).toHaveBeenCalledWith({
      connectionString: 'postgres://oran:test@localhost:5432/oran',
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    expect(drizzleMock).toHaveBeenCalledOnce();
    expect(first).toBe(second);
    expect(first.pool).toBe(poolInstance);
    expect(pool).toBe(poolInstance);
    expect(first.options).toEqual(
      expect.objectContaining({
        schema: expect.objectContaining({
          ingestionSources: expect.anything(),
          verifiedServiceLinks: expect.anything(),
        }),
      }),
    );

    await closeDb();

    expect(poolEndMock).toHaveBeenCalledOnce();
    vi.doUnmock('pg');
    vi.doUnmock('drizzle-orm/node-postgres');
  });
});
