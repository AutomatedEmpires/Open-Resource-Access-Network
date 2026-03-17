import { describe, expect, it } from 'vitest';

import type { EnrichedService } from '@/domain/types';
import { buildSeekerExecutionProgressSummary } from '@/services/plans/progress';

describe('seeker execution progress summary', () => {
  it('groups milestone progress and emits recent execution updates', () => {
    const summary = buildSeekerExecutionProgressSummary({
      id: 'plan-1',
      title: 'Current plan',
      status: 'active',
      createdAt: '2026-03-17T08:00:00.000Z',
      updatedAt: '2026-03-17T08:00:00.000Z',
      items: [
        {
          id: 'item-1',
          title: 'Call intake',
          status: 'todo',
          urgency: 'today',
          milestone: 'immediate_survival',
          source: 'manual',
          reminderAt: '2026-03-17T09:00:00.000Z',
          createdAt: '2026-03-17T08:00:00.000Z',
          updatedAt: '2026-03-17T08:00:00.000Z',
        },
        {
          id: 'item-2',
          title: 'Submit benefits form',
          status: 'done',
          urgency: 'this_week',
          milestone: 'benefits',
          source: 'manual',
          completedAt: '2026-03-17T10:00:00.000Z',
          createdAt: '2026-03-17T08:00:00.000Z',
          updatedAt: '2026-03-17T10:00:00.000Z',
        },
      ],
    }, [], new Date('2026-03-17T12:00:00.000Z'));

    expect(summary.milestones).toHaveLength(2);
    expect(summary.activeMilestone?.milestone).toBe('immediate_survival');
    expect(summary.recentUpdates.some((update) => update.kind === 'reminder_due')).toBe(true);
    expect(summary.recentUpdates.some((update) => update.kind === 'milestone_reached')).toBe(true);
  });

  it('emits service change updates when current live records degrade', () => {
    const currentServices: EnrichedService[] = [{
      service: {
        id: 'svc-1',
        organizationId: 'org-1',
        name: 'Pantry',
        status: 'active',
        capacityStatus: 'closed',
        updatedAt: new Date('2026-03-17T11:00:00.000Z'),
        createdAt: new Date('2026-03-17T08:00:00.000Z'),
      },
      organization: {
        id: 'org-1',
        name: 'Helping Hands',
        status: 'active',
        updatedAt: new Date('2026-03-17T08:00:00.000Z'),
        createdAt: new Date('2026-03-17T08:00:00.000Z'),
      },
      phones: [],
      schedules: [],
      taxonomyTerms: [],
    }];

    const summary = buildSeekerExecutionProgressSummary({
      id: 'plan-1',
      title: 'Current plan',
      status: 'active',
      createdAt: '2026-03-17T08:00:00.000Z',
      updatedAt: '2026-03-17T08:00:00.000Z',
      items: [
        {
          id: 'item-1',
          title: 'Visit pantry',
          status: 'todo',
          urgency: 'today',
          source: 'saved_service',
          linkedService: {
            serviceId: 'svc-1',
            serviceName: 'Pantry',
            organizationName: 'Helping Hands',
            capturedAt: '2026-03-17T08:00:00.000Z',
          },
          createdAt: '2026-03-17T08:00:00.000Z',
          updatedAt: '2026-03-17T08:00:00.000Z',
        },
      ],
    }, currentServices, new Date('2026-03-17T12:00:00.000Z'));

    expect(summary.recentUpdates.some((update) => update.kind === 'service_change')).toBe(true);
  });
});
