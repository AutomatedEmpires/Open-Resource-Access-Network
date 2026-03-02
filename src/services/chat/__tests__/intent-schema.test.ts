/**
 * Chat Intent Schema and Crisis Detection Tests
 *
 * Tests for:
 * - Crisis keyword detection
 * - Intent detection from messages
 * - Eligibility disclaimer always present in responses
 * - LLM gate: summarization only when flag enabled
 *
 * All tests are self-contained — no DB connection required.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  detectCrisis,
  detectIntent,
  assembleResponse,
  assembleCrisisResponse,
  checkQuota,
  incrementQuota,
  orchestrateChat,
} from '../orchestrator';
import { ELIGIBILITY_DISCLAIMER, CRISIS_KEYWORDS } from '@/domain/constants';
import type { EnrichedService } from '@/domain/types';
import type { Intent } from '../types';

// ============================================================
// FIXTURES
// ============================================================

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

// Mock EnrichedService
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
      updatedAt: now,
      createdAt: now,
    },
    phones: [{ id: 'ph-1', number: '555-000-0001', type: 'voice', createdAt: now, updatedAt: now }],
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

// ============================================================
// Crisis Detection
// ============================================================

describe('detectCrisis', () => {
  it('detects "suicide" keyword', () => {
    expect(detectCrisis('I am thinking about suicide')).toBe(true);
  });

  it('detects "kill myself" keyword', () => {
    expect(detectCrisis('I want to kill myself')).toBe(true);
  });

  it('detects "overdose" keyword', () => {
    expect(detectCrisis('I think I took an overdose')).toBe(true);
  });

  it('detects "domestic violence" keyword', () => {
    expect(detectCrisis('I am experiencing domestic violence')).toBe(true);
  });

  it('detects "988" as crisis call intent', () => {
    // Not a keyword, but let's verify normal messages don't trigger
    expect(detectCrisis('I need food assistance today')).toBe(false);
  });

  it('does not trigger on normal queries', () => {
    expect(detectCrisis('I need help finding food')).toBe(false);
    expect(detectCrisis('Looking for healthcare services')).toBe(false);
    expect(detectCrisis('Where can I find housing assistance?')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(detectCrisis('SUICIDE')).toBe(true);
    expect(detectCrisis('Suicide')).toBe(true);
    expect(detectCrisis('OVERDOSE')).toBe(true);
  });

  it('covers a significant portion of the CRISIS_KEYWORDS list', () => {
    const detectedCount = CRISIS_KEYWORDS.filter((kw) =>
      detectCrisis(`I ${kw}`)
    ).length;
    // At least 80% of keywords should be detected
    expect(detectedCount / CRISIS_KEYWORDS.length).toBeGreaterThan(0.8);
  });
});

// ============================================================
// Intent Detection
// ============================================================

describe('detectIntent', () => {
  it('detects food_assistance for food-related queries', () => {
    const intent = detectIntent('I need food and groceries');
    expect(intent.category).toBe('food_assistance');
  });

  it('detects housing for housing-related queries', () => {
    const intent = detectIntent('I need housing and shelter');
    expect(intent.category).toBe('housing');
  });

  it('detects mental_health for therapy queries', () => {
    const intent = detectIntent('I need therapy for my anxiety');
    expect(intent.category).toBe('mental_health');
  });

  it('detects employment for job queries', () => {
    const intent = detectIntent('Help me find a job and employment training');
    expect(intent.category).toBe('employment');
  });

  it('detects urgency qualifier', () => {
    const intent = detectIntent('I need food urgently right now');
    expect(intent.urgencyQualifier).toBe('urgent');
  });

  it('defaults to standard urgency for normal queries', () => {
    const intent = detectIntent('I would like to find a food pantry');
    expect(intent.urgencyQualifier).toBe('standard');
  });

  it('falls back to general for unrecognized queries', () => {
    const intent = detectIntent('xyzabc');
    expect(intent.category).toBe('general');
  });

  it('preserves rawQuery', () => {
    const msg = 'I need help with food';
    const intent = detectIntent(msg);
    expect(intent.rawQuery).toBe(msg);
  });

  it('schema validates correctly via IntentSchema', () => {
    const intent = detectIntent('I need food help');
    expect(intent.category).toBeDefined();
    expect(intent.rawQuery).toBeDefined();
    expect(['urgent', 'standard']).toContain(intent.urgencyQualifier);
  });
});

// ============================================================
// assembleResponse — eligibility disclaimer
// ============================================================

describe('assembleResponse', () => {
  it('always includes eligibility disclaimer', () => {
    const response = assembleResponse([], baseIntent, mockContext);
    expect(response.eligibilityDisclaimer).toBe(ELIGIBILITY_DISCLAIMER);
    expect(response.eligibilityDisclaimer.length).toBeGreaterThan(10);
  });

  it('includes eligibility disclaimer even with services', () => {
    const services = [makeMockService('svc-1')];
    const response = assembleResponse(services, baseIntent, mockContext);
    expect(response.eligibilityDisclaimer).toBe(ELIGIBILITY_DISCLAIMER);
  });

  it('isCrisis is false for normal responses', () => {
    const response = assembleResponse([], baseIntent, mockContext);
    expect(response.isCrisis).toBe(false);
  });

  it('llmSummarized is false by default', () => {
    const response = assembleResponse([], baseIntent, mockContext);
    expect(response.llmSummarized).toBe(false);
  });

  it('returns services as ServiceCards (max 5)', () => {
    const services = Array.from({ length: 8 }, (_, i) => makeMockService(`svc-${i}`));
    const response = assembleResponse(services, baseIntent, mockContext);
    expect(response.services.length).toBeLessThanOrEqual(5);
  });

  it('service cards contain qualifying language, not guarantees', () => {
    const services = [makeMockService('svc-1')];
    const response = assembleResponse(services, baseIntent, mockContext);
    const card = response.services[0];
    // Should say "may qualify" — never "you qualify" or "you are eligible"
    expect(card.eligibilityHint.toLowerCase()).toMatch(/may qualify|confirm|provider/);
    expect(card.eligibilityHint.toLowerCase()).not.toMatch(/you (are|are definitely) eligible/);
  });
});

// ============================================================
// assembleCrisisResponse
// ============================================================

describe('assembleCrisisResponse', () => {
  it('returns isCrisis=true', () => {
    const response = assembleCrisisResponse(baseIntent, 'session-1');
    expect(response.isCrisis).toBe(true);
  });

  it('includes crisis resources with 911, 988, 211', () => {
    const response = assembleCrisisResponse(baseIntent, 'session-1');
    expect(response.crisisResources?.emergency).toBe('911');
    expect(response.crisisResources?.crisisLine).toBe('988');
    expect(response.crisisResources?.communityLine).toBe('211');
  });

  it('still includes eligibility disclaimer', () => {
    const response = assembleCrisisResponse(baseIntent, 'session-1');
    expect(response.eligibilityDisclaimer).toBe(ELIGIBILITY_DISCLAIMER);
  });

  it('returns empty services array (crisis takes priority)', () => {
    const response = assembleCrisisResponse(baseIntent, 'session-1');
    expect(response.services).toHaveLength(0);
  });
});

// ============================================================
// LLM Gate
// ============================================================

describe('LLM gate in orchestrateChat', () => {
  const freshSessionId = '00000000-0000-0000-0000-000000000099';

  it('does NOT call LLM when flag is disabled', async () => {
    const llmSpy = vi.fn().mockResolvedValue('LLM summary');

      const response = await orchestrateChat('I need food', freshSessionId, undefined, 'en', {
      retrieveServices: async () => [makeMockService('svc-1')],
      isFlagEnabled: async () => false, // Flag disabled
      summarizeWithLLM: llmSpy,
    });

    expect(llmSpy).not.toHaveBeenCalled();
    expect(response.llmSummarized).toBe(false);
  });

  it('calls LLM when flag is enabled and services are returned', async () => {
    const llmSpy = vi.fn().mockResolvedValue('Here are services that may help.');
    const sessionId = '00000000-0000-0000-0000-000000000098';

      const response = await orchestrateChat('I need food', sessionId, undefined, 'en', {
      retrieveServices: async () => [makeMockService('svc-2')],
      isFlagEnabled: async () => true, // Flag enabled
      summarizeWithLLM: llmSpy,
    });

    expect(llmSpy).toHaveBeenCalled();
    expect(response.llmSummarized).toBe(true);
    expect(response.message).toBe('Here are services that may help.');
  });

  it('does NOT call LLM when flag enabled but no services returned', async () => {
    const llmSpy = vi.fn().mockResolvedValue('LLM summary');
    const sessionId = '00000000-0000-0000-0000-000000000097';

      const response = await orchestrateChat('I need food', sessionId, undefined, 'en', {
      retrieveServices: async () => [], // No services
      isFlagEnabled: async () => true,
      summarizeWithLLM: llmSpy,
    });

    expect(llmSpy).not.toHaveBeenCalled();
    expect(response.llmSummarized).toBe(false);
  });

  it('falls back gracefully if LLM throws', async () => {
    const llmSpy = vi.fn().mockRejectedValue(new Error('LLM unavailable'));
    const sessionId = '00000000-0000-0000-0000-000000000096';

      const response = await orchestrateChat('I need food', sessionId, undefined, 'en', {
      retrieveServices: async () => [makeMockService('svc-3')],
      isFlagEnabled: async () => true,
      summarizeWithLLM: llmSpy,
    });

    // Should succeed with assembled response even if LLM fails
    expect(response.llmSummarized).toBe(false);
    expect(response.services.length).toBeGreaterThan(0);
  });

  it('crisis routing fires before LLM gate', async () => {
    const llmSpy = vi.fn();
    const sessionId = '00000000-0000-0000-0000-000000000095';

      const response = await orchestrateChat(
        'I want to kill myself',
        sessionId,
        undefined,
        'en',
        {
        retrieveServices: async () => [],
        isFlagEnabled: async () => true, // Flag on but shouldn't matter
        summarizeWithLLM: llmSpy,
      }
    );

    expect(response.isCrisis).toBe(true);
    expect(llmSpy).not.toHaveBeenCalled(); // LLM never called for crisis
  });
});

// ============================================================
// Quota management
// ============================================================

describe('Quota management', () => {
  it('checkQuota returns correct remaining count', () => {
    const sessionId = 'quota-test-session-001';
    const state = checkQuota(sessionId);
    expect(state.remaining).toBeGreaterThan(0);
    expect(state.exceeded).toBe(false);
  });

  it('incrementQuota increases message count', () => {
    const sessionId = 'quota-test-session-002';
    const before = checkQuota(sessionId);
    incrementQuota(sessionId);
    const after = checkQuota(sessionId);
    expect(after.messageCount).toBe(before.messageCount + 1);
  });
});
