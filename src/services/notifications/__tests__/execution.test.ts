import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/notifications/service', () => ({
  send: sendMock,
}));

import {
  notifySavedServiceChanged,
  notifySavedServiceMayBeStale,
  notifySeekerPlanMilestoneReached,
  notifySeekerReminderDue,
} from '@/services/notifications/execution';

describe('execution notification helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue('n-1');
  });

  it('sends a saved-service change notification', async () => {
    await notifySavedServiceChanged({ recipientUserId: 'user-1', serviceId: 'svc-1', serviceName: 'Pantry' });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'saved_service_changed',
      actionUrl: '/service/svc-1',
    }));
  });

  it('sends reminder and milestone notifications', async () => {
    await notifySeekerReminderDue({ recipientUserId: 'user-1', planId: 'plan-1', itemId: 'item-1', title: 'Call intake' });
    await notifySeekerPlanMilestoneReached({ recipientUserId: 'user-1', planId: 'plan-1', milestoneLabel: 'Stabilization' });

    expect(sendMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      eventType: 'seeker_reminder_due',
      resourceType: 'plan_item',
      actionUrl: '/plan',
    }));
    expect(sendMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      eventType: 'seeker_plan_milestone_reached',
      actionUrl: '/plan/dashboard',
    }));
  });

  it('sends a stale-service warning notification', async () => {
    await notifySavedServiceMayBeStale({ recipientUserId: 'user-1', serviceId: 'svc-2', serviceName: 'Shelter' });

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'saved_service_may_be_stale',
      actionUrl: '/service/svc-2',
    }));
  });
});
