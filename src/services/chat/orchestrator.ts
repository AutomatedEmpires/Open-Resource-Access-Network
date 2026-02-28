/**
 * ORAN Chat Orchestrator
 *
 * Implements the retrieval-first chat pipeline:
 * Crisis Detection → Quota Check → Rate Limit → Intent → Profile → Retrieval → Assembly → [LLM gate]
 *
 * IMPORTANT:
 * - No LLM is used in retrieval or ranking
 * - LLM summarization is ONLY activated when feature flag 'llm_summarize' is enabled
 * - LLM may ONLY summarize already-retrieved records — never retrieve or rank
 * - Crisis routing always takes priority
 */

import {
  CRISIS_KEYWORDS,
  CRISIS_RESOURCES,
  ELIGIBILITY_DISCLAIMER,
  MAX_CHAT_QUOTA,
  MAX_SERVICES_PER_RESPONSE,
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  FEATURE_FLAGS,
} from '@/domain/constants';
import {
  checkRateLimit as checkRateLimitBase,
  type RateLimitState,
} from '@/services/security/rateLimit';
import type { EnrichedService } from '@/domain/types';
import type {
  Intent,
  ChatContext,
  ChatResponse,
  ServiceCard,
  QuotaState,
} from './types';
import {
  INTENT_CATEGORIES,
  enrichedServiceToCard,
} from './types';

// ============================================================
// IN-MEMORY STATE (replace with Redis in production)
// ============================================================

const sessionQuotas = new Map<string, number>();

// ============================================================
// CRISIS DETECTION
// ============================================================

/**
 * Checks if a message contains any crisis keywords.
 * This is a simple keyword match — no LLM, no ML.
 * Must run before any other pipeline stage.
 */
export function detectCrisis(message: string): boolean {
  const normalized = message.toLowerCase();
  return CRISIS_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

// ============================================================
// QUOTA MANAGEMENT
// ============================================================

export function checkQuota(sessionId: string): QuotaState {
  const count = sessionQuotas.get(sessionId) ?? 0;
  const remaining = Math.max(0, MAX_CHAT_QUOTA - count);
  return {
    sessionId,
    messageCount: count,
    remaining,
    exceeded: count >= MAX_CHAT_QUOTA,
  };
}

export function incrementQuota(sessionId: string): void {
  const count = sessionQuotas.get(sessionId) ?? 0;
  sessionQuotas.set(sessionId, count + 1);
}

// ============================================================
// RATE LIMITING
// ============================================================

export function checkRateLimit(key: string): RateLimitState {
  return checkRateLimitBase(key, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: RATE_LIMIT_MAX_REQUESTS,
  });
}

// ============================================================
// INTENT DETECTION
// ============================================================

/** Keyword map for intent detection — no LLM, pure pattern matching */
const INTENT_KEYWORD_MAP: Record<string, string[]> = {
  food_assistance:    ['food', 'hungry', 'meal', 'pantry', 'snap', 'ebt', 'nutrition', 'groceries', 'hunger'],
  housing:            ['housing', 'shelter', 'eviction', 'rent', 'homeless', 'house', 'apartment', 'landlord'],
  mental_health:      ['therapy', 'counseling', 'mental', 'anxiety', 'depression', 'psychiatr', 'stress', 'emotional'],
  healthcare:         ['doctor', 'clinic', 'medical', 'prescription', 'insurance', 'health', 'hospital', 'dental'],
  employment:         ['job', 'work', 'unemployment', 'career', 'resume', 'hire', 'employment', 'training'],
  childcare:          ['childcare', 'daycare', 'after school', 'babysit', 'preschool', 'child care'],
  transportation:     ['bus', 'ride', 'transit', 'car', 'transportation', 'driving', 'vehicle'],
  legal_aid:          ['legal', 'lawyer', 'attorney', 'court', 'evict', 'civil', 'rights', 'immigration'],
  utility_assistance: ['electric', 'gas', 'water', 'utility', 'bill', 'power', 'heat', 'lights'],
};

/**
 * Detects the intent category from a user message.
 * Uses keyword matching — no LLM, no ML.
 */
