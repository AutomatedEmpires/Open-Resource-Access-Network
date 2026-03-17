import { describe, expect, it } from 'vitest';

import type { SeekerPlanItem } from '@/domain/execution';
import type { EnrichedService } from '@/domain/types';
import { buildSeekerPlanFeasibilitySignals } from '@/services/plans/feasibility';

function buildService(overrides: Partial<EnrichedService>): EnrichedService {
  return {
    service: {
      id: 'svc-1',
      organizationId: 'org-1',
      name: 'North Pantry',
      status: 'active',
      createdAt: new Date('2026-03-17T08:00:00.000Z'),
      updatedAt: new Date('2026-03-17T08:00:00.000Z'),
      capacityStatus: 'available',
    },
    organization: {
      id: 'org-1',
      name: 'North Mutual Aid',
      status: 'active',
      createdAt: new Date('2026-03-17T08:00:00.000Z'),
      updatedAt: new Date('2026-03-17T08:00:00.000Z'),
    },
    location: {
      id: 'loc-1',
      organizationId: 'org-1',
      status: 'active',
      latitude: 33.4484,
      longitude: -112.074,
      createdAt: new Date('2026-03-17T08:00:00.000Z'),
      updatedAt: new Date('2026-03-17T08:00:00.000Z'),
    },
    address: {
      id: 'addr-1',
      locationId: 'loc-1',
      address1: '100 Main St',
      city: 'Phoenix',
      stateProvince: 'AZ',
      postalCode: '85001',
      createdAt: new Date('2026-03-17T08:00:00.000Z'),
      updatedAt: new Date('2026-03-17T08:00:00.000Z'),
    },
    phones: [],
    schedules: [
      {
        id: 'sched-1',
        serviceId: 'svc-1',
        days: ['MO', 'TU', 'WE', 'TH', 'FR'],
        opensAt: '08:00',
        closesAt: '13:00',
        createdAt: new Date('2026-03-17T08:00:00.000Z'),
        updatedAt: new Date('2026-03-17T08:00:00.000Z'),
      },
    ],
    taxonomyTerms: [],
    ...overrides,
  } as EnrichedService;
}

describe('seeker plan feasibility signals', () => {
  it('returns conservative feasibility signals when hours and location are usable', () => {
    const items = [
      {
        id: 'item-1',
        title: 'Visit pantry',
        status: 'todo',
        urgency: 'today',
        source: 'saved_service',
        linkedService: {
          serviceId: 'svc-1',
          serviceName: 'North Pantry',
          organizationName: 'North Mutual Aid',
          capturedAt: '2026-03-17T08:00:00.000Z',
        },
        createdAt: '2026-03-17T08:00:00.000Z',
        updatedAt: '2026-03-17T08:00:00.000Z',
      },
    ] as SeekerPlanItem[];

    const signals = buildSeekerPlanFeasibilitySignals(
      items,
      [buildService({})],
      new Date('2026-03-17T11:30:00.000Z'),
    );

    expect(signals.some((signal) => signal.title.includes('closes soon'))).toBe(true);
    expect(signals.some((signal) => signal.title.includes('good first stop today'))).toBe(true);
  });

  it('degrades to call-ahead guidance when current hours or location are missing', () => {
    const items = [
      {
        id: 'item-1',
        title: 'Call shelter intake',
        status: 'todo',
        urgency: 'this_week',
        source: 'manual',
        linkedService: {
          serviceId: 'svc-1',
          serviceName: 'Shelter Intake',
          organizationName: 'North Mutual Aid',
          capturedAt: '2026-03-17T08:00:00.000Z',
        },
        createdAt: '2026-03-17T08:00:00.000Z',
        updatedAt: '2026-03-17T08:00:00.000Z',
      },
    ] as SeekerPlanItem[];

    const service = buildService({
      location: null,
      address: null,
      schedules: [],
    });

    const signals = buildSeekerPlanFeasibilitySignals(items, [service], new Date('2026-03-17T11:30:00.000Z'));

    expect(signals).toHaveLength(1);
    expect(signals[0]?.title).toContain('call ahead before you go');
  });
});
