import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkQuotaByIdentity,
  finalizeChatRequest,
  reserveChatRequest,
  resetSessionQuotasForTests,
} from '@/services/chat/quota';
import { CHAT_QUOTA_WINDOW_MS, RATE_LIMIT_WINDOW_MS } from '@/domain/constants';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';

vi.mock('@/services/db/postgres', () => ({
  executeQuery: vi.fn(),
  isDatabaseConfigured: vi.fn(),
}));

vi.mock('@/services/telemetry/sentry', () => ({
  captureException: vi.fn(),
}));

const executeQueryMock = vi.mocked(executeQuery);
const isDatabaseConfiguredMock = vi.mocked(isDatabaseConfigured);
const captureExceptionMock = vi.mocked(captureException);

function requestId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

describe('identity-aware chat usage controls', () => {
  let now = 1_800_000_000_000;

  beforeEach(() => {
    resetSessionQuotasForTests();
    isDatabaseConfiguredMock.mockReset();
    executeQueryMock.mockReset();
    captureExceptionMock.mockReset();
    isDatabaseConfiguredMock.mockReturnValue(false);
    now = 1_800_000_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function consume(options: {
    index: number;
    deviceId?: string;
    userId?: string;
    rateLimitKey?: string;
  }) {
    const reservation = await reserveChatRequest({
      requestId: requestId(options.index),
      deviceId: options.deviceId ?? 'device-a',
      userId: options.userId,
      rateLimitKey: options.rateLimitKey ?? '198.51.100.10',
    });
    expect(reservation.decision).toBe('allowed');
    return finalizeChatRequest(reservation, true);
  }

  it('allows exactly 10 successful anonymous messages in the trailing 24 hours', async () => {
    for (let index = 1; index <= 10; index += 1) {
      if (index === 7) now += RATE_LIMIT_WINDOW_MS + 1;
      const state = await consume({ index });
      expect(state.remaining).toBe(10 - index);
    }

    now += RATE_LIMIT_WINDOW_MS + 1;
    const blocked = await reserveChatRequest({
      requestId: requestId(11),
      deviceId: 'device-a',
      rateLimitKey: '198.51.100.10',
    });

    expect(blocked.decision).toBe('quota_exceeded');
    expect(blocked.quota).toMatchObject({ messageCount: 10, remaining: 0, exceeded: true });
  });

  it('allows 20 authenticated messages while enforcing the same device key', async () => {
    for (let index = 1; index <= 20; index += 1) {
      if (index > 1 && (index - 1) % 6 === 0) now += RATE_LIMIT_WINDOW_MS + 1;
      const state = await consume({
        index,
        deviceId: 'shared-device',
        userId: 'user-a',
        rateLimitKey: 'user-a',
      });
      expect(state.remaining).toBe(20 - index);
    }

    now += RATE_LIMIT_WINDOW_MS + 1;
    const accountRotationAttempt = await reserveChatRequest({
      requestId: requestId(21),
      deviceId: 'shared-device',
      userId: 'user-b',
      rateLimitKey: 'user-b',
    });

    expect(accountRotationAttempt.decision).toBe('quota_exceeded');
    expect(accountRotationAttempt.quota.messageCount).toBe(20);
  });

  it('releases an unchargeable response without decrementing remaining quota', async () => {
    const reservation = await reserveChatRequest({
      requestId: requestId(1),
      deviceId: 'device-release',
      rateLimitKey: '198.51.100.11',
    });
    expect(reservation.quota.remaining).toBe(9);

    const released = await finalizeChatRequest(reservation, false);

    expect(released).toMatchObject({ messageCount: 0, remaining: 10, exceeded: false });
  });

  it('limits a caller to six requests per minute even when none consume daily quota', async () => {
    for (let index = 1; index <= 6; index += 1) {
      const reservation = await reserveChatRequest({
        requestId: requestId(index),
        deviceId: 'rate-device',
        rateLimitKey: '203.0.113.20',
      });
      expect(reservation.decision).toBe('allowed');
      await finalizeChatRequest(reservation, false);
    }

    const seventh = await reserveChatRequest({
      requestId: requestId(7),
      deviceId: 'rate-device',
      rateLimitKey: '203.0.113.20',
    });
    expect(seventh.decision).toBe('rate_limited');
    expect(seventh.retryAfterSeconds).toBe(60);

    now += RATE_LIMIT_WINDOW_MS + 1;
    const afterReset = await reserveChatRequest({
      requestId: requestId(8),
      deviceId: 'rate-device',
      rateLimitKey: '203.0.113.20',
    });
    expect(afterReset.decision).toBe('allowed');
  });

  it('permits only one in-flight request across an authenticated account and device', async () => {
    const first = await reserveChatRequest({
      requestId: requestId(1),
      deviceId: 'inflight-device',
      userId: 'inflight-user',
      rateLimitKey: 'inflight-user',
    });
    const overlapping = await reserveChatRequest({
      requestId: requestId(2),
      deviceId: 'inflight-device',
      userId: 'inflight-user',
      rateLimitKey: 'inflight-user',
    });

    expect(first.decision).toBe('allowed');
    expect(overlapping.decision).toBe('in_flight');

    await finalizeChatRequest(first, false);
    const afterRelease = await reserveChatRequest({
      requestId: requestId(3),
      deviceId: 'inflight-device',
      userId: 'inflight-user',
      rateLimitKey: 'inflight-user',
    });
    expect(afterRelease.decision).toBe('allowed');
  });

  it('cannot overshoot the final daily slot with concurrent reservations', async () => {
    for (let index = 1; index <= 9; index += 1) {
      await consume({ index, rateLimitKey: `setup-${index}` });
    }

    const [left, right] = await Promise.all([
      reserveChatRequest({
        requestId: requestId(10),
        deviceId: 'device-a',
        rateLimitKey: 'concurrent-left',
      }),
      reserveChatRequest({
        requestId: requestId(11),
        deviceId: 'device-a',
        rateLimitKey: 'concurrent-right',
      }),
    ]);

    expect([left.decision, right.decision].sort()).toEqual(['allowed', 'in_flight']);
    const allowed = left.decision === 'allowed' ? left : right;
    await finalizeChatRequest(allowed, true);

    const state = await checkQuotaByIdentity('device-a', undefined);
    expect(state).toMatchObject({ messageCount: 10, remaining: 0, exceeded: true });
  });

  it('expires consumed usage on a true trailing-24-hour basis', async () => {
    await consume({ index: 1 });
    now += CHAT_QUOTA_WINDOW_MS - 1;
    expect((await checkQuotaByIdentity('device-a', undefined)).messageCount).toBe(1);

    now += 2;
    expect(await checkQuotaByIdentity('device-a', undefined)).toMatchObject({
      messageCount: 0,
      remaining: 10,
      exceeded: false,
    });
  });

  it('uses opaque keys and the atomic Postgres function when configured', async () => {
    isDatabaseConfiguredMock.mockReturnValue(true);
    executeQueryMock
      .mockResolvedValueOnce([{
        decision: 'allowed',
        quota_remaining: 19,
        quota_reset_at: '2027-01-16T08:05:00.000Z',
        message_count: 1,
        retry_after_seconds: 60,
        rate_count: 1,
        rate_reset_at: '2027-01-15T08:01:00.000Z',
      }])
      .mockResolvedValueOnce([{ finalize_chat_request: 2 }])
      .mockResolvedValueOnce([{
        quota_remaining: 19,
        quota_reset_at: '2027-01-16T08:00:00.000Z',
        message_count: 1,
      }]);

    const reservation = await reserveChatRequest({
      requestId: requestId(1),
      deviceId: 'raw-device-id',
      userId: 'raw-user-id',
      rateLimitKey: '203.0.113.44',
    });
    const [, parameters] = executeQueryMock.mock.calls[0];

    expect(executeQueryMock.mock.calls[0][0]).toContain('oran_internal.reserve_chat_request');
    expect(parameters?.[1]).toMatch(/^device:[a-f0-9]{64}$/);
    expect(parameters?.[2]).toMatch(/^user:[a-f0-9]{64}$/);
    expect(parameters?.[3]).toMatch(/^rate:[a-f0-9]{64}$/);
    expect(JSON.stringify(parameters)).not.toContain('raw-device-id');
    expect(JSON.stringify(parameters)).not.toContain('raw-user-id');
    expect(reservation).toMatchObject({ decision: 'allowed', backend: 'database' });

    const finalized = await finalizeChatRequest(reservation, true);
    expect(executeQueryMock.mock.calls[1][0]).toContain('finalize_chat_request');
    expect(finalized).toMatchObject({ messageCount: 1, remaining: 19, exceeded: false });
  });

  it('fails closed without mutating process-local quota when configured Postgres fails', async () => {
    isDatabaseConfiguredMock.mockReturnValue(true);
    executeQueryMock.mockRejectedValueOnce(new Error('database unavailable'));

    const reservation = await reserveChatRequest({
      requestId: requestId(1),
      deviceId: 'fallback-device',
      rateLimitKey: '192.0.2.30',
    });

    expect(reservation).toMatchObject({
      decision: 'unavailable',
      backend: 'database',
      retryAfterSeconds: 30,
    });
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ feature: 'chat_usage_reserve' }),
    );

    isDatabaseConfiguredMock.mockReturnValue(false);
    await expect(checkQuotaByIdentity('fallback-device', undefined)).resolves.toMatchObject({
      messageCount: 0,
      remaining: 10,
      exceeded: false,
    });
  });

  it('surfaces a configured database finalize failure for a successful response', async () => {
    isDatabaseConfiguredMock.mockReturnValue(true);
    executeQueryMock
      .mockResolvedValueOnce([{
        decision: 'allowed',
        quota_remaining: 9,
        quota_reset_at: '2027-01-16T08:05:00.000Z',
        message_count: 1,
        retry_after_seconds: 60,
        rate_count: 1,
        rate_reset_at: '2027-01-15T08:01:00.000Z',
      }])
      .mockRejectedValueOnce(new Error('finalize database unavailable'));

    const reservation = await reserveChatRequest({
      requestId: requestId(1),
      deviceId: 'finalize-device',
      rateLimitKey: '192.0.2.31',
    });

    await expect(finalizeChatRequest(reservation, true)).rejects.toThrow(
      'Unable to finalize successful chat usage',
    );
    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        feature: 'chat_usage_finalize',
        extra: expect.objectContaining({ consume: true }),
      }),
    );
  });

  it('mirrors a database quota denial so an immediate outage cannot reopen usage', async () => {
    isDatabaseConfiguredMock.mockReturnValue(true);
    executeQueryMock.mockResolvedValueOnce([{
      decision: 'quota_exceeded',
      quota_remaining: 0,
      quota_reset_at: '2027-01-16T08:00:00.000Z',
      message_count: 10,
      retry_after_seconds: 3600,
      rate_count: 1,
      rate_reset_at: '2027-01-15T08:01:00.000Z',
    }]);

    const databaseDenial = await reserveChatRequest({
      requestId: requestId(1),
      deviceId: 'failover-device',
      rateLimitKey: '192.0.2.40',
    });
    expect(databaseDenial.decision).toBe('quota_exceeded');

    isDatabaseConfiguredMock.mockReturnValue(false);
    const fallbackDecision = await reserveChatRequest({
      requestId: requestId(2),
      deviceId: 'failover-device',
      rateLimitKey: '192.0.2.40',
    });
    expect(fallbackDecision.decision).toBe('quota_exceeded');
  });
});
