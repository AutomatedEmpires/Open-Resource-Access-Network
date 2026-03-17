import { describe, expect, it } from 'vitest';

import { buildSeekerExecutionRecommendations } from '@/services/plans/recommendations';

describe('seeker execution recommendations', () => {
  it('prioritizes overdue reminders and service changes ahead of generic next steps', () => {
    const recommendations = buildSeekerExecutionRecommendations({
      summary: {
        planCount: 1,
        activePlan: null,
        openItems: [],
        completedItems: [],
        nextActions: [{
          id: 'item-1',
          title: 'Call pantry',
          status: 'todo',
          urgency: 'today',
          source: 'manual',
          createdAt: '2026-03-17T08:00:00.000Z',
          updatedAt: '2026-03-17T08:00:00.000Z',
        }],
        upcomingReminders: [],
        dueTodayCount: 1,
        overdueReminderCount: 1,
        linkedServiceCount: 0,
        completionRate: 0,
      },
      progress: {
        milestones: [],
        activeMilestone: null,
        recentUpdates: [{
          id: 'service-change',
          kind: 'service_change',
          title: 'Pantry may have changed availability',
          detail: 'Confirm current availability before you travel.',
          occurredAt: '2026-03-17T12:00:00.000Z',
        }],
      },
      feasibilitySignals: [],
    });

    expect(recommendations[0]?.id).toBe('overdue-reminder');
    expect(recommendations[1]?.id).toBe('service-change');
  });
});
