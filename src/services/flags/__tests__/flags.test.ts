import { describe, expect, it, vi } from 'vitest';

import { InMemoryFlagService } from '@/services/flags/flags';
import { FEATURE_FLAGS } from '@/domain/constants';

describe('InMemoryFlagService', () => {
  it('defaults: llm_summarize enabled; map_enabled enabled', async () => {
    const service = new InMemoryFlagService();

    await expect(service.isEnabled(FEATURE_FLAGS.LLM_SUMMARIZE)).resolves.toBe(true);
    await expect(service.isEnabled(FEATURE_FLAGS.MAP_ENABLED)).resolves.toBe(true);
  });

  it('clamps rolloutPct to [0, 100] and only treats 100% as enabled', async () => {
    const service = new InMemoryFlagService([]);

    await service.setFlag('test_flag', true, 999);
    const high = await service.getFlag('test_flag');
    expect(high?.rolloutPct).toBe(100);
    await expect(service.isEnabled('test_flag')).resolves.toBe(true);

    await service.setFlag('test_flag', true, -5);
    const low = await service.getFlag('test_flag');
    expect(low?.rolloutPct).toBe(0);
    await expect(service.isEnabled('test_flag')).resolves.toBe(false);
  });

  it('preserves createdAt and updates updatedAt when toggling', async () => {
    vi.useFakeTimers();

    const service = new InMemoryFlagService([]);

    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'));
    await service.setFlag('time_flag', true, 100);
    const first = await service.getFlag('time_flag');

    vi.setSystemTime(new Date('2026-02-28T00:00:10.000Z'));
    await service.setFlag('time_flag', false, 100);
    const second = await service.getFlag('time_flag');

    expect(first?.createdAt.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(first?.updatedAt.toISOString()).toBe('2026-02-28T00:00:00.000Z');

    expect(second?.createdAt.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(second?.updatedAt.toISOString()).toBe('2026-02-28T00:00:10.000Z');

    vi.useRealTimers();
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
    const mutable = all.find((f) => f.name === 'mutable_flag');
    expect(mutable).toBeTruthy();
    if (mutable) {
      mutable.enabled = false;
    }

    await expect(service.isEnabled('mutable_flag')).resolves.toBe(true);
  });
});
