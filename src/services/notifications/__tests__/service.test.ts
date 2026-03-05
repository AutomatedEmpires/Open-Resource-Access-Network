import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);

import {
  broadcast,
  getPreferences,
  getUnread,
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
  send,
  setPreference,
  setPreferences,
} from '@/services/notifications/service';

const txQueryMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.executeQuery.mockResolvedValue([]);
  dbMocks.withTransaction.mockImplementation(async (fn: (client: { query: typeof txQueryMock }) => unknown) => {
    return fn({ query: txQueryMock });
  });
  txQueryMock.mockReset();
});

describe('notifications service', () => {
  it('send returns null when preference is disabled', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ enabled: false }]);

    const id = await send({
      recipientUserId: 'user-1',
      eventType: 'submission_status_changed',
      title: 'Status updated',
      body: 'Your submission moved to review',
    });

    expect(id).toBeNull();
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('send inserts notification when preference is enabled', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ enabled: true }])
      .mockResolvedValueOnce([{ id: 'n-1' }]);

    const id = await send({
      recipientUserId: 'user-2',
      eventType: 'submission_assigned',
      channel: 'email',
      title: 'Assigned',
      body: 'A submission was assigned to you',
      idempotencyKey: 'k-1',
    });

    expect(id).toBe('n-1');
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(2);
  });

  it('send returns null on idempotent conflict insert', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const id = await send({
      recipientUserId: 'user-3',
      eventType: 'system_alert',
      title: 'Alert',
      body: 'Heads up',
      idempotencyKey: 'already-sent',
    });

    expect(id).toBeNull();
  });

  it('broadcast returns number of actually sent notifications', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'n-1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ enabled: false }]);

    const sent = await broadcast(
      ['user-a', 'user-b', 'user-c'],
      'submission_sla_breach',
      'SLA Breach',
      'Overdue submission',
    );

    expect(sent).toBe(1);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(5);
  });

  it('getUnread returns unread rows with default limit', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'n-1' }]);

    const rows = await getUnread('user-4');

    expect(rows).toEqual([{ id: 'n-1' }]);
    expect(dbMocks.executeQuery).toHaveBeenCalledWith(expect.stringContaining('read_at IS NULL'), ['user-4', 50]);
  });

  it('listNotifications returns rows and parsed total count', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ id: 'n-1' }, { id: 'n-2' }])
      .mockResolvedValueOnce([{ count: '2' }]);

    const result = await listNotifications('user-5', 2, 10);

    expect(result.notifications).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('getUnreadCount parses integer count', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ count: '7' }]);

    const count = await getUnreadCount('user-6');

    expect(count).toBe(7);
  });

  it('markRead returns true when a row is updated', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'n-1' }]);

    await expect(markRead('n-1', 'user-7')).resolves.toBe(true);
  });

  it('markRead returns false when nothing is updated', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    await expect(markRead('n-missing', 'user-7')).resolves.toBe(false);
  });

  it('markAllRead returns number of updated rows', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    await expect(markAllRead('user-8')).resolves.toBe(3);
  });

  it('getPreferences returns stored preferences', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([
      { id: 'p-1', user_id: 'user-9', event_type: 'submission_status_changed', channel: 'in_app', enabled: true },
    ]);

    const prefs = await getPreferences('user-9');

    expect(prefs).toHaveLength(1);
  });

  it('setPreference upserts a single preference', async () => {
    await setPreference('user-10', 'submission_status_changed', 'in_app', false);

    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1);
    expect(dbMocks.executeQuery).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (user_id, event_type, channel) DO UPDATE'), [
      'user-10',
      'submission_status_changed',
      'in_app',
      false,
    ]);
  });

  it('setPreferences updates all preferences in one transaction', async () => {
    await setPreferences('user-11', [
      { eventType: 'submission_status_changed', channel: 'in_app', enabled: true },
      { eventType: 'submission_assigned', channel: 'email', enabled: false },
    ]);

    expect(dbMocks.withTransaction).toHaveBeenCalledTimes(1);
    expect(txQueryMock).toHaveBeenCalledTimes(2);
    expect(txQueryMock.mock.calls[0]?.[1]).toEqual([
      'user-11',
      'submission_status_changed',
      'in_app',
      true,
    ]);
    expect(txQueryMock.mock.calls[1]?.[1]).toEqual([
      'user-11',
      'submission_assigned',
      'email',
      false,
    ]);
  });
});
