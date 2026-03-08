import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);

import { FEATURE_FLAGS } from '@/domain/constants';
import { HybridFlagService, InMemoryFlagService } from '@/services/flags/flags';

interface FeatureFlagRow {
  id: string;
  name: string;
  enabled: boolean;
  rollout_pct: number;
  description: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

function makeRow(name: string, enabled: boolean, rolloutPct = 100): FeatureFlagRow {
  return {
    id: `00000000-0000-4000-8000-${name.slice(0, 12).padEnd(12, '0')}`,
    name,
    enabled,
    rollout_pct: rolloutPct,
    description: `Description for ${name}`,
    created_by_user_id: 'seed-admin',
    updated_by_user_id: 'seed-admin',
    created_at: '2026-03-07T00:00:00.000Z',
    updated_at: '2026-03-07T00:00:00.000Z',
  };
}

describe('InMemoryFlagService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    dbMocks.executeQuery.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to safe AI posture while keeping core seeker surfaces enabled', async () => {
    const service = new InMemoryFlagService();

    await expect(service.isEnabled(FEATURE_FLAGS.LLM_SUMMARIZE)).resolves.toBe(false);
    await expect(service.isEnabled(FEATURE_FLAGS.MAP_ENABLED)).resolves.toBe(true);
  });

  it('supports deterministic partial rollout only when a subject key is provided', async () => {
    const service = new InMemoryFlagService([]);

    await service.setFlag('partial_flag', true, 25);

    await expect(service.isEnabled('partial_flag')).resolves.toBe(false);

    const first = await service.isEnabled('partial_flag', 'user-17');
    const second = await service.isEnabled('partial_flag', 'user-17');
    expect(second).toBe(first);

    const sample = await Promise.all(
      Array.from({ length: 40 }, (_, index) => service.isEnabled('partial_flag', `user-${index}`)),
    );
    expect(sample.some(Boolean)).toBe(true);
    expect(sample.some((enabled) => !enabled)).toBe(true);
  });

  it('preserves createdAt while updating updatedAt and actor metadata on toggles', async () => {
    vi.useFakeTimers();

    const service = new InMemoryFlagService([]);

    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'));
    await service.setFlag('time_flag', true, 100, { actorUserId: 'admin-1' });
    const first = await service.getFlag('time_flag');

    vi.setSystemTime(new Date('2026-02-28T00:00:10.000Z'));
    await service.setFlag('time_flag', false, 100, { actorUserId: 'admin-2' });
    const second = await service.getFlag('time_flag');

    expect(first?.createdAt.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(first?.updatedAt.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(first?.createdByUserId).toBe('admin-1');
    expect(first?.updatedByUserId).toBe('admin-1');

    expect(second?.createdAt.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(second?.updatedAt.toISOString()).toBe('2026-02-28T00:00:10.000Z');
    expect(second?.createdByUserId).toBe('admin-1');
    expect(second?.updatedByUserId).toBe('admin-2');
  });

  it('does not leak mutable flag references from getFlag/getAllFlags', async () => {
    const service = new InMemoryFlagService([]);

    await service.setFlag('mutable_flag', true, 100);

    const fromGet = await service.getFlag('mutable_flag');
    expect(fromGet).not.toBeNull();
    if (fromGet) {
      fromGet.enabled = false;
      fromGet.rolloutPct = 0;
      fromGet.updatedAt = new Date('2000-01-01T00:00:00.000Z');
    }

    await expect(service.isEnabled('mutable_flag')).resolves.toBe(true);

    const all = await service.getAllFlags();
    const mutable = all.find((flag) => flag.name === 'mutable_flag');
    expect(mutable).toBeTruthy();
    if (mutable) {
      mutable.enabled = false;
    }

    await expect(service.isEnabled('mutable_flag')).resolves.toBe(true);
  });
});

describe('HybridFlagService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    dbMocks.executeQuery.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the database-backed catalog when configured and merges missing defaults', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([
      makeRow(FEATURE_FLAGS.MAP_ENABLED, false, 0),
    ]);

    const service = new HybridFlagService(new InMemoryFlagService([]));

    await expect(service.getImplementation()).resolves.toBe('database');

    const flags = await service.getAllFlags();
    expect(flags.find((flag) => flag.name === FEATURE_FLAGS.MAP_ENABLED)?.enabled).toBe(false);
    expect(flags.find((flag) => flag.name === FEATURE_FLAGS.LLM_SUMMARIZE)?.enabled).toBe(false);
  });

  it('falls back to the local in-memory catalog when the database is not configured', async () => {
    const fallback = new InMemoryFlagService([]);
    await fallback.setFlag('local_only', true, 100, { actorUserId: 'dev-admin' });

    const service = new HybridFlagService(fallback);

    await expect(service.getImplementation()).resolves.toBe('in_memory');
    await expect(service.isEnabled('local_only')).resolves.toBe(true);
  });

  it('reuses the last known good database snapshot when a later read fails', async () => {
    vi.useFakeTimers();
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery.mockResolvedValueOnce([
      makeRow(FEATURE_FLAGS.MAP_ENABLED, false, 0),
    ]);

    const service = new HybridFlagService(new InMemoryFlagService([]));

    const initial = await service.getFlag(FEATURE_FLAGS.MAP_ENABLED);
    expect(initial?.enabled).toBe(false);

    vi.advanceTimersByTime(5_100);
    dbMocks.executeQuery.mockRejectedValueOnce(new Error('database offline'));

    await expect(service.getImplementation()).resolves.toBe('database');
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(2);
  });

  it('writes DB-backed updates with audit metadata and syncs the fallback cache', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(true);
    dbMocks.executeQuery
      .mockResolvedValueOnce([makeRow(FEATURE_FLAGS.LLM_SUMMARIZE, false, 0)])
      .mockResolvedValueOnce([
        {
          ...makeRow(FEATURE_FLAGS.LLM_SUMMARIZE, true, 25),
          updated_by_user_id: 'admin-1',
          updated_at: '2026-03-07T00:05:00.000Z',
        },
      ])
      .mockResolvedValueOnce([]);

    const fallback = new InMemoryFlagService([]);
    const service = new HybridFlagService(fallback);

    await service.setFlag(FEATURE_FLAGS.LLM_SUMMARIZE, true, 25, {
      actorUserId: 'admin-1',
      actorRole: 'oran_admin',
      reason: 'Enable staged rollout',
    });

    expect(dbMocks.executeQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO feature_flags'),
      [
        FEATURE_FLAGS.LLM_SUMMARIZE,
        true,
        25,
        expect.any(String),
        'admin-1',
      ],
    );
    expect(dbMocks.executeQuery).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO audit_logs'),
      [
        'admin-1',
        'oran_admin',
        expect.any(String),
        expect.any(String),
        expect.stringContaining('Enable staged rollout'),
      ],
    );

    const fallbackFlag = await fallback.getFlag(FEATURE_FLAGS.LLM_SUMMARIZE);
    expect(fallbackFlag?.enabled).toBe(true);
    expect(fallbackFlag?.rolloutPct).toBe(25);
    expect(fallbackFlag?.updatedByUserId).toBe('admin-1');
  });
});
