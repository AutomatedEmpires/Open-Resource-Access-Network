import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkQuota,
  checkQuotaSync,
  incrementQuota,
  resetSessionQuotasForTests,
} from '@/services/chat/quota';
import { MAX_CHAT_QUOTA } from '@/domain/constants';
import { captureException } from '@/services/telemetry/sentry';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';

vi.mock('@/services/db/postgres', () => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));

vi.mock('@/services/telemetry/sentry', () => ({
  captureException: vi.fn(),
}));

const isDbConfiguredMock = vi.mocked(isDatabaseConfigured);
const executeQueryMock = vi.mocked(executeQuery);
const captureExceptionMock = vi.mocked(captureException);

describe('chat quota (db-backed + fallback)', () => {
  beforeEach(() => {
    resetSessionQuotasForTests();
    isDbConfiguredMock.mockReset();
    executeQueryMock.mockReset();
    captureExceptionMock.mockReset();
  });

  it('reads quota from the database when configured', async () => {
    isDbConfiguredMock.mockReturnValue(true);
    executeQueryMock.mockResolvedValueOnce([{ message_count: 3 }]);

    const result = await checkQuota('session-db');

    expect(executeQueryMock).toHaveBeenCalledWith(
      'SELECT message_count FROM chat_sessions WHERE id = $1',
      ['session-db'],
    );
    expect(result).toEqual({
      sessionId: 'session-db',
      messageCount: 3,
      remaining: MAX_CHAT_QUOTA - 3,
      exceeded: false,
    });
  });

  it('treats missing rows as zero count', async () => {
    isDbConfiguredMock.mockReturnValue(true);
    executeQueryMock.mockResolvedValueOnce([]);

    const result = await checkQuota('session-empty');

    expect(result.messageCount).toBe(0);
    expect(result.remaining).toBe(MAX_CHAT_QUOTA);
  });

  it('falls back to in-memory when db reads fail', async () => {
    isDbConfiguredMock.mockReturnValue(false);
    await incrementQuota('session-fallback');

    isDbConfiguredMock.mockReturnValue(true);
    executeQueryMock.mockRejectedValueOnce(new Error('db down'));

    const result = await checkQuota('session-fallback');

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ feature: 'chat_quota_check', sessionId: 'session-fallback' }),
    );
    expect(result.messageCount).toBe(1);
  });

  it('increments quota in db and uses in-memory on error', async () => {
    isDbConfiguredMock.mockReturnValue(true);
    executeQueryMock.mockResolvedValueOnce([]);

    await incrementQuota('session-inc', 'user-1');

    expect(executeQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO chat_sessions'),
      ['session-inc', 'user-1'],
    );

    executeQueryMock.mockRejectedValueOnce(new Error('insert failed'));

    await incrementQuota('session-inc');

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ feature: 'chat_quota_increment', sessionId: 'session-inc' }),
    );
    expect(checkQuotaSync('session-inc').messageCount).toBe(1);
  });
});
