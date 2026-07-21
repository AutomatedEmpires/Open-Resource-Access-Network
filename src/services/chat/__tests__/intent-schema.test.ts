import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assembleCrisisResponse,
  assembleResponse,
  checkQuota,
  detectCrisis,
  detectIntent,
  incrementQuota,
  orchestrateChat,
  resetSessionQuotasForTests,
} from '../orchestrator';
import type { OrchestratorDeps } from '../orchestrator';
import {
  CRISIS_KEYWORDS,
  ELIGIBILITY_DISCLAIMER,
  FEATURE_FLAGS,
  MAX_CHAT_QUOTA,
} from '@/domain/constants';
import type { EnrichedService } from '@/domain/types';
import type { ChatSessionContext, Intent } from '../types';
import { resetRateLimitsForTests } from '@/services/security/rateLimit';

const originalDatabaseUrl = process.env.DATABASE_URL;

const baseIntent: Intent = {
  category: 'food_assistance',
  rawQuery: 'I need food',
  urgencyQualifier: 'standard',
};

const mockContext = {
  sessionId: '00000000-0000-0000-0000-000000000001',
  userId: undefined,
  locale: 'en',
  messageCount: 0,
};

function makeMockService(
  id: string,
  options?: {
    organizationId?: string;
    organizationName?: string;
    verificationConfidence?: number;
    attributes?: Array<{ taxonomy: string; tag: string }>;
  },
): EnrichedService {
  const now = new Date();
  const organizationId = options?.organizationId ?? 'org-1';

  return {
    service: {
      id,
      organizationId,
      name: 'Test Food Bank',
      description: 'Provides emergency food assistance.',
      status: 'active',
      updatedAt: now,
      createdAt: now,
    },
    organization: {
      id: organizationId,
      name: options?.organizationName ?? `Organization ${organizationId}`,
      status: 'active',
      updatedAt: now,
      createdAt: now,
    },
    phones: [
      {
        id: 'ph-1',
        number: '555-000-0001',
        type: 'voice',
        createdAt: now,
        updatedAt: now,
      },
    ],
    schedules: [],
    taxonomyTerms: [],
    attributes: options?.attributes?.map((attribute, index) => ({
      id: `attr-${id}-${index}`,
      serviceId: id,
      taxonomy: attribute.taxonomy as never,
      tag: attribute.tag,
      createdAt: now,
      updatedAt: now,
    })),
    confidenceScore: {
      id: 'cs-1',
      serviceId: id,
      score: 80,
      verificationConfidence: options?.verificationConfidence ?? 85,
      eligibilityMatch: 75,
      constraintFit: 70,
      computedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  };
}

beforeEach(() => {
  delete process.env.DATABASE_URL;
  resetRateLimitsForTests();
  resetSessionQuotasForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
    return;
  }

  process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('chat orchestration primitives', () => {
  it('detects crisis keywords case-insensitively', () => {
    expect(detectCrisis('I am thinking about SUICIDE')).toBe(true);
    expect(detectCrisis('I can’t go on')).toBe(true);
    expect(detectCrisis('I don’t want to be here anymore')).toBe(true);
    expect(detectCrisis('I need food assistance today')).toBe(false);

    const detectedCount = CRISIS_KEYWORDS.filter((keyword) => detectCrisis(`I ${keyword}`)).length;
    expect(detectedCount / CRISIS_KEYWORDS.length).toBeGreaterThan(0.8);
  });

  it('detects category, urgency, and action intent from a message', () => {
    const intent = detectIntent('I need to apply for emergency food assistance right now');

    expect(intent.category).toBe('food_assistance');
    expect(intent.actionQualifier).toBe('apply');
    expect(intent.urgencyQualifier).toBe('urgent');
    expect(intent.rawQuery).toBe('I need to apply for emergency food assistance right now');
  });

  it('falls back to the general category for unmatched text', () => {
    expect(detectIntent('xyzabc')).toMatchObject({
      category: 'general',
      urgencyQualifier: 'standard',
    });
  });

  it('does not classify partial words in cities, household details, or document names as needs', () => {
    expect(detectIntent('I am in Billings').category).toBe('general');
    expect(detectIntent('This is for my household').category).toBe('general');
    expect(detectIntent('Help replacing a Social Security card').category).toBe('general');
  });

  it.each([
    ['experiencing homelessness', 'housing'],
    ['need shelters', 'housing'],
    ['need meals', 'food_assistance'],
    ['need lawyers', 'legal_aid'],
    ['help paying for electricity', 'utility_assistance'],
    ['help with utilities', 'utility_assistance'],
    ['I am unemployed', 'employment'],
    ['I need work', 'employment'],
    ['I need healthcare', 'healthcare'],
  ] as const)('keeps common inflected need language discoverable: %s', (message, category) => {
    expect(detectIntent(message).category).toBe(category);
  });

  it('uses urgency word boundaries and respects simple negation', () => {
    expect(detectIntent('I do not know where to find food').urgencyQualifier).toBe('standard');
    expect(detectIntent('This is not urgent food help').urgencyQualifier).toBe('standard');
    expect(detectIntent('This is not very urgent food help').urgencyQualifier).toBe('standard');
    expect(detectIntent('This is no longer urgent food help').urgencyQualifier).toBe('standard');
    expect(detectIntent('I need food right now').urgencyQualifier).toBe('urgent');
  });

  it('does not treat ordinary contact-link language as an employment need', () => {
    expect(detectIntent('Does this phone work?').category).toBe('general');
    expect(detectIntent('Does the website work?').category).toBe('general');
  });

  it('detects substance-use, domestic-violence, and education needs', () => {
    expect(detectIntent('I need help with addiction and want a detox program').category).toBe('substance_use');
    expect(detectIntent('my partner is abusive and I need a restraining order').category).toBe('domestic_violence');
    expect(detectIntent('where can I study for my ged near me').category).toBe('education');
  });

  it('never routes explicit crisis language through intent-only handling', () => {
    // Crisis detection runs before intent in the orchestrator; these messages
    // must trip the crisis gate regardless of any overlapping need keywords.
    expect(detectCrisis('I want to hurt myself after drinking')).toBe(true);
  });

  it('assembles responses with the disclaimer, capped cards, and qualifying language', () => {
    const response = assembleResponse(
      Array.from({ length: 8 }, (_, index) => makeMockService(`svc-${index}`)),
      baseIntent,
      mockContext,
    );

    expect(response.eligibilityDisclaimer).toBe(ELIGIBILITY_DISCLAIMER);
    expect(response.isCrisis).toBe(false);
    expect(response.llmSummarized).toBe(false);
    expect(response.services).toHaveLength(5);
    expect(response.services[0]?.eligibilityHint.toLowerCase()).toMatch(/may qualify|confirm|provider/);
  });

  it('plainly labels broader-category results after an exact catalog miss', () => {
    const response = assembleResponse(
      [makeMockService('svc-broader')],
      { ...baseIntent, rawQuery: 'food and housing help' },
      mockContext,
      { retrievalStatus: 'results', searchBroadened: true },
    );

    expect(response.searchBroadened).toBe(true);
    expect(response.message).toContain('could not find an exact catalog match');
    expect(response.message).toContain('broader food assistance service');
  });

  it('assembles crisis responses without consuming quota', () => {
    const response = assembleCrisisResponse(baseIntent, 'session-1');

    expect(response.isCrisis).toBe(true);
    expect(response.services).toHaveLength(0);
    expect(response.crisisResources?.emergency).toBe('911');
    expect(response.crisisResources?.crisisLine).toBe('988');
    expect(response.eligibilityDisclaimer).toBe(ELIGIBILITY_DISCLAIMER);
    expect(response.quotaRemaining).toBe(MAX_CHAT_QUOTA);
  });
});

describe('orchestrateChat', () => {
  it('short-circuits crisis messages before retrieval or LLM flags', async () => {
    const retrieveServices = vi.fn();
    const isFlagEnabled = vi.fn();

    const response = await orchestrateChat(
      'I want to kill myself',
      '00000000-0000-0000-0000-000000000095',
      undefined,
      'en',
      'chat:test:crisis',
      {
        retrieveServices,
        isFlagEnabled,
      },
    );

    expect(response.isCrisis).toBe(true);
    expect(retrieveServices).not.toHaveBeenCalled();
    expect(isFlagEnabled).not.toHaveBeenCalled();
  });

  it('uses LLM summarization only when enabled and services exist', async () => {
    const llmSpy = vi.fn().mockResolvedValue('Here are services that may help.');
    const retrieveServices: OrchestratorDeps['retrieveServices'] = async () => ({
      services: [makeMockService('svc-1')],
      retrievalStatus: 'results',
    });
    const deps: OrchestratorDeps = {
      retrieveServices,
      isFlagEnabled: async () => true,
      summarizeWithLLM: async (services, intent) => llmSpy(services, intent),
    };

    const response = await orchestrateChat(
      'I need food',
      '00000000-0000-0000-0000-000000000098',
      undefined,
      'en',
      'chat:test:llm',
      deps,
    );

    expect(llmSpy).toHaveBeenCalledOnce();
    expect(response.llmSummarized).toBe(true);
    expect(response.message).toBe('Here are services that may help.');
  });

  it('falls back to the assembled response if LLM summarization fails', async () => {
    const llmSpy = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    const retrieveServices: OrchestratorDeps['retrieveServices'] = async () => ({
      services: [makeMockService('svc-2')],
      retrievalStatus: 'results',
    });
    const deps: OrchestratorDeps = {
      retrieveServices,
      isFlagEnabled: async () => true,
      summarizeWithLLM: async (services, intent) => llmSpy(services, intent),
    };

    const response = await orchestrateChat(
      'I need food',
      '00000000-0000-0000-0000-000000000096',
      undefined,
      'en',
      'chat:test:llm-fallback',
      deps,
    );

    expect(llmSpy).toHaveBeenCalledOnce();
    expect(response.llmSummarized).toBe(false);
    expect(response.services).toHaveLength(1);
  });

  it('hydrates authenticated context before retrieval', async () => {
    const hydrateContext = vi.fn().mockResolvedValue({
      ...mockContext,
      userId: 'user-123',
      locale: 'es',
      approximateLocation: { city: 'Seattle' },
      userProfile: {
        userId: 'user-123',
        serviceInterests: ['housing'],
      },
    });
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });

    await orchestrateChat(
      'I need food help',
      '00000000-0000-0000-0000-000000000094',
      'user-123',
      'en',
      'chat:test:hydrate',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext,
      },
    );

    expect(hydrateContext).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: '00000000-0000-0000-0000-000000000094',
        userId: 'user-123',
        locale: 'en',
      })
    );
    expect(retrieveServices).toHaveBeenCalledWith(
      expect.objectContaining({ rawQuery: 'I need food help' }),
      expect.objectContaining({
        locale: 'es',
        approximateLocation: { city: 'Seattle' },
      })
    );
  });

  it('returns a clarification response for weak general queries before retrieval', async () => {
    const retrieveServices = vi.fn();

    const response = await orchestrateChat(
      'help',
      '00000000-0000-0000-0000-000000000093',
      undefined,
      'en',
      'chat:test:clarify',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
      },
    );

    expect(response.retrievalStatus).toBe('clarification_required');
    expect(response.clarification?.reason).toBe('weak_query');
    expect(retrieveServices).not.toHaveBeenCalled();
  });

  it('checks guided need text for weakness instead of optional transcript details', async () => {
    const retrieveServices = vi.fn();

    const response = await orchestrateChat(
      'Help. Near 48201. I need help today. I need help by phone.',
      '00000000-0000-0000-0000-000000000090',
      undefined,
      'en',
      'chat:test:guided-clarify',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({ ...context, retrievalText: 'help' }),
      },
    );

    expect(response.retrievalStatus).toBe('clarification_required');
    expect(response.clarification?.reason).toBe('weak_query');
    expect(retrieveServices).not.toHaveBeenCalled();
  });

  it('retrieves specific short guided needs that are outside the keyword taxonomy', async () => {
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });

    const response = await orchestrateChat(
      'Birth certificate.',
      '00000000-0000-4000-8000-000000000138',
      undefined,
      'en',
      'chat:test:guided-short-specific',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({ ...context, retrievalText: 'birth certificate' }),
      },
    );

    expect(response.retrievalStatus).toBe('no_match');
    expect(retrieveServices).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'general', rawQuery: 'Birth certificate.' }),
      expect.objectContaining({ retrievalText: 'birth certificate' }),
    );
  });

  it('classifies a guided need without letting location or household details choose the category', async () => {
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });
    const message = 'Therapy. Near Billings, MT. This is for my family or household.';

    const response = await orchestrateChat(
      message,
      '00000000-0000-4000-8000-000000000131',
      undefined,
      'en',
      'chat:test:guided-classification',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({ ...context, retrievalText: 'therapy' }),
      },
    );

    expect(retrieveServices).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'mental_health', rawQuery: message }),
      expect.objectContaining({ retrievalText: 'therapy' }),
    );
    expect(response.intent.category).toBe('mental_health');
  });

  it('does not replace an explicit guided need with a stale active need', async () => {
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });
    const retrievalText = 'Help replacing a Social Security card';

    const response = await orchestrateChat(
      `${retrievalText}. Near Tacoma, WA.`,
      '00000000-0000-4000-8000-000000000132',
      undefined,
      'en',
      'chat:test:guided-stale-need',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          retrievalText,
          sessionContext: {
            activeNeedId: 'housing',
            profileShapingEnabled: true,
          },
        }),
      },
    );

    expect(retrieveServices).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'general' }),
      expect.objectContaining({ retrievalText }),
    );
    expect(response.sessionContext?.activeNeedId).toBeUndefined();
    expect(response.sessionContext?.activeRetrievalText).toBe(retrievalText);

    await orchestrateChat(
      'Show me another option',
      '00000000-0000-4000-8000-000000000132',
      undefined,
      'en',
      'chat:test:guided-stale-need-follow-up',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          sessionContext: response.sessionContext,
        }),
      },
    );

    expect(retrieveServices).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ category: 'general' }),
      expect.objectContaining({ retrievalText }),
    );
  });

  it('keeps crisis routing on the full message even when retrieval text is benign', async () => {
    const retrieveServices = vi.fn();
    const hydrateContext = vi.fn(async (context) => ({ ...context, retrievalText: 'food help' }));

    const response = await orchestrateChat(
      'I am going to kill myself. I also need food help.',
      '00000000-0000-0000-0000-000000000089',
      undefined,
      'en',
      'chat:test:guided-crisis',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext,
      },
    );

    expect(response.isCrisis).toBe(true);
    expect(hydrateContext).not.toHaveBeenCalled();
    expect(retrieveServices).not.toHaveBeenCalled();
  });

  it('routes first-person distress through semantic safety when the safety flag is enabled', async () => {
    const retrieveServices = vi.fn();
    const checkSemanticCrisis = vi.fn().mockResolvedValue(true);

    const response = await orchestrateChat(
      'I feel hopeless',
      '00000000-0000-4000-8000-000000000135',
      undefined,
      'en',
      'chat:test:semantic-crisis',
      {
        retrieveServices,
        isFlagEnabled: async (flagName) => flagName === FEATURE_FLAGS.CONTENT_SAFETY_CRISIS,
        checkSemanticCrisis,
      },
    );

    expect(checkSemanticCrisis).toHaveBeenCalledWith('I feel hopeless');
    expect(response.isCrisis).toBe(true);
    expect(response.crisisResources?.crisisLine).toBe('988');
    expect(retrieveServices).not.toHaveBeenCalled();
  });

  it('keeps third-party distress out of self-crisis classification', async () => {
    const retrieveServices = vi.fn();
    const checkSemanticCrisis = vi.fn().mockResolvedValue(true);

    const response = await orchestrateChat(
      'My friend feels hopeless and I need help for them',
      '00000000-0000-4000-8000-000000000136',
      undefined,
      'en',
      'chat:test:semantic-third-party',
      {
        retrieveServices,
        isFlagEnabled: async (flagName) => flagName === FEATURE_FLAGS.CONTENT_SAFETY_CRISIS,
        checkSemanticCrisis,
      },
    );

    expect(checkSemanticCrisis).not.toHaveBeenCalled();
    expect(response.isCrisis).toBe(false);
    expect(response.clarification?.reason).toBe('crisis_scope');
    expect(retrieveServices).not.toHaveBeenCalled();
  });

  it('does not hard-route third-party crisis language and asks for service scope instead', async () => {
    const retrieveServices = vi.fn();

    const response = await orchestrateChat(
      'My brother is suicidal and I need help finding support',
      '00000000-0000-0000-0000-000000000092',
      undefined,
      'en',
      'chat:test:third-party-crisis',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
      },
    );

    expect(response.isCrisis).toBe(false);
    expect(response.retrievalStatus).toBe('clarification_required');
    expect(response.clarification?.reason).toBe('crisis_scope');
    expect(response.message).toContain('988');
    expect(retrieveServices).not.toHaveBeenCalled();
  });

  it.each([
    'I want to die. This is for a child.',
    'I want to die. This is for my family or household.',
    'I want to die. This is for someone else.',
  ])('honors generated non-self guided crisis scope: %s', async (message) => {
    const retrieveServices = vi.fn();

    const response = await orchestrateChat(
      message,
      '00000000-0000-4000-8000-000000000137',
      undefined,
      'en',
      'chat:test:guided-third-party-crisis',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
      },
    );

    expect(response.isCrisis).toBe(false);
    expect(response.retrievalStatus).toBe('clarification_required');
    expect(response.clarification?.reason).toBe('crisis_scope');
    expect(retrieveServices).not.toHaveBeenCalled();
  });

  it('prioritizes explicit first-person crisis language over incidental family references', async () => {
    const retrieveServices = vi.fn();

    const response = await orchestrateChat(
      'I want to kill myself and my child is with me',
      '00000000-0000-4000-8000-000000000139',
      undefined,
      'en',
      'chat:test:mixed-scope-self-crisis',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
      },
    );

    expect(response.isCrisis).toBe(true);
    expect(response.crisisResources?.crisisLine).toBe('988');
    expect(retrieveServices).not.toHaveBeenCalled();
  });

  it('reuses active session need and city for ambiguous follow-up queries', async () => {
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });

    const response = await orchestrateChat(
      'Anything open today?',
      '00000000-0000-0000-0000-000000000091',
      undefined,
      'en',
      'chat:test:session-context',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          sessionContext: {
            activeNeedId: 'housing',
            activeCity: 'Denver',
            profileShapingEnabled: true,
          },
        }),
      },
    );

    expect(retrieveServices).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'housing',
        actionQualifier: 'hours',
      }),
      expect.objectContaining({
        approximateLocation: { city: 'Denver' },
      }),
    );
    expect(response.activeContextUsed).toBe(true);
    expect(response.sessionContext?.activeNeedId).toBe('housing');
    expect(response.searchInterpretation?.usedSessionContext).toBe(true);
  });

  it.each([
    ['ZIP', { postalCode: '48201' }],
    ['city and state', { city: 'St. Louis', stateProvince: 'MO' }],
  ])('preserves %s location, urgency, audience, and can-travel state across turns', async (_label, activeLocation) => {
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });
    const sessionId = '00000000-0000-4000-8000-000000000127';
    const firstResponse = await orchestrateChat(
      'I need utility assistance.',
      sessionId,
      'user-1',
      'en',
      `chat:test:continuity:${_label}`,
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          approximateLocation: activeLocation,
          userProfile: {
            userId: 'user-1',
            preferredDeliveryModes: ['phone'],
          },
          sessionContext: {
            activeLocation,
            urgency: 'urgent',
            urgencyWindow: 'today',
            audience: 'child',
            preferredDeliveryModes: [],
            profileShapingEnabled: true,
          },
        }),
      },
    );

    expect(firstResponse.sessionContext).toMatchObject({
      activeNeedId: 'utility_assistance',
      activeLocation,
      urgencyWindow: 'today',
      audience: 'child',
      preferredDeliveryModes: [],
    });
    expect(firstResponse.searchInterpretation?.sessionSignals).toContain(
      'Access: no delivery-mode restriction',
    );

    const secondResponse = await orchestrateChat(
      'Show me another option',
      sessionId,
      'user-1',
      'en',
      `chat:test:continuity-follow-up:${_label}`,
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          userProfile: {
            userId: 'user-1',
            preferredDeliveryModes: ['phone'],
          },
          sessionContext: firstResponse.sessionContext,
        }),
      },
    );

    expect(retrieveServices).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ category: 'utility_assistance' }),
      expect.objectContaining({
        retrievalText: 'utility assistance',
        approximateLocation: activeLocation,
        sessionContext: expect.objectContaining({
          urgencyWindow: 'today',
          audience: 'child',
          preferredDeliveryModes: [],
        }),
      }),
    );
    expect(secondResponse.activeContextUsed).toBe(true);
    expect(secondResponse.sessionContext?.preferredDeliveryModes).toEqual([]);
    expect(secondResponse.intent.urgencyQualifier).toBe('urgent');
  });

  it('does not persist the signed-in seeker delivery preference for someone else', async () => {
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });
    const sessionId = '00000000-0000-4000-8000-000000000137';
    const firstResponse = await orchestrateChat(
      'Food help for someone else',
      sessionId,
      'user-1',
      'en',
      'chat:test:someone-else-delivery',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          userProfile: {
            userId: 'user-1',
            preferredDeliveryModes: ['phone'],
          },
          sessionContext: {
            audience: 'someone_else',
            profileShapingEnabled: true,
          },
        }),
      },
    );

    expect(firstResponse.sessionContext?.preferredDeliveryModes).toBeUndefined();

    await orchestrateChat(
      'Show another option',
      sessionId,
      'user-1',
      'en',
      'chat:test:someone-else-delivery-follow-up',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          userProfile: {
            userId: 'user-1',
            preferredDeliveryModes: ['phone'],
          },
          sessionContext: firstResponse.sessionContext,
        }),
      },
    );

    expect(retrieveServices).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({
        sessionContext: expect.not.objectContaining({ preferredDeliveryModes: expect.anything() }),
      }),
    );
  });

  it.each([
    ['Show food near Detroit, MI.', { city: 'Detroit', stateProvince: 'MI' }],
    ['Show food near Seattle.', { city: 'Seattle' }],
    ['I am in need of food near St. Louis, MO.', { city: 'St. Louis', stateProvince: 'MO' }],
    ['I need food in person near St. Louis, MO.', { city: 'St. Louis', stateProvince: 'MO' }],
    ['Show food near Detroit, MI today.', { city: 'Detroit', stateProvince: 'MI' }],
    ['Show food near Tacoma today.', { city: 'Tacoma' }],
    ['Show food near Detroit that is open today.', { city: 'Detroit' }],
    ['Show food near Detroit and open today.', { city: 'Detroit' }],
    ['Show food near Detroit, MI please.', { city: 'Detroit', stateProvince: 'MI' }],
    ['Food in 98101 but actually near 48201.', { postalCode: '48201' }],
  ])('uses an explicit current-turn location immediately: %s', async (message, expectedLocation) => {
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });

    const response = await orchestrateChat(
      message,
      '00000000-0000-4000-8000-000000000128',
      undefined,
      'en',
      `chat:test:current-location:${message}`,
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          sessionContext: {
            activeNeedId: 'food_assistance',
            activeLocation: { city: 'Portland', stateProvince: 'OR' },
            activeGeo: { lat: 45.5152, lng: -122.6784, radiusMiles: 10 },
            profileShapingEnabled: true,
          },
        }),
      },
    );

    expect(retrieveServices).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'food_assistance' }),
      expect.objectContaining({ approximateLocation: expectedLocation }),
    );
    expect(response.sessionContext?.activeLocation).toEqual(expectedLocation);
    expect(response.sessionContext?.activeGeo).toBeUndefined();
  });

  it('preserves an active device distance area when no explicit city or ZIP replaces it', async () => {
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });
    const activeGeo = { lat: 47.6062, lng: -122.3321, radiusMiles: 15 };

    const response = await orchestrateChat(
      'Show me another food option',
      '00000000-0000-4000-8000-000000000133',
      undefined,
      'en',
      'chat:test:geo-continuity',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          sessionContext: {
            activeNeedId: 'food_assistance',
            activeGeo,
            profileShapingEnabled: true,
          },
        }),
      },
    );

    expect(retrieveServices).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        sessionContext: expect.objectContaining({ activeGeo }),
      }),
    );
    expect(response.sessionContext?.activeGeo).toEqual(activeGeo);
    expect(response.resultSummary).toContain('selected 15-mile distance area');
  });

  it.each([
    'I need housing help in person.',
    "I'm in need of food.",
    'Show me resources near me.',
    'Show food near my work.',
  ])('does not promote an ambiguous phrase to a city: %s', async (message) => {
    const activeLocation = { city: 'Seattle', stateProvince: 'WA' };
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });

    const response = await orchestrateChat(
      message,
      '00000000-0000-4000-8000-000000000129',
      undefined,
      'en',
      `chat:test:ambiguous-location:${message}`,
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          sessionContext: {
            activeNeedId: 'housing',
            activeLocation,
            profileShapingEnabled: true,
          },
        }),
      },
    );

    expect(retrieveServices).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ approximateLocation: activeLocation }),
    );
    expect(response.sessionContext?.activeLocation).toEqual(activeLocation);
  });

  it('updates planning urgency to today before the next retrieval', async () => {
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });
    const sessionId = '00000000-0000-4000-8000-000000000130';
    const initialContext: ChatSessionContext = {
      activeNeedId: 'utility_assistance',
      urgency: 'standard',
      urgencyWindow: 'planning',
      profileShapingEnabled: true,
    };

    const planningResponse = await orchestrateChat(
      'Show me another option while I am planning ahead.',
      sessionId,
      'user-1',
      'en',
      'chat:test:urgency-planning',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          userProfile: { userId: 'user-1', urgencyWindow: 'same_day' },
          sessionContext: initialContext,
        }),
      },
    );

    expect(retrieveServices).toHaveBeenNthCalledWith(1,
      expect.any(Object),
      expect.objectContaining({
        sessionContext: expect.objectContaining({ urgencyWindow: 'planning' }),
      }),
    );
    expect(planningResponse.sessionContext?.urgencyWindow).toBe('planning');

    const todayResponse = await orchestrateChat(
      'I was planning ahead, but actually need help today.',
      sessionId,
      'user-1',
      'en',
      'chat:test:urgency-today',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          userProfile: { userId: 'user-1', urgencyWindow: 'same_day' },
          sessionContext: planningResponse.sessionContext,
        }),
      },
    );

    expect(retrieveServices).toHaveBeenNthCalledWith(2,
      expect.any(Object),
      expect.objectContaining({
        sessionContext: expect.objectContaining({
          urgency: 'urgent',
          urgencyWindow: 'today',
        }),
      }),
    );
    expect(todayResponse.sessionContext).toMatchObject({
      urgency: 'urgent',
      urgencyWindow: 'today',
    });
    expect(todayResponse.intent.urgencyQualifier).toBe('urgent');
  });

  it('treats negated urgency and planning language as a planning request', async () => {
    const retrieveServices = vi.fn().mockResolvedValue({
      services: [],
      retrievalStatus: 'no_match',
    });

    const response = await orchestrateChat(
      'This is not urgent; I am planning ahead.',
      '00000000-0000-4000-8000-000000000134',
      undefined,
      'en',
      'chat:test:negated-urgency',
      {
        retrieveServices,
        isFlagEnabled: async () => false,
        hydrateContext: async (context) => ({
          ...context,
          sessionContext: {
            activeNeedId: 'food_assistance',
            profileShapingEnabled: true,
          },
        }),
      },
    );

    expect(retrieveServices).toHaveBeenCalledWith(
      expect.objectContaining({ urgencyQualifier: 'standard' }),
      expect.objectContaining({
        sessionContext: expect.objectContaining({
          urgency: 'standard',
          urgencyWindow: 'planning',
        }),
      }),
    );
    expect(response.intent.urgencyQualifier).toBe('standard');
    expect(response.sessionContext).toMatchObject({
      urgency: 'standard',
      urgencyWindow: 'planning',
    });
  });

  it('diversifies the final result set across organizations and exposes deterministic follow-up metadata', () => {
    const response = assembleResponse(
      [
        makeMockService('svc-1', { organizationId: 'org-a', verificationConfidence: 95, attributes: [{ taxonomy: 'access', tag: 'same_day' }] }),
        makeMockService('svc-2', { organizationId: 'org-a', verificationConfidence: 92 }),
        makeMockService('svc-3', { organizationId: 'org-a', verificationConfidence: 91 }),
        makeMockService('svc-4', { organizationId: 'org-b', verificationConfidence: 84 }),
        makeMockService('svc-5', { organizationId: 'org-c', verificationConfidence: 83 }),
        makeMockService('svc-6', { organizationId: 'org-d', verificationConfidence: 82 }),
      ],
      { ...baseIntent, urgencyQualifier: 'urgent' },
      {
        ...mockContext,
        approximateLocation: { city: 'Denver' },
        sessionContext: {
          activeNeedId: 'food_assistance',
          activeCity: 'Denver',
          profileShapingEnabled: true,
        },
      },
      {
        retrievalStatus: 'results',
        activeContextUsed: true,
      },
    );

    expect(response.services.map((service) => service.organizationName)).toEqual([
      'Organization org-a',
      'Organization org-b',
      'Organization org-c',
      'Organization org-d',
      'Organization org-a',
    ]);
    expect(response.resultSummary).toContain('varied across organizations');
    expect(response.followUpSuggestions?.length).toBeGreaterThan(0);
  });

  it('claims location ordering only when the catalog resolved the city and state', () => {
    const context = {
      ...mockContext,
      approximateLocation: { city: 'St. Louis', stateProvince: 'MO' },
    };
    const services = [makeMockService('svc-location')];

    const applied = assembleResponse(services, baseIntent, context, {
      retrievalStatus: 'results',
      locationBiasApplied: true,
    });
    const unresolved = assembleResponse(services, baseIntent, context, {
      retrievalStatus: 'results',
      locationBiasApplied: false,
    });

    expect(applied.resultSummary).toContain('used St. Louis, MO as a distance tie-breaker');
    expect(unresolved.resultSummary).toContain('could not resolve St. Louis, MO');
    expect(unresolved.resultSummary).not.toContain('distance tie-breaker');
  });

  it('describes an active device distance area without falsely reporting a saved city lookup failure', () => {
    const response = assembleResponse(
      [makeMockService('svc-active-geo')],
      baseIntent,
      {
        ...mockContext,
        userProfile: {
          userId: 'user-1',
          locationCity: 'Portland',
        },
        sessionContext: {
          activeNeedId: 'food_assistance',
          activeGeo: { lat: 47.6062, lng: -122.3321, radiusMiles: 10 },
          profileShapingEnabled: true,
        },
      },
      {
        retrievalStatus: 'results',
        locationBiasApplied: false,
      },
    );

    expect(response.resultSummary).toContain('selected 10-mile distance area');
    expect(response.resultSummary).not.toContain('could not resolve Portland');
  });

  it('does not let the legacy session counter override identity-aware daily controls', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000097';
    for (let index = 0; index < MAX_CHAT_QUOTA; index++) {
      await incrementQuota(sessionId);
    }

    const retrieveServices = vi.fn();
    retrieveServices.mockResolvedValue({ services: [], retrievalStatus: 'no_match' });
    const isFlagEnabled = vi.fn().mockResolvedValue(false);

    const response = await orchestrateChat(
      'I need food',
      sessionId,
      undefined,
      'en',
      'chat:test:quota',
      {
        retrieveServices,
        isFlagEnabled,
      },
    );

    expect(response.message).not.toContain('message limit');
    expect(response.quotaRemaining).toBe(0);
    expect(retrieveServices).toHaveBeenCalledOnce();
    expect(isFlagEnabled).toHaveBeenCalledWith(FEATURE_FLAGS.LLM_SUMMARIZE);
  });

  it('returns a deterministic out-of-scope response before retrieval', async () => {
    const retrieveServices = vi.fn();

    const response = await orchestrateChat(
      'What is the weather tomorrow?',
      '00000000-0000-0000-0000-000000000099',
      undefined,
      'en',
      'chat:test:out-of-scope',
      {
        retrieveServices,
        isFlagEnabled: async () => true,
      },
    );

    expect(response.retrievalStatus).toBe('out_of_scope');
    expect(response.message).toContain('ORAN Chat');
    expect(retrieveServices).not.toHaveBeenCalled();
  });

  it('skips LLM summarization when retrieval is temporarily unavailable', async () => {
    const llmSpy = vi.fn();

    const response = await orchestrateChat(
      'I need food',
      '00000000-0000-0000-0000-000000000100',
      undefined,
      'en',
      'chat:test:unavailable',
      {
        retrieveServices: async () => ({
          services: [],
          retrievalStatus: 'temporarily_unavailable',
        }),
        isFlagEnabled: async () => true,
        summarizeWithLLM: llmSpy,
      },
    );

    expect(response.retrievalStatus).toBe('temporarily_unavailable');
    expect(response.llmSummarized).toBe(false);
    expect(llmSpy).not.toHaveBeenCalled();
  });
});

describe('quota helpers', () => {
  it('increments in-memory quota counts when the database is not configured', async () => {
    const sessionId = 'quota-test-session-002';
    const before = checkQuota(sessionId);

    await incrementQuota(sessionId);

    expect(checkQuota(sessionId)).toMatchObject({
      messageCount: before.messageCount + 1,
      remaining: before.remaining - 1,
      exceeded: false,
    });
  });
});
