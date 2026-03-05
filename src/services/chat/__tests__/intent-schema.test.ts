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

function makeMockService(id: string): EnrichedService {
  const now = new Date();

  return {
    service: {
      id,
      organizationId: 'org-1',
      name: 'Test Food Bank',
      description: 'Provides emergency food assistance.',
      status: 'active',
      updatedAt: now,
      createdAt: now,
    },
    organization: {
      id: 'org-1',
      name: 'Test Organization',
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
    confidenceScore: {
      id: 'cs-1',
      serviceId: id,
      score: 80,
      verificationConfidence: 85,
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

    const response = await orchestrateChat(
      'I need food',
      '00000000-0000-0000-0000-000000000098',
      undefined,
      'en',
      'chat:test:llm',
      {
        retrieveServices: async () => [makeMockService('svc-1')],
        isFlagEnabled: async () => true,
        summarizeWithLLM: llmSpy,
      },
    );

    expect(llmSpy).toHaveBeenCalledOnce();
    expect(response.llmSummarized).toBe(true);
    expect(response.message).toBe('Here are services that may help.');
  });

  it('falls back to the assembled response if LLM summarization fails', async () => {
    const llmSpy = vi.fn().mockRejectedValue(new Error('LLM unavailable'));

    const response = await orchestrateChat(
      'I need food',
      '00000000-0000-0000-0000-000000000096',
      undefined,
      'en',
      'chat:test:llm-fallback',
      {
        retrieveServices: async () => [makeMockService('svc-2')],
        isFlagEnabled: async () => true,
        summarizeWithLLM: llmSpy,
      },
    );

    expect(llmSpy).toHaveBeenCalledOnce();
    expect(response.llmSummarized).toBe(false);
    expect(response.services).toHaveLength(1);
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
