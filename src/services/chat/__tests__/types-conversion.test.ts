import { describe, expect, it } from 'vitest';

import type { EnrichedService } from '@/domain/types';
import {
  ChatMessageSchema,
  ChatRequestSchema,
  IntentSchema,
  enrichedServiceToCard,
} from '@/services/chat/types';

function makeEnrichedService(overrides: Partial<EnrichedService> = {}): EnrichedService {
  const now = new Date('2026-03-01T00:00:00.000Z');
  return {
    service: {
      id: 'svc-1',
      organizationId: 'org-1',
      name: 'Support Center',
      description: 'Multi-service support',
      status: 'active',
      url: '',
      updatedAt: now,
      createdAt: now,
      ...(overrides.service ?? {}),
    },
    organization: {
      id: 'org-1',
      name: 'Helping Org',
      status: 'active',
      url: '',
      updatedAt: now,
      createdAt: now,
      ...(overrides.organization ?? {}),
    },
    address: {
      id: 'addr-1',
      locationId: 'loc-1',
      address1: '100 Main St',
      city: 'Austin',
      stateProvince: 'TX',
      postalCode: '78701',
      updatedAt: now,
      createdAt: now,
      ...(overrides.address ?? {}),
    },
    phones: [
      {
        id: 'phone-1',
        serviceId: 'svc-1',
        number: '512-555-0000',
        type: 'voice',
        updatedAt: now,
        createdAt: now,
      },
    ],
    schedules: [
      {
        id: 'sched-1',
        serviceId: 'svc-1',
        description: 'Mon-Fri 9-5',
        updatedAt: now,
        createdAt: now,
      },
    ],
    taxonomyTerms: [],
    confidenceScore: null,
    ...overrides,
  };
}

describe('chat types + conversion', () => {
  it('applies schema defaults for intent, message timestamp, and request locale', () => {
    const intent = IntentSchema.parse({
      category: 'housing',
      rawQuery: 'Need rent help',
    });
    expect(intent.urgencyQualifier).toBe('standard');

    const message = ChatMessageSchema.parse({
      role: 'assistant',
      content: 'Hello',
    });
    expect(message.timestamp).toBeInstanceOf(Date);

    const request = ChatRequestSchema.parse({
      message: 'Find a pantry',
      sessionId: '00000000-0000-4000-8000-000000000123',
    });
    expect(request.locale).toBe('en');
  });

  it('converts enriched services to cards with HIGH/LIKELY/POSSIBLE confidence bands', () => {
    const high = enrichedServiceToCard(
      makeEnrichedService({
        confidenceScore: {
          id: 'score-high',
          serviceId: 'svc-1',
          score: 95,
          verificationConfidence: 90,
          eligibilityMatch: 80,
          constraintFit: 75,
          computedAt: new Date(),
          updatedAt: new Date(),
          createdAt: new Date(),
        },
      }),
    );
    expect(high.confidenceBand).toBe('HIGH');
    expect(high.confidenceScore).toBe(90);

    const likely = enrichedServiceToCard(
      makeEnrichedService({
        confidenceScore: {
          id: 'score-likely',
          serviceId: 'svc-1',
          score: 70,
          verificationConfidence: 65,
          eligibilityMatch: 60,
          constraintFit: 55,
          computedAt: new Date(),
          updatedAt: new Date(),
          createdAt: new Date(),
        },
      }),
    );
    expect(likely.confidenceBand).toBe('LIKELY');
    expect(likely.confidenceScore).toBe(65);

    const possible = enrichedServiceToCard(makeEnrichedService());
    expect(possible.confidenceBand).toBe('POSSIBLE');
    expect(possible.confidenceScore).toBe(0);
  });

  it('formats address and optional card fields, and omits links when none are available', () => {
    const card = enrichedServiceToCard(
      makeEnrichedService({
        service: {
          id: 'svc-no-links',
          organizationId: 'org-1',
          name: 'No Links Service',
          description: null,
          status: 'active',
          url: 'mailto:invalid@example.org',
          updatedAt: new Date(),
          createdAt: new Date(),
        },
        organization: {
          id: 'org-1',
          name: 'No Links Org',
          status: 'active',
          url: 'ftp://example.org',
          updatedAt: new Date(),
          createdAt: new Date(),
        },
      }),
      {
        intent: {
          category: 'housing',
          rawQuery: 'Need housing',
          actionQualifier: 'apply',
          urgencyQualifier: 'standard',
        },
        context: {
          sessionId: '00000000-0000-4000-8000-000000000124',
          locale: 'es',
          messageCount: 1,
          userProfile: { userId: 'user-1', audienceTags: ['veteran'] },
        },
      },
    );

    expect(card.address).toBe('100 Main St, Austin, TX, 78701');
    expect(card.phone).toBe('512-555-0000');
    expect(card.scheduleDescription).toBe('Mon-Fri 9-5');
    expect(card.description).toBeUndefined();
    expect(card.links).toBeUndefined();
    expect(card.eligibilityHint.toLowerCase()).toContain('may qualify');
  });

  it('derives deterministic match reasons from browse filters, taxonomy, and action intent', () => {
    const card = enrichedServiceToCard(
      makeEnrichedService({
        taxonomyTerms: [
          { id: 'tax-1', term: 'Housing Navigation', createdAt: new Date(), updatedAt: new Date() },
        ],
        attributes: [
          { id: 'attr-1', serviceId: 'svc-1', taxonomy: 'delivery', tag: 'phone', createdAt: new Date(), updatedAt: new Date() },
          { id: 'attr-2', serviceId: 'svc-1', taxonomy: 'access', tag: 'no_id_required', createdAt: new Date(), updatedAt: new Date() },
          { id: 'attr-3', serviceId: 'svc-1', taxonomy: 'access', tag: 'same_day', createdAt: new Date(), updatedAt: new Date() },
        ],
        service: {
          id: 'svc-apply',
          organizationId: 'org-1',
          name: 'Rapid Housing Help',
          description: 'Fast-track housing support.',
          status: 'active',
          url: 'https://example.org/apply',
          updatedAt: new Date(),
          createdAt: new Date(),
        },
      }),
      {
        intent: {
          category: 'housing',
          rawQuery: 'Need housing help fast',
          actionQualifier: 'contact',
          urgencyQualifier: 'urgent',
        },
        context: {
          sessionId: '00000000-0000-4000-8000-000000000125',
          locale: 'en',
          messageCount: 1,
          userProfile: {
            userId: 'guest',
            serviceInterests: ['housing'],
            urgencyWindow: 'same_day',
            preferredDeliveryModes: ['phone'],
            documentationBarriers: ['no_id'],
            browsePreference: {
              attributeFilters: {
                delivery: ['phone'],
                access: ['same_day', 'no_id_required'],
              },
              taxonomyTermIds: ['tax-1'],
            },
          },
        },
      },
    );

    expect(card.matchReasons).toEqual([
      'Offers phone support',
      'Marked for same-day help',
      'Does not require ID',
      'Tagged with Housing Navigation',
    ]);
  });
});
