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
    expect(card.eligibilityHint).toBe(
      'This record does not list who may qualify. Confirm current requirements with the provider.',
    );
  });

  it('builds next-step, coverage, eligibility, document, distance, and verification details from stored fields', () => {
    const card = enrichedServiceToCard(makeEnrichedService({
      service: {
        id: 'svc-intake',
        organizationId: 'org-1',
        name: 'Utility Relief Intake',
        description: 'Utility payment support.',
        applicationProcess: 'Call before 3 p.m. to complete intake.',
        status: 'active',
        url: 'https://example.org/utility-intake',
        updatedAt: new Date(),
        createdAt: new Date(),
      },
      organization: {
        id: 'org-1',
        name: 'Helping Org',
        status: 'active',
        verifiedAt: '2026-02-20T12:00:00.000Z',
        updatedAt: new Date(),
        createdAt: new Date(),
      },
      eligibility: [{
        id: 'elig-1',
        serviceId: 'svc-intake',
        description: 'Residents of Kootenai County may apply.',
        updatedAt: new Date(),
        createdAt: new Date(),
      }],
      requiredDocuments: [{
        id: 'doc-1',
        serviceId: 'svc-intake',
        document: 'Current utility bill',
        updatedAt: new Date(),
        createdAt: new Date(),
      }],
      serviceAreas: [{
        id: 'area-1',
        serviceId: 'svc-intake',
        name: 'Kootenai County',
        extentType: 'county',
        updatedAt: new Date(),
        createdAt: new Date(),
      }],
      distanceMeters: 1609.344,
    }));

    expect(card).toMatchObject({
      distanceMeters: 1609.344,
      serviceAreaSummary: 'Kootenai County',
      requiredDocuments: ['Current utility bill'],
      nextStep: 'Call before 3 p.m. to complete intake.',
      // Org-level verified_at only supports source verification, never a
      // provider-verified claim about the service record itself.
      verificationStatus: 'source_verified',
      verificationLastCheckedAt: '2026-02-20T12:00:00.000Z',
      sourceLabel: 'Helping Org provider page',
      sourceUrl: 'https://example.org/utility-intake',
    });
    expect(card.eligibilityHint).toContain('Residents of Kootenai County may apply.');
    expect(card.whatToAsk).toContain('Utility Relief Intake');
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

  it('explains guided urgency and audience ranking with stored service attributes only', () => {
    const card = enrichedServiceToCard(
      makeEnrichedService({
        attributes: [
          { id: 'attr-guided-1', serviceId: 'svc-1', taxonomy: 'access', tag: 'same_day', createdAt: new Date(), updatedAt: new Date() },
          { id: 'attr-guided-2', serviceId: 'svc-1', taxonomy: 'culture', tag: 'youth_focused', createdAt: new Date(), updatedAt: new Date() },
        ],
      }),
      {
        context: {
          sessionId: '00000000-0000-4000-8000-000000000126',
          locale: 'en',
          messageCount: 1,
          sessionContext: {
            urgency: 'urgent',
            urgencyWindow: 'today',
            audience: 'child',
            preferredDeliveryModes: [],
            profileShapingEnabled: true,
          },
        },
      },
    );

    expect(card.matchReasons).toEqual([
      'Marked for same-day help',
      'Offers youth-focused services',
    ]);
  });

  it('does not resurrect a saved delivery reason after can-travel clears it', () => {
    const card = enrichedServiceToCard(
      makeEnrichedService({
        attributes: [
          { id: 'attr-phone', serviceId: 'svc-1', taxonomy: 'delivery', tag: 'phone', createdAt: new Date(), updatedAt: new Date() },
        ],
      }),
      {
        context: {
          sessionId: '00000000-0000-4000-8000-000000000131',
          locale: 'en',
          messageCount: 2,
          userProfile: {
            userId: 'user-1',
            browsePreference: { attributeFilters: { delivery: ['phone'] } },
          },
          sessionContext: {
            preferredDeliveryModes: [],
            profileShapingEnabled: true,
          },
        },
      },
    );

    expect(card.matchReasons).toBeUndefined();
  });
});
