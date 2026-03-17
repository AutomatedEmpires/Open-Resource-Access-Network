import { describe, expect, it } from 'vitest';

import { buildSeekerGroundedPlanBrief } from '@/services/plans/summary';

describe('seeker grounded plan brief', () => {
  it('returns null when there is no active plan', () => {
    expect(buildSeekerGroundedPlanBrief(null)).toBeNull();
  });

  it('summarizes the top open action and surfaces service cautions from current records', () => {
    const brief = buildSeekerGroundedPlanBrief(
      {
        id: 'plan-1',
        title: 'Current plan',
        status: 'active',
        objective: 'Keep the next actions visible',
        createdAt: '2026-03-17T08:00:00.000Z',
        updatedAt: '2026-03-17T08:00:00.000Z',
        items: [
          {
            id: 'item-1',
            title: 'Call pantry intake',
            status: 'todo',
            urgency: 'today',
            source: 'saved_service',
            milestone: 'immediate_survival',
            reminderAt: '2026-03-17T09:00:00.000Z',
            linkedService: {
              serviceId: 'service-1',
              serviceName: 'Helping Hands Pantry',
              organizationName: 'Helping Hands',
              capturedAt: '2026-03-17T08:00:00.000Z',
            },
            createdAt: '2026-03-17T08:00:00.000Z',
            updatedAt: '2026-03-17T08:00:00.000Z',
          },
        ],
      },
      [{
        service: {
          id: 'service-1',
          organizationId: 'org-1',
          name: 'Helping Hands Pantry',
          status: 'active',
          capacityStatus: 'waitlist',
          updatedAt: new Date('2026-03-17T11:30:00.000Z'),
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
      }],
      new Date('2026-03-17T12:00:00.000Z'),
    );

    expect(brief?.headline).toBe('Start with Call pantry intake');
    expect(brief?.summary).toContain('Immediate survival');
    expect(brief?.checklist[0]).toContain('Call pantry intake');
    expect(brief?.caution).toContain('waitlist');
  });
});
