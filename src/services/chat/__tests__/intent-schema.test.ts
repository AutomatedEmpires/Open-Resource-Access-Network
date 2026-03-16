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
import type { Intent } from '../types';
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

  it('returns a quota-exceeded response before retrieval when the session is exhausted', async () => {
    const sessionId = '00000000-0000-0000-0000-000000000097';
    for (let index = 0; index < MAX_CHAT_QUOTA; index++) {
      await incrementQuota(sessionId);
    }

    const retrieveServices = vi.fn();
    const isFlagEnabled = vi.fn();

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

    expect(response.message).toContain('message limit');
    expect(response.quotaRemaining).toBe(0);
    expect(retrieveServices).not.toHaveBeenCalled();
    // Crisis safety flag (Stage 1b) runs before quota — that's correct.
    // The key contract: LLM summarization must NOT trigger on quota exceeded.
    expect(isFlagEnabled).not.toHaveBeenCalledWith(FEATURE_FLAGS.LLM_SUMMARIZE);
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
