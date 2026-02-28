import { describe, expect, it, vi } from 'vitest';

import {
  checkQuota,
  incrementQuota,
  resetSessionQuotasForTests,
} from '@/services/chat/orchestrator';
import {
  MAX_CHAT_QUOTA,
  MAX_SESSION_QUOTA_ENTRIES,
  SESSION_QUOTA_TTL_MS,
} from '@/domain/constants';

describe('chat session quota in-memory eviction', () => {
  it('resets a session quota after TTL', () => {
    resetSessionQuotasForTests();
    vi.useFakeTimers();

    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z'));
    incrementQuota('ttl-session');
    incrementQuota('ttl-session');

    const before = checkQuota('ttl-session');
    expect(before.messageCount).toBe(2);
    expect(before.remaining).toBe(MAX_CHAT_QUOTA - 2);

    vi.setSystemTime(new Date('2026-02-28T00:00:00.000Z').getTime() + SESSION_QUOTA_TTL_MS + 1);
    const after = checkQuota('ttl-session');
    expect(after.messageCount).toBe(0);
    expect(after.remaining).toBe(MAX_CHAT_QUOTA);

    vi.useRealTimers();
  });

  it('evicts oldest sessions when exceeding max entries', () => {
    resetSessionQuotasForTests();
    vi.useFakeTimers();

    vi.setSystemTime(0);
    incrementQuota('oldest');

    vi.setSystemTime(1);
    for (let i = 0; i < MAX_SESSION_QUOTA_ENTRIES + 1; i++) {
      incrementQuota(`s-${i}`);
    }

    const evicted = checkQuota('oldest');
    expect(evicted.messageCount).toBe(0);

    const retained = checkQuota(`s-${MAX_SESSION_QUOTA_ENTRIES}`);
    expect(retained.messageCount).toBe(1);

    vi.useRealTimers();
  });
});
