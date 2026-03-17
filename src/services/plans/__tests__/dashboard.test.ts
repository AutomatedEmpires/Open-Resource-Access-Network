import { describe, expect, it } from 'vitest';

import type { SeekerPlansState } from '@/domain/execution';
import { buildSeekerExecutionDashboardSummary } from '@/services/plans/dashboard';

describe('seeker execution dashboard summary', () => {
  it('prioritizes overdue reminders and reports execution counts from the active plan', () => {
    const state: SeekerPlansState = {
      activePlanId: 'plan-1',
      plans: [
        {
          id: 'plan-1',
          title: 'Stabilize this week',
          status: 'active',
          createdAt: '2026-03-17T08:00:00.000Z',
          updatedAt: '2026-03-17T08:00:00.000Z',
          items: [
            {
              id: 'item-overdue',
              title: 'Call the pantry before noon',
              status: 'todo',
              urgency: 'today',
              source: 'saved_service',
              reminderAt: '2026-03-17T09:00:00.000Z',
              linkedService: {
                serviceId: 'svc-1',
                serviceName: 'North Pantry',
                organizationName: 'North Mutual Aid',
                capturedAt: '2026-03-17T08:00:00.000Z',
              },
              createdAt: '2026-03-17T08:00:00.000Z',
              updatedAt: '2026-03-17T08:00:00.000Z',
            },
            {
              id: 'item-upcoming',
              title: 'Bring ID to shelter intake',
              status: 'todo',
              urgency: 'this_week',
              reminderAt: '2026-03-18T15:00:00.000Z',
              targetDate: '2026-03-18',
              source: 'manual',
              createdAt: '2026-03-17T08:30:00.000Z',
              updatedAt: '2026-03-17T08:30:00.000Z',
            },
            {
              id: 'item-done',
              title: 'Save backup legal aid option',
              status: 'done',
              urgency: 'backup',
              source: 'chat_service',
              createdAt: '2026-03-17T07:00:00.000Z',
              updatedAt: '2026-03-17T07:30:00.000Z',
              completedAt: '2026-03-17T07:30:00.000Z',
            },
          ],
        },
      ],
    };

    const summary = buildSeekerExecutionDashboardSummary(state, new Date('2026-03-17T12:00:00.000Z'));

    expect(summary.activePlan?.title).toBe('Stabilize this week');
    expect(summary.openItems).toHaveLength(2);
    expect(summary.completedItems).toHaveLength(1);
    expect(summary.overdueReminderCount).toBe(1);
    expect(summary.dueTodayCount).toBe(1);
    expect(summary.linkedServiceCount).toBe(1);
    expect(summary.completionRate).toBe(33);
    expect(summary.nextActions[0]?.id).toBe('item-overdue');
    expect(summary.upcomingReminders[0]?.id).toBe('item-upcoming');
  });
});
