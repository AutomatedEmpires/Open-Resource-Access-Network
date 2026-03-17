import { describe, expect, it } from 'vitest';

import { buildChatExecutionProposal } from '@/services/chat/executionCommands';

const services = [
  {
    serviceId: 'svc-1',
    serviceName: 'Food Pantry One',
    organizationName: 'Helping Hands',
    confidenceBand: 'HIGH' as const,
    confidenceScore: 92,
    eligibilityHint: 'You may qualify.',
  },
  {
    serviceId: 'svc-2',
    serviceName: 'Shelter Intake',
    organizationName: 'Safe Nights',
    confidenceBand: 'LIKELY' as const,
    confidenceScore: 75,
    eligibilityHint: 'You may qualify.',
  },
];

describe('chat execution commands', () => {
  it('builds a local add-to-plan proposal from an explicit ordinal reference', () => {
    const proposal = buildChatExecutionProposal(
      'add the first result to my plan tomorrow',
      services,
      new Date('2026-03-17T12:00:00.000Z'),
    );

    expect(proposal?.action).toBe('add_to_plan');
    expect(proposal?.service.serviceId).toBe('svc-1');
    expect(proposal?.targetDate).toBe('2026-03-18');
  });

  it('builds a local reminder proposal from an explicit ordinal reference', () => {
    const proposal = buildChatExecutionProposal(
      'remind me next week about the second result',
      services,
      new Date('2026-03-17T12:00:00.000Z'),
    );

    expect(proposal?.action).toBe('set_reminder');
    expect(proposal?.service.serviceId).toBe('svc-2');
    expect(proposal?.urgency).toBe('later');
    expect(proposal?.reminderAt).toBeTruthy();
  });
});
