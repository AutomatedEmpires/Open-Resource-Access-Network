// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  addManualPlanItem,
  addServicePlanItem,
  createSeekerPlan,
  deleteSeekerPlanItem,
  readStoredSeekerPlansState,
  SEEKER_PLANS_STORAGE_KEY,
  toggleSeekerPlanItemComplete,
  updateSeekerPlanItem,
} from '@/services/plans/client';

describe('seeker plan local storage client', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('creates a local-first plan and persists manual items', () => {
    const created = createSeekerPlan('Current plan', 'Stabilize housing and food this week');
    expect(created.plan?.title).toBe('Current plan');

    const added = addManualPlanItem(created.plan!.id, {
      title: 'Call provider intake',
      note: 'Ask about same-day availability',
      urgency: 'today',
    });

    expect(added.item?.title).toBe('Call provider intake');

    const stored = readStoredSeekerPlansState();
    expect(stored.plans).toHaveLength(1);
    expect(stored.plans[0]?.items).toHaveLength(1);
    expect(window.localStorage.getItem(SEEKER_PLANS_STORAGE_KEY)).toContain('Call provider intake');
  });

  it('deduplicates active linked-service items by service id within the same plan', () => {
    const created = createSeekerPlan('Current plan');

    const first = addServicePlanItem(created.plan!.id, {
      serviceId: 'svc-1',
      serviceName: 'Helping Hands Pantry',
      organizationName: 'Helping Hands',
      detailHref: '/service/svc-1',
      address: '123 Main St',
      trustBand: 'HIGH',
      capturedAt: new Date().toISOString(),
    });
    const second = addServicePlanItem(created.plan!.id, {
      serviceId: 'svc-1',
      serviceName: 'Helping Hands Pantry',
      organizationName: 'Helping Hands',
      capturedAt: new Date().toISOString(),
    });

    expect(first.alreadyExists).toBe(false);
    expect(second.alreadyExists).toBe(true);

    const stored = readStoredSeekerPlansState();
    expect(stored.plans[0]?.items).toHaveLength(1);
  });

  it('toggles completion and deletes plan items cleanly', () => {
    const created = createSeekerPlan('Current plan');
    const added = addManualPlanItem(created.plan!.id, { title: 'Bring ID' });
    const itemId = added.item!.id;

    const completed = toggleSeekerPlanItemComplete(created.plan!.id, itemId);
    expect(completed.plans[0]?.items[0]?.status).toBe('done');
    expect(completed.plans[0]?.items[0]?.completedAt).toBeTruthy();

    const removed = deleteSeekerPlanItem(created.plan!.id, itemId);
    expect(removed.plans[0]?.items).toHaveLength(0);
  });

  it('updates structured plan item guidance fields without losing the linked record', () => {
    const created = createSeekerPlan('Current plan');
    const added = addServicePlanItem(created.plan!.id, {
      serviceId: 'svc-1',
      serviceName: 'Helping Hands Pantry',
      organizationName: 'Helping Hands',
      detailHref: '/service/svc-1',
      capturedAt: new Date().toISOString(),
    });

    const itemId = added.item!.id;
    const updated = updateSeekerPlanItem(created.plan!.id, itemId, {
      title: 'Call pantry intake',
      note: 'Confirm same-day availability',
      urgency: 'today',
      targetDate: '2026-03-18',
      reminderAt: '2026-03-18T14:30:00.000Z',
      whyItMatters: 'Need food support before the weekend',
      whatToAsk: 'Ask about hours and required ID',
      whatToBring: 'Photo ID and proof of address',
      fallback: 'Use the backup pantry saved nearby',
    });

    const item = updated.plans[0]?.items[0];
    expect(item?.title).toBe('Call pantry intake');
    expect(item?.note).toBe('Confirm same-day availability');
    expect(item?.urgency).toBe('today');
    expect(item?.targetDate).toBe('2026-03-18');
    expect(item?.reminderAt).toBe('2026-03-18T14:30:00.000Z');
    expect(item?.whyItMatters).toBe('Need food support before the weekend');
    expect(item?.whatToAsk).toBe('Ask about hours and required ID');
    expect(item?.whatToBring).toBe('Photo ID and proof of address');
    expect(item?.fallback).toBe('Use the backup pantry saved nearby');
    expect(item?.linkedService?.serviceId).toBe('svc-1');
  });
});