export function detectIntent(message: string): Intent {
  const normalized = message.toLowerCase();

  let bestCategory = 'general';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(INTENT_KEYWORD_MAP)) {
    const score = keywords.filter((kw) => normalized.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  // Detect urgency
  const urgencyWords = ['urgent', 'emergency', 'immediate', 'today', 'now', 'asap', 'right now'];
  const isUrgent = urgencyWords.some((w) => normalized.includes(w));

  return {
    category: bestCategory as (typeof INTENT_CATEGORIES)[number],
    rawQuery: message,
    urgencyQualifier: isUrgent ? 'urgent' : 'standard',
  };
}

// ============================================================
// CONTEXT ASSEMBLY
// ============================================================

/**
 * Assembles the chat context for a request.
 * Profile hydration: loads saved preferences for authenticated users.
 */
export function assembleContext(sessionId: string, userId?: string): ChatContext {
  const quota = checkQuota(sessionId);

  return {
    sessionId,
    userId,
    messageCount: quota.messageCount,
    // Profile hydration would load from DB for authenticated users
    // For now, return minimal context
    userProfile: userId
      ? { userId }
      : undefined,
  };
}

// ============================================================
// RESPONSE ASSEMBLY
// ============================================================

/**
 * Assembles a ChatResponse from retrieved services.
 * This is pure data transformation — no LLM, no generation.
 * LLM summarization happens AFTER this, only if the feature flag is enabled.
 */
export function assembleResponse(
  services: EnrichedService[],
  intent: Intent,
  context: ChatContext,
  options?: { llmSummarized?: boolean }
): ChatResponse {
  const quota = checkQuota(context.sessionId);
  const cards: ServiceCard[] = services
    .slice(0, MAX_SERVICES_PER_RESPONSE)
    .map(enrichedServiceToCard);

  const message =
    services.length === 0
      ? `I wasn't able to find services matching your request in the database. ` +
        `Please try rephrasing or contact 211 for local assistance.`
      : `I found ${cards.length} service${cards.length !== 1 ? 's' : ''} that may help with your ${intent.category.replace('_', ' ')} needs.`;

  return {
    message,
    services: cards,
    isCrisis: false,
    intent,
    sessionId: context.sessionId,
    quotaRemaining: quota.remaining,
    eligibilityDisclaimer: ELIGIBILITY_DISCLAIMER,
    llmSummarized: options?.llmSummarized ?? false,
  };
}

// ============================================================
// CRISIS RESPONSE
// ============================================================

export function assembleCrisisResponse(
  intent: Intent,
  sessionId: string
): ChatResponse {
  return {
    message: CRISIS_RESOURCES.crisisMessage,
    services: [],
    isCrisis: true,
    crisisResources: CRISIS_RESOURCES,
    intent,
    sessionId,
    quotaRemaining: MAX_CHAT_QUOTA, // Don't penalize quota for crisis detection
    eligibilityDisclaimer: ELIGIBILITY_DISCLAIMER,
    llmSummarized: false,
  };
}

// ============================================================
// MAIN ORCHESTRATOR
// ============================================================

export interface OrchestratorDeps {
  /** Fetch services from DB based on intent and context — pure SQL, no LLM */
  retrieveServices: (intent: Intent, context: ChatContext) => Promise<EnrichedService[]>;
  /** Check if a feature flag is enabled */
  isFlagEnabled: (flagName: string) => Promise<boolean>;
  /** Optional: LLM summarization — only called if flag enabled, only summarizes retrieved records */
  summarizeWithLLM?: (services: EnrichedService[], intent: Intent) => Promise<string>;
}

/**
 * Main chat orchestrator. Implements the full pipeline.
 */
export async function orchestrateChat(
  message: string,
  sessionId: string,
  userId: string | undefined,
  deps: OrchestratorDeps
): Promise<ChatResponse> {
  // Stage 1: Crisis detection — always first, always takes priority
  if (detectCrisis(message)) {
    const intent = detectIntent(message);
    return assembleCrisisResponse(intent, sessionId);
  }

  // Stage 2: Quota check
  const quota = checkQuota(sessionId);
  if (quota.exceeded) {
    const intent = detectIntent(message);
    return {
      message: `You've reached the message limit for this session (${MAX_CHAT_QUOTA} messages). Please start a new conversation.`,
      services: [],
      isCrisis: false,
      intent,
      sessionId,
      quotaRemaining: 0,
      eligibilityDisclaimer: ELIGIBILITY_DISCLAIMER,
      llmSummarized: false,
    };
  }

  // Stage 3: Rate limit is checked by the API handler (not here)

  // Stage 4: Intent detection — no LLM
  const intent = detectIntent(message);

  // Stage 5: Context assembly (profile hydration)
  const context = assembleContext(sessionId, userId);

  // Stage 6: Retrieval — pure SQL, no LLM
  const services = await deps.retrieveServices(intent, context);

  // Stage 7: Response assembly
  let response = assembleResponse(services, intent, context);

  // Stage 8: LLM summarization gate
  // ONLY activate if: (a) flag is enabled AND (b) there are services to summarize
  const llmEnabled = await deps.isFlagEnabled(FEATURE_FLAGS.LLM_SUMMARIZE);
  if (llmEnabled && services.length > 0 && deps.summarizeWithLLM) {
    try {
      const summary = await deps.summarizeWithLLM(services, intent);
      response = { ...response, message: summary, llmSummarized: true };
    } catch {
      // LLM failure is non-fatal — fall back to assembled message
    }
  }

  // Increment quota after successful response
  incrementQuota(sessionId);

  return response;
}
