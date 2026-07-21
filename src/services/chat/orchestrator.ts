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
import { getDiscoveryNeedSearchText } from '@/domain/discoveryNeeds';
import {
  checkRateLimit as checkRateLimitBase,
  type RateLimitState,
} from '@/services/security/rateLimit';
import {
  hasDistressSignals,
  checkCrisisContentSafety,
  normalizeSafetyText,
} from '@/services/security/contentSafety';
import type { EnrichedService } from '@/domain/types';
import type {
  Intent,
  ChatContext,
  ChatResponse,
  ServiceCard,
  QuotaState,
  ChatSessionContext,
} from './types';
import {
  INTENT_CATEGORIES,
  enrichedServiceToCard,
} from './types';
import type { ChatRetrievalResult, ChatRetrievalStatus, SearchInterpretation } from './types';
import {
  checkQuota as checkQuotaPersistent,
  incrementQuota as incrementQuotaPersistent,
  checkQuotaSync,
  resetSessionQuotasForTests as resetQuotasInternal,
} from './quota';
import { buildSeekerDiscoveryProfile } from '@/services/profile/discoveryProfile';
import { shouldUseSavedSeekerProfile } from '@/services/chat/profileSignals';

// ============================================================
// CRISIS DETECTION
// ============================================================

/**
 * Checks if a message contains any crisis keywords.
 * This is a simple keyword match — no LLM, no ML.
 * Must run before any other pipeline stage.
 */
export function detectCrisis(message: string): boolean {
  if (classifyCrisisScope(message) !== 'self') {
    return false;
  }

  const normalized = normalizeSafetyText(message);
  return CRISIS_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

type CrisisScope = 'self' | 'third_party' | 'informational' | null;

const GUIDED_NON_SELF_CRISIS_SCOPE_PATTERNS: RegExp[] = [
  /\bthis is for (?:someone else|a child|my family(?: or household)?)\b/i,
];

const EXPLICIT_SELF_CRISIS_PATTERNS: RegExp[] = [
  /\b(?:kill|hurt|harm|cut(?:ting)?)\s+myself\b/i,
  /\b(?:end|ending|take)\s+my life\b/i,
  /\bi\s+(?:want|wish|plan|intend)\s+to\s+die\b/i,
  /\bi(?:'m| am)\s+suicidal\b/i,
  /\b(?:i\s+)?(?:took too many pills|took too much|am overdosing|overdosed)\b/i,
  /\b(?:someone|my spouse|my partner|my boyfriend|my girlfriend)\s+is\s+hurting\s+me\b/i,
  /\bi(?:'m| am)\s+(?:being attacked|being abused|in danger right now)\b/i,
];

const THIRD_PARTY_CRISIS_PATTERNS: RegExp[] = [
  /\b(my friend|my brother|my sister|my partner|my spouse|my child|my son|my daughter|my mom|my mother|my dad|my father)\b/i,
  /\b(friend|partner|spouse|child|parent|someone|another person)\b.*\b(suicid|kill themselves|hurt themselves|self harm|overdose)\b/i,
  /\bhow do i help\b/i,
  /\bwhat should i do if\b/i,
  /\bhelp (him|her|them)\b/i,
];

const INFORMATIONAL_CRISIS_PATTERNS: RegExp[] = [
  /\b(what is|what does|tell me about|information about)\b.*\b(988|suicide|self harm|self-harm|overdose)\b/i,
  /\b(suicide hotline|crisis hotline|988 hotline)\b/i,
  /\b(signs of suicide|suicide warning signs)\b/i,
];

function classifyCrisisScope(message: string): CrisisScope {
  const normalized = normalizeSafetyText(message);
  const hasKeyword = CRISIS_KEYWORDS.some((keyword) => normalized.includes(keyword.toLowerCase()));
  if (!hasKeyword && !hasDistressSignals(message)) {
    return null;
  }

  if (INFORMATIONAL_CRISIS_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'informational';
  }

  // The guided intake emits these exact audience sentences. They are explicit
  // scope, so preserve them even when the submitted need itself uses first-
  // person wording (for example, a caregiver pasting a child's words).
  if (GUIDED_NON_SELF_CRISIS_SCOPE_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'third_party';
  }

  // Direct evidence that the speaker is in danger takes precedence over an
  // incidental family reference (for example, "...and my child is with me").
  if (EXPLICIT_SELF_CRISIS_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'self';
  }

  if (THIRD_PARTY_CRISIS_PATTERNS.some((pattern) => pattern.test(message))) {
    return 'third_party';
  }

  return 'self';
}

// ============================================================
// QUOTA MANAGEMENT (delegated to quota.ts — persistent when DB available)
// ============================================================

/**
 * Check quota (async, DB-backed when configured).
 * Re-exported for consumers that can await.
 */
export { checkQuotaPersistent as checkQuotaAsync };

/**
 * Synchronous in-memory-only quota check.
 * Kept for assembleContext() and other sync call sites.
 */
export function checkQuota(sessionId: string): QuotaState {
  return checkQuotaSync(sessionId);
}

/**
 * Increment quota — delegates to persistent store.
 * Made async for DB persistence.
 */
export async function incrementQuota(sessionId: string, userId?: string): Promise<void> {
  await incrementQuotaPersistent(sessionId, userId);
}

export function resetSessionQuotasForTests(): void {
  resetQuotasInternal();
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

export class ChatRateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Chat rate limit exceeded');
    this.name = 'ChatRateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// ============================================================
// INTENT DETECTION
// ============================================================

/** Keyword map for intent detection — no LLM, pure pattern matching */
const INTENT_KEYWORD_MAP: Record<string, string[]> = {
  food_assistance:    ['food', 'hungry', 'meal', 'pantry', 'snap', 'ebt', 'nutrition', 'groceries', 'hunger'],
  housing:            ['housing', 'shelter', 'eviction', 'rent', 'homeless', 'house', 'apartment', 'landlord'],
  mental_health:      ['therapy', 'counseling', 'mental', 'anxiety', 'depression', 'psychiatr', 'stress', 'emotional'],
  healthcare:         ['healthcare', 'doctor', 'clinic', 'medical', 'prescription', 'insurance', 'health', 'hospital', 'dental'],
  employment:         ['job', 'find work', 'looking for work', 'need work', 'out of work', 'unemployment', 'unemployed', 'career', 'resume', 'hire', 'employment', 'training'],
  childcare:          ['childcare', 'daycare', 'after school', 'babysit', 'preschool', 'child care'],
  transportation:     ['bus', 'ride', 'transit', 'car', 'transportation', 'driving', 'vehicle'],
  legal_aid:          ['legal', 'lawyer', 'attorney', 'court', 'evict', 'civil', 'rights', 'immigration'],
  utility_assistance: ['electric', 'gas', 'water', 'utility', 'bill', 'power', 'heat', 'lights'],
  substance_use:      ['addiction', 'substance', 'detox', 'rehab', 'recovery', 'sober', 'alcohol', 'opioid', 'overdose', 'methadone', 'suboxone', 'narcotics'],
  domestic_violence:  ['domestic violence', 'abusive', 'abuser', 'restraining order', 'protective order', 'safe house', 'stalking', 'partner violence', 'unsafe at home', 'batterer'],
  education:          ['ged', 'school', 'education', 'tutoring', 'literacy', 'esl', 'english class', 'diploma', 'adult education', 'college'],
};

const INTENT_STEM_KEYWORDS = new Set(['evict', 'psychiatr']);
const INTENT_SPECIAL_KEYWORD_PATTERNS: Record<string, string> = {
  electric: 'electric(?:ity|al)?',
  homeless: 'homeless(?:ness)?',
};

function matchesIntentKeyword(message: string, keyword: string): boolean {
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let keywordPattern = escapedKeyword;
  if (INTENT_STEM_KEYWORDS.has(keyword)) {
    keywordPattern = `${escapedKeyword}[a-z]*`;
  } else if (INTENT_SPECIAL_KEYWORD_PATTERNS[keyword]) {
    keywordPattern = INTENT_SPECIAL_KEYWORD_PATTERNS[keyword];
  } else if (/[^aeiou]y$/i.test(keyword)) {
    keywordPattern = `${escapedKeyword.slice(0, -1)}(?:y|ies)`;
  } else if (keyword === 'bus') {
    keywordPattern = 'bus(?:es)?';
  } else if (!keyword.endsWith('s')) {
    keywordPattern = `${escapedKeyword}s?`;
  }
  return new RegExp(`\\b${keywordPattern}\\b`, 'i').test(message);
}

/**
 * Detects the intent category from a user message.
 * Uses keyword matching — no LLM, no ML.
 */
export function detectIntent(message: string): Intent {
  const normalized = message.toLowerCase();

  let bestCategory = 'general';
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(INTENT_KEYWORD_MAP)) {
    const score = keywords.filter((kw) => matchesIntentKeyword(normalized, kw)).length;
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  // Detect urgency
  const urgencyText = normalized
    .replace(/\b(?:not(?:\s+(?:very|that))?|no longer|no)\s+(?:an?\s+)?(?:urgent|emergency|immediate)\b/g, '')
    .replace(/\bnot\s+(?:right\s+)?now\b/g, '');
  const isUrgent = [
    /\burgent(?:ly)?\b/,
    /\bemergency\b/,
    /\bimmediate(?:ly)?\b/,
    /\btoday\b/,
    /\bnow\b/,
    /\basap\b/,
    /\bright now\b/,
  ].some((pattern) => pattern.test(urgencyText));

  // Detect action qualifier (used for contextual link selection)
  const actionRules: Array<{ action: Intent['actionQualifier']; keywords: string[] }> = [
    {
      action: 'apply',
      keywords: ['apply', 'application', 'enroll', 'enrollment', 'sign up', 'register', 'intake form', 'intake'],
    },
    {
      action: 'eligibility',
      keywords: ['eligible', 'eligibility', 'qualify', 'qualification', 'requirements', 'who can', 'criteria'],
    },
    {
      action: 'contact',
      keywords: ['contact', 'call', 'phone', 'email', 'reach', 'talk to', 'speak to'],
    },
    {
      action: 'hours',
      keywords: ['hours', 'open', 'close', 'when are you open', 'when is it open', 'schedule'],
    },
    {
      action: 'website',
      keywords: ['website', 'link', 'url', 'webpage', 'site'],
    },
  ];

  let actionQualifier: Intent['actionQualifier'] | undefined;
  for (const rule of actionRules) {
    if (rule.keywords.some((kw) => normalized.includes(kw))) {
      actionQualifier = rule.action;
      break;
    }
  }

  return {
    category: bestCategory as (typeof INTENT_CATEGORIES)[number],
    rawQuery: message,
    actionQualifier,
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
    locale: 'en',
    messageCount: quota.messageCount,
    // Profile hydration runs in route.ts via the hydrateContext dependency
    // (chatHydration.ts queries user_profiles + seeker_profiles and merges all
    // preference signals before orchestrateChat is called — this minimal context
    // is a fallback baseline only for unauthenticated sessions)
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
  options?: {
    llmSummarized?: boolean;
    retrievalStatus?: ChatRetrievalStatus;
    effectiveSearchText?: string;
    locationBiasApplied?: boolean;
    searchBroadened?: boolean;
    searchInterpretation?: SearchInterpretation;
    activeContextUsed?: boolean;
  }
): ChatResponse {
  const quota = checkQuota(context.sessionId);
  const diversified = diversifyServices(services, MAX_SERVICES_PER_RESPONSE);
  const cards: ServiceCard[] = diversified.services
    .map((s) => enrichedServiceToCard(s, { intent, context }));

  const retrievalStatus = options?.retrievalStatus ?? (services.length > 0 ? 'results' : 'no_match');
  const message = buildResponseMessage(
    retrievalStatus,
    intent,
    cards.length,
    options?.searchBroadened ?? false,
  );

  return {
    message,
    resultSummary: buildResultSummary(retrievalStatus, intent, diversified.services, context, {
      activeContextUsed: options?.activeContextUsed ?? false,
      diversified: diversified.diversified,
      locationBiasApplied: options?.locationBiasApplied ?? false,
    }),
    services: cards,
    isCrisis: false,
    intent,
    sessionId: context.sessionId,
    quotaRemaining: quota.remaining,
    eligibilityDisclaimer: ELIGIBILITY_DISCLAIMER,
    llmSummarized: options?.llmSummarized ?? false,
    retrievalStatus,
    effectiveSearchText: options?.effectiveSearchText,
    locationBiasApplied: options?.locationBiasApplied,
    searchBroadened: options?.searchBroadened,
    searchInterpretation: options?.searchInterpretation,
    followUpSuggestions: buildFollowUpSuggestions(retrievalStatus, intent, context),
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

export function assembleOutOfScopeResponse(
  intent: Intent,
  context: ChatContext
): ChatResponse {
  const quota = checkQuota(context.sessionId);

  return {
    message:
      'I’m ORAN Chat. I only help navigate publication-gated services from stored ORAN records, so I can’t answer unrelated, off-brand, or inappropriate requests. If you need help finding services, tell me the need, such as housing, food, healthcare, mental health, transportation, childcare, employment, legal help, or utility assistance.',
    services: [],
    isCrisis: false,
    intent,
    sessionId: context.sessionId,
    quotaRemaining: quota.remaining,
    eligibilityDisclaimer: ELIGIBILITY_DISCLAIMER,
    llmSummarized: false,
    retrievalStatus: 'out_of_scope',
    activeContextUsed: false,
    sessionContext: buildSessionContext(intent, context),
    searchInterpretation: buildSearchInterpretation(intent, context, { activeContextUsed: false, sessionSignals: [] }),
  };
}

function assembleClarificationResponse(
  intent: Intent,
  context: ChatContext,
  clarification: ChatResponse['clarification'],
  options?: {
    activeContextUsed?: boolean;
    sessionSignals?: string[];
  },
): ChatResponse {
  const quota = checkQuota(context.sessionId);

  return {
    message: clarification?.prompt ?? 'Tell me more so I can search the service catalog accurately.',
    services: [],
    isCrisis: false,
    intent,
    sessionId: context.sessionId,
    quotaRemaining: quota.remaining,
    eligibilityDisclaimer: ELIGIBILITY_DISCLAIMER,
    llmSummarized: false,
    retrievalStatus: 'clarification_required',
    activeContextUsed: options?.activeContextUsed ?? false,
    sessionContext: buildSessionContext(intent, context),
    searchInterpretation: buildSearchInterpretation(intent, context, {
      activeContextUsed: options?.activeContextUsed ?? false,
      sessionSignals: options?.sessionSignals ?? [],
    }),
    clarification,
  };
}

function formatIntentCategoryLabel(category: Intent['category']): string {
  return category === 'general' ? 'general help' : category.replace(/_/g, ' ');
}

function formatActionLabel(action: Intent['actionQualifier']): string | null {
  switch (action) {
    case 'apply':
      return 'application details prioritized';
    case 'contact':
      return 'contact details prioritized';
    case 'eligibility':
      return 'eligibility details prioritized';
    case 'hours':
      return 'hours information prioritized';
    case 'website':
      return 'website links prioritized';
    default:
      return null;
  }
}

function buildProfileSignalSummary(context: ChatContext, intent: Intent): string[] {
  const profile = context.userProfile;
  if (!profile || !shouldUseSavedSeekerProfile(context)) {
    return [];
  }

  const signals: string[] = [];

  if (profile.locationCity && !context.sessionContext?.activeLocation) {
    signals.push('saved location preference requested');
  }

  if (intent.category === 'general' && !context.retrievalText && (profile.serviceInterests?.length ?? 0) > 0) {
    signals.push('saved service interests used');
  }

  const discoveryProfile = buildSeekerDiscoveryProfile(profile, { locale: context.locale });
  const sessionUrgencyWindow = context.sessionContext?.urgencyWindow;
  if (
    !sessionUrgencyWindow
    && (profile.urgencyWindow === 'same_day' || profile.urgencyWindow === 'next_day')
  ) {
    signals.push('saved urgency preference used');
  }
  if (profile.transportationBarrier) {
    signals.push('saved transportation preference used');
  }
  const hasExplicitDeliveryPreference = Boolean(
    context.sessionContext
    && Object.prototype.hasOwnProperty.call(context.sessionContext, 'preferredDeliveryModes'),
  );
  if (
    !hasExplicitDeliveryPreference
    && (profile.preferredDeliveryModes?.length ?? 0) > 0
  ) {
    signals.push('saved delivery preferences used');
  }
  if (profile.accessibilityNeeds?.includes('language_interpretation') || context.locale !== 'en') {
    signals.push('saved language preference used');
  }

  if (!discoveryProfile.profileSignals && signals.length === 0) {
    return [];
  }

  return Array.from(new Set(signals)).slice(0, 4);
}

function formatNeedLabel(needId: string): string {
  return needId.replace(/_/g, ' ');
}

function buildSessionSignalSummary(signals: string[]): string[] {
  return Array.from(new Set(signals)).slice(0, 4);
}

function buildCurrentSearchSignalSummary(context: ChatContext): string[] {
  const sessionContext = context.sessionContext;
  if (!sessionContext) return [];

  const signals: string[] = [];
  const location = sessionContext.activeLocation;
  const locationLabel = location?.postalCode
    ?? (location?.city
      ? [location.city, location.stateProvince].filter(Boolean).join(', ')
      : undefined);
  if (locationLabel) signals.push(`Location: ${locationLabel}`);
  if (sessionContext.activeGeo) signals.push(`Distance area: ${sessionContext.activeGeo.radiusMiles} mi`);
  if (sessionContext.urgencyWindow) signals.push(`Timing: ${formatNeedLabel(sessionContext.urgencyWindow)}`);
  if (sessionContext.audience) signals.push(`For: ${formatNeedLabel(sessionContext.audience)}`);
  if (sessionContext.accessMode) signals.push(`Access: ${formatNeedLabel(sessionContext.accessMode)}`);
  if (
    !sessionContext.accessMode
    && Object.prototype.hasOwnProperty.call(sessionContext, 'preferredDeliveryModes')
  ) {
    const deliveryModes = sessionContext.preferredDeliveryModes ?? [];
    signals.push(deliveryModes.length > 0
      ? `Access: ${deliveryModes.map(formatNeedLabel).join(', ')}`
      : 'Access: no delivery-mode restriction');
  }

  return signals;
}

function buildSearchInterpretation(
  intent: Intent,
  context: ChatContext,
  options: {
    activeContextUsed: boolean;
    sessionSignals: string[];
  },
): SearchInterpretation {
  const summaryParts = [`Interpreted as ${formatIntentCategoryLabel(intent.category)}`];
  if (intent.urgencyQualifier === 'urgent') {
    summaryParts.push('urgent');
  }

  const actionLabel = formatActionLabel(intent.actionQualifier);
  if (actionLabel) {
    summaryParts.push(actionLabel);
  }

  const profileSignals = buildProfileSignalSummary(context, intent);
  const sessionSignals = buildSessionSignalSummary([
    ...options.sessionSignals,
    ...buildCurrentSearchSignalSummary(context),
  ]);

  return {
    category: intent.category,
    categoryLabel: formatIntentCategoryLabel(intent.category),
    urgencyQualifier: intent.urgencyQualifier,
    actionQualifier: intent.actionQualifier,
    summary: summaryParts.join(', '),
    usedSessionContext: options.activeContextUsed || sessionSignals.length > 0,
    sessionSignals,
    usedProfileShaping: profileSignals.length > 0,
    ignoredProfileShaping: Boolean(context.profileShapingDisabled),
    profileSignals,
  };
}

function buildResponseMessage(
  retrievalStatus: ChatRetrievalStatus,
  intent: Intent,
  cardCount: number,
  searchBroadened: boolean,
): string {
  switch (retrievalStatus) {
    case 'results':
      if (searchBroadened) {
        return `I could not find an exact catalog match, so I found ${cardCount} broader ${intent.category.replace('_', ' ')} service${cardCount !== 1 ? 's' : ''} that may help.`;
      }
      return `I found ${cardCount} service${cardCount !== 1 ? 's' : ''} that may help with your ${intent.category.replace('_', ' ')} needs.`;
    case 'catalog_empty_for_scope':
      return 'I could not find services in the current database for this search scope yet. Try broadening the filters or contact 211 for local assistance.';
    case 'temporarily_unavailable':
      return 'Search is temporarily unavailable right now. Please try again in a few minutes, or contact 211 for local assistance.';
    case 'clarification_required':
      return 'I need one more detail before I can search the catalog accurately.';
    case 'no_match':
    default:
      return 'I could not find a close match for that request in the current database. Try rephrasing, broadening the filters, or contact 211 for local assistance.';
  }
}

function getOrganizationId(service: EnrichedService): string {
  return service.organization.id;
}

function hasAttributeTag(service: EnrichedService, tags: string[]): boolean {
  return service.attributes?.some((attribute) => tags.includes(attribute.tag)) ?? false;
}

function diversifyServices(
  services: EnrichedService[],
  maxServices: number,
): {
  services: EnrichedService[];
  diversified: boolean;
} {
  const seenServiceIds = new Set<string>();
  const organizationCounts = new Map<string, number>();
  const firstPass: EnrichedService[] = [];
  const deferred: EnrichedService[] = [];

  for (const service of services) {
    if (seenServiceIds.has(service.service.id)) {
      continue;
    }
    seenServiceIds.add(service.service.id);

    const organizationId = getOrganizationId(service);
    const organizationCount = organizationCounts.get(organizationId) ?? 0;
    if (organizationCount === 0 && firstPass.length < maxServices) {
      firstPass.push(service);
      organizationCounts.set(organizationId, 1);
      continue;
    }

    deferred.push(service);
  }

  for (const service of deferred) {
    if (firstPass.length >= maxServices) {
      break;
    }

    const organizationId = getOrganizationId(service);
    const organizationCount = organizationCounts.get(organizationId) ?? 0;
    if (organizationCount >= 2) {
      continue;
    }

    firstPass.push(service);
    organizationCounts.set(organizationId, organizationCount + 1);
  }

  for (const service of deferred) {
    if (firstPass.length >= maxServices || firstPass.some((candidate) => candidate.service.id === service.service.id)) {
      continue;
    }

    firstPass.push(service);
  }

  const baseline = services.slice(0, maxServices).map((service) => service.service.id);
  const diversifiedIds = firstPass.map((service) => service.service.id);

  return {
    services: firstPass,
    diversified: diversifiedIds.join(',') !== baseline.join(','),
  };
}

function buildResultSummary(
  retrievalStatus: ChatRetrievalStatus,
  intent: Intent,
  services: EnrichedService[],
  context: ChatContext,
  options: {
    activeContextUsed: boolean;
    diversified: boolean;
    locationBiasApplied: boolean;
  },
): string | undefined {
  const activeGeo = context.sessionContext?.activeGeo;
  const approximateLocation = context.approximateLocation
    ?? context.sessionContext?.activeLocation;
  const location = approximateLocation?.postalCode
    ?? (approximateLocation?.city
      ? [approximateLocation.city, approximateLocation.stateProvince].filter(Boolean).join(', ')
      : undefined)
    ?? context.sessionContext?.activeCity
    ?? (shouldUseSavedSeekerProfile(context) ? context.userProfile?.locationCity : undefined);

  if (retrievalStatus !== 'results' || services.length === 0) {
    if (retrievalStatus === 'no_match' || retrievalStatus === 'catalog_empty_for_scope') {
      if (activeGeo) {
        return `The search used your selected ${activeGeo.radiusMiles}-mile distance area${options.activeContextUsed ? ' and kept your other active chat preferences in place' : ''}.`;
      }
      return location
        ? options.locationBiasApplied
          ? `The search used ${location} as a distance tie-breaker${options.activeContextUsed ? ' and kept your active chat preferences in place' : ''}.`
          : `The catalog could not resolve ${location} to a published service location, so it did not change distance ordering${options.activeContextUsed ? '; your other active chat preferences stayed in place' : ''}.`
        : options.activeContextUsed
          ? 'The search kept your active chat preferences in place.'
          : undefined;
    }

    return undefined;
  }

  const organizationCount = new Set(services.map((service) => getOrganizationId(service))).size;
  const highConfidenceCount = services.filter((service) => (service.confidenceScore?.verificationConfidence ?? 0) >= 80).length;
  const urgentAvailabilityCount = services.filter((service) => hasAttributeTag(service, ['same_day', 'next_day', 'weekend_hours', 'evening_hours'])).length;
  const parts = [
    `Showing ${services.length} service${services.length !== 1 ? 's' : ''} from ${organizationCount} organization${organizationCount !== 1 ? 's' : ''}`,
  ];

  if (activeGeo) {
    parts.push(`used your selected ${activeGeo.radiusMiles}-mile distance area`);
  } else if (location && options.locationBiasApplied) {
    parts.push(`used ${location} as a distance tie-breaker`);
  } else if (location) {
    parts.push(`could not resolve ${location} for distance ordering`);
  }

  if (highConfidenceCount > 0) {
    parts.push(`${highConfidenceCount} high-confidence match${highConfidenceCount !== 1 ? 'es' : ''}`);
  }

  if (intent.urgencyQualifier === 'urgent' && urgentAvailabilityCount > 0) {
    parts.push(`${urgentAvailabilityCount} mention same-day or extended-hour availability`);
  }

  if (options.activeContextUsed) {
    parts.push('kept the active chat preferences in place');
  }

  if (options.diversified) {
    parts.push('kept the set varied across organizations');
  }

  return `${parts.join('. ')}.`;
}

function buildFollowUpSuggestions(
  retrievalStatus: ChatRetrievalStatus,
  intent: Intent,
  context: ChatContext,
): string[] {
  if (retrievalStatus === 'clarification_required' || retrievalStatus === 'out_of_scope') {
    return [];
  }

  const byCategory: Partial<Record<Intent['category'], string[]>> = {
    food_assistance: ['Open today', 'No ID required food help', 'Phone support only', 'Food pantry near me'],
    housing: ['Shelter tonight', 'Help paying rent', 'Same-day housing help', 'Walk-in housing help'],
    mental_health: ['Walk-in mental health care', 'Phone counseling', 'Help tonight', 'Support groups'],
    healthcare: ['Free or low-cost care', 'Weekend clinic hours', 'Phone support only', 'Interpreter support'],
    employment: ['Job training', 'Resume help', 'Same-day employment help', 'Virtual services'],
    childcare: ['Childcare today', 'Child-friendly services', 'Low-cost childcare', 'Phone support only'],
    transportation: ['Ride assistance', 'Same-day transportation help', 'Phone support only', 'Accessible transport'],
    legal_aid: ['Legal help today', 'Phone legal advice', 'Housing legal help', 'Immigration legal help'],
    utility_assistance: ['Help paying utilities', 'Same-day utility help', 'Phone support only', 'No documentation required'],
    general: ['Help paying rent', 'Food pantry near me', 'Mental health support', 'Free or low-cost healthcare'],
  };

  const suggestions = [...(byCategory[intent.category] ?? byCategory.general ?? [])];
  if (retrievalStatus === 'no_match' || retrievalStatus === 'catalog_empty_for_scope') {
    suggestions.unshift('Show all trust levels');
  }

  if (context.sessionContext?.preferredDeliveryModes?.includes('phone') || context.sessionContext?.attributeFilters?.delivery?.includes('phone')) {
    return suggestions.filter((suggestion) => suggestion !== 'Phone support only').slice(0, 4);
  }

  return Array.from(new Set(suggestions)).slice(0, 4);
}

function normalizeApproximateLocation(
  location: ChatContext['approximateLocation'] | undefined,
): ChatContext['approximateLocation'] | undefined {
  if (!location) return undefined;

  const city = location.city?.trim().replace(/\s+/g, ' ') || undefined;
  const postalCode = location.postalCode?.match(/^\d{5}$/)?.[0];
  const stateProvince = location.stateProvince?.trim().replace(/\s+/g, ' ') || undefined;
  if (!city && !postalCode) return undefined;

  return { city, postalCode, stateProvince };
}

function extractApproximateLocationFromMessage(
  message: string,
): ChatContext['approximateLocation'] | undefined {
  const postalCode = Array.from(
    message.matchAll(/\b(?:in|near)\s+(\d{5})(?:-\d{4})?\b/gi),
  ).at(-1)?.[1];
  if (postalCode) return { postalCode };

  const markers = Array.from(message.matchAll(/\b(in|near)\s+/gi)).reverse();
  const trailingContext = /\s+(?=(?:(?:and|but)\s+)?(?:that\b|who\b|which\b|with\b|open\b|available\b|today\b|right now\b|immediately\b|this week\b|within\b|for me\b|for my\b|i need\b|i can\b|i cannot\b|this is\b|please\b))/i;
  const formatCity = (value: string) => value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (segment) => segment.toUpperCase());

  for (const marker of markers) {
    const markerEnd = (marker.index ?? 0) + marker[0].length;
    const tail = message.slice(markerEnd).trim();
    const stateQualifiedMatch = tail.match(
      /^([a-z][a-z\s.'-]{1,60}?),\s*([a-z]{2})(?=\s+(?:(?:and|but)\s+)?(?:that\b|who\b|which\b|with\b|open\b|available\b|today\b|right now\b|immediately\b|this week\b|within\b|for me\b|for my\b|i need\b|i can\b|i cannot\b|this is\b|please\b)|[!?]|\.(?:\s|$)|$)/i,
    );
    if (stateQualifiedMatch?.[1] && stateQualifiedMatch[2]) {
      return {
        city: formatCity(stateQualifiedMatch[1]),
        stateProvince: stateQualifiedMatch[2].toUpperCase(),
      };
    }

    // City-only phrases are accepted after "near" and resolved later against
    // publication-gated catalog locations. "in" remains state-qualified so
    // phrases such as "in person" and "in need" are never promoted.
    if (marker[1]?.toLowerCase() !== 'near') continue;
    const contextIndex = tail.search(trailingContext);
    const cityOnly = (contextIndex >= 0 ? tail.slice(0, contextIndex) : tail)
      .replace(/[.!?]+$/, '')
      .trim()
      .replace(/\s+/g, ' ');
    if (
      !/^[a-z][a-z\s.'-]{0,59}$/i.test(cityOnly)
      || ['me', 'here', 'my area', 'the area', 'home', 'work', 'my work', 'my workplace'].includes(cityOnly.toLowerCase())
    ) {
      continue;
    }

    return { city: formatCity(cityOnly) };
  }

  return undefined;
}

function extractUrgencyWindowFromMessage(
  message: string,
): ChatSessionContext['urgencyWindow'] | undefined {
  const candidates: Array<{
    index: number;
    urgencyWindow: NonNullable<ChatSessionContext['urgencyWindow']>;
  }> = [];
  const collect = (
    pattern: RegExp,
    urgencyWindow: NonNullable<ChatSessionContext['urgencyWindow']>,
    options?: { skipNegatedUrgent?: boolean },
  ) => {
    for (const match of message.matchAll(pattern)) {
      const index = match.index ?? -1;
      if (
        options?.skipNegatedUrgent
        && /\b(?:not(?:\s+(?:very|that))?|no longer)\s*$/i.test(message.slice(0, index))
      ) {
        continue;
      }
      candidates.push({ index, urgencyWindow });
    }
  };

  collect(/\b(planning ahead|plan(?:ning)? for later|not(?: very| that)? urgent|no longer urgent|future need)\b/gi, 'planning');
  collect(/\b(today|right now|immediately|as soon as possible|emergency)\b/gi, 'today');
  collect(/\burgent(?:ly)?\b/gi, 'today', { skipNegatedUrgent: true });
  collect(/\b(within (?:the )?next few days|within days|next few days|this week|in a few days)\b/gi, 'within_days');

  return candidates.sort((left, right) => right.index - left.index)[0]?.urgencyWindow;
}

function normalizeSessionContext(sessionContext: ChatSessionContext | undefined): ChatSessionContext | undefined {
  if (!sessionContext) {
    return undefined;
  }

  const hasExplicitDeliveryPreference = Object.prototype.hasOwnProperty.call(
    sessionContext,
    'preferredDeliveryModes',
  );

  const normalized: ChatSessionContext = {
    ...sessionContext,
    activeRetrievalText: sessionContext.activeRetrievalText?.trim() || undefined,
    activeCity: sessionContext.activeCity?.trim() || undefined,
    activeLocation: normalizeApproximateLocation(sessionContext.activeLocation),
    taxonomyTermIds: sessionContext.taxonomyTermIds?.filter(Boolean),
    attributeFilters: sessionContext.attributeFilters,
    profileShapingEnabled: sessionContext.profileShapingEnabled,
    ...(hasExplicitDeliveryPreference
      ? { preferredDeliveryModes: sessionContext.preferredDeliveryModes?.filter(Boolean) ?? [] }
      : {}),
  };

  const hasMeaningfulContext = Boolean(
    normalized.activeNeedId
    || normalized.activeRetrievalText
    || normalized.activeCity
    || normalized.activeLocation
    || normalized.activeGeo
    || normalized.urgency
    || normalized.urgencyWindow
    || normalized.audience
    || normalized.accessMode
    || hasExplicitDeliveryPreference
    || normalized.preferredDeliveryModes?.length
    || (normalized.trustFilter && normalized.trustFilter !== 'all')
    || normalized.taxonomyTermIds?.length
    || Object.keys(normalized.attributeFilters ?? {}).length > 0,
  );

  if (!hasMeaningfulContext && normalized.profileShapingEnabled) {
    return undefined;
  }

  return normalized;
}

function buildSessionContext(intent: Intent, context: ChatContext): ChatSessionContext | undefined {
  const current = normalizeSessionContext(context.sessionContext);
  const hasExplicitDeliveryPreference = Boolean(
    context.sessionContext
    && Object.prototype.hasOwnProperty.call(context.sessionContext, 'preferredDeliveryModes'),
  );
  const explicitLocation = extractApproximateLocationFromMessage(intent.rawQuery);
  const explicitUrgencyWindow = extractUrgencyWindowFromMessage(intent.rawQuery);
  const explicitCity = explicitLocation?.city;
  const activeNeedId = intent.category === 'general'
    ? context.retrievalText ? undefined : current?.activeNeedId
    : intent.category;
  const activeRetrievalText = context.retrievalText?.trim()
    || (intent.category === 'general' ? current?.activeRetrievalText : undefined);
  const activeCity = explicitLocation
    ? explicitCity
    : current?.activeLocation
      ? current.activeLocation.city
      : current?.activeCity ?? context.approximateLocation?.city;
  const activeLocation = explicitLocation
    ?? current?.activeLocation
    ?? normalizeApproximateLocation(context.approximateLocation)
    ?? (activeCity ? { city: activeCity } : undefined);
  const preferredDeliveryModes = hasExplicitDeliveryPreference
    ? current?.preferredDeliveryModes ?? []
    : shouldUseSavedSeekerProfile(context) && context.userProfile?.preferredDeliveryModes?.length
      ? context.userProfile.preferredDeliveryModes
      : undefined;
  const shouldPersistDeliveryPreference = hasExplicitDeliveryPreference
    || Boolean(preferredDeliveryModes?.length);
  const effectiveUrgencyWindow = explicitUrgencyWindow ?? current?.urgencyWindow;

  return normalizeSessionContext({
    activeNeedId,
    activeRetrievalText,
    activeCity,
    activeLocation,
    activeGeo: explicitLocation ? undefined : current?.activeGeo,
    urgency: effectiveUrgencyWindow
      ? effectiveUrgencyWindow === 'today' ? 'urgent' : 'standard'
      : intent.urgencyQualifier === 'urgent' ? 'urgent' : current?.urgency,
    urgencyWindow: effectiveUrgencyWindow,
    audience: current?.audience,
    accessMode: current?.accessMode,
    ...(shouldPersistDeliveryPreference ? { preferredDeliveryModes } : {}),
    trustFilter: current?.trustFilter,
    taxonomyTermIds: current?.taxonomyTermIds,
    attributeFilters: current?.attributeFilters,
    profileShapingEnabled: !context.profileShapingDisabled,
  });
}

function applySessionContext(intent: Intent, context: ChatContext): {
  intent: Intent;
  context: ChatContext;
  activeContextUsed: boolean;
  sessionSignals: string[];
} {
  const sessionContext = normalizeSessionContext(context.sessionContext);
  const explicitLocation = extractApproximateLocationFromMessage(intent.rawQuery);
  const explicitUrgencyWindow = extractUrgencyWindowFromMessage(intent.rawQuery);
  if (!sessionContext) {
    const nextSessionContext: ChatSessionContext | undefined = explicitLocation || explicitUrgencyWindow
      ? {
          ...(explicitLocation
            ? {
                activeCity: explicitLocation.city,
                activeLocation: explicitLocation,
              }
            : {}),
          ...(explicitUrgencyWindow
            ? {
                urgency: explicitUrgencyWindow === 'today' ? 'urgent' : 'standard',
                urgencyWindow: explicitUrgencyWindow,
              }
            : {}),
          profileShapingEnabled: !context.profileShapingDisabled,
        }
      : undefined;
    const nextContext: ChatContext = {
      ...context,
      ...(explicitLocation ? { approximateLocation: explicitLocation } : {}),
      ...(nextSessionContext ? { sessionContext: nextSessionContext } : {}),
    };
    return {
      intent: explicitUrgencyWindow
        ? {
            ...intent,
            urgencyQualifier: explicitUrgencyWindow === 'today' ? 'urgent' : 'standard',
          }
        : intent,
      context: nextContext,
      activeContextUsed: false,
      sessionSignals: [],
    };
  }

  let nextIntent = intent;
  let nextContext = {
    ...context,
    sessionContext,
  };
  const sessionSignals: string[] = [];
  let activeContextUsed = false;

  if (explicitUrgencyWindow) {
    nextContext = {
      ...nextContext,
      sessionContext: {
        ...sessionContext,
        urgency: explicitUrgencyWindow === 'today' ? 'urgent' : 'standard',
        urgencyWindow: explicitUrgencyWindow,
      },
    };
  }
  if (intent.category === 'general' && !context.retrievalText) {
    const inheritedRetrievalText = sessionContext.activeRetrievalText
      ?? (sessionContext.activeNeedId
        ? getDiscoveryNeedSearchText(sessionContext.activeNeedId)
        : undefined);
    if (sessionContext.activeNeedId) {
      nextIntent = {
        ...intent,
        category: sessionContext.activeNeedId,
      };
    }
    if (inheritedRetrievalText) {
      nextContext = {
        ...nextContext,
        retrievalText: inheritedRetrievalText,
      };
      activeContextUsed = true;
      sessionSignals.push(sessionContext.activeNeedId
        ? `Need: ${formatNeedLabel(sessionContext.activeNeedId)}`
        : 'Need: previous request');
    }
  }

  if (explicitLocation) {
    nextContext = {
      ...nextContext,
      approximateLocation: explicitLocation,
      sessionContext: {
        ...nextContext.sessionContext,
        activeCity: explicitLocation.city,
        activeLocation: explicitLocation,
        activeGeo: undefined,
      },
    };
  }

  const activeLocation = sessionContext.activeLocation
    ?? (sessionContext.activeCity ? { city: sessionContext.activeCity } : undefined);
  if (activeLocation && !explicitLocation && !context.approximateLocation) {
    nextContext = {
      ...nextContext,
      approximateLocation: activeLocation,
    };
    activeContextUsed = true;
    const locationLabel = activeLocation.postalCode
      ?? [activeLocation.city, activeLocation.stateProvince].filter(Boolean).join(', ');
    sessionSignals.push(`Location: ${locationLabel}`);
  }

  const effectiveUrgencyWindow = nextContext.sessionContext?.urgencyWindow;
  if (effectiveUrgencyWindow) {
    nextIntent = {
      ...nextIntent,
      urgencyQualifier: effectiveUrgencyWindow === 'today' ? 'urgent' : 'standard',
    };
  }

  return {
    intent: nextIntent,
    context: nextContext,
    activeContextUsed,
    sessionSignals,
  };
}

function shouldClarifyWeakQuery(message: string, intent: Intent, context: ChatContext): boolean {
  if (intent.category !== 'general') {
    return false;
  }

  if (normalizeSessionContext(context.sessionContext)?.activeNeedId) {
    return false;
  }

  if (isOutOfScopeRequest(message, intent)) {
    return false;
  }

  const normalized = message.trim().toLowerCase();
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;

  if (wordCount <= 2) {
    // Guided intake need text has already passed strict non-empty validation.
    // Let specific short needs ("birth certificate", "internet access") reach
    // retrieval while continuing to clarify genuinely content-free answers.
    if (context.retrievalText) {
      return /^(?:help|support|assistance|resources?|near me|open today)$/i.test(normalized);
    }
    return true;
  }

  return [
    /\b(anything open today|what is open today|open today)\b/i,
    /\b(i need help|need help|help me|support|assistance|resources)\b/i,
    /\bnear me\b/i,
  ].some((pattern) => pattern.test(normalized));
}

const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /\b(weather|temperature|forecast)\b/i,
  /\b(stock price|stocks|crypto|bitcoin|market news)\b/i,
  /\b(tell me a joke|write a poem|write a story|tell me a story)\b/i,
  /\b(write code|debug this code|python code|javascript code|typescript code)\b/i,
  /\b(system prompt|prompt injection|ignore previous instructions|what model are you|who are you)\b/i,
  /\b(translate this|summarize this article|capital of|sports score|recipe)\b/i,
  /\b(porn|porno|erotic|sex chat|sexual roleplay|nudes|onlyfans|hookup advice|dating advice)\b/i,
  /\b(hack(ing)?|malware|phishing|ransomware|ddos|steal passwords|fake id|forged documents|make a bomb|build a weapon|buy a gun illegally)\b/i,
];

function isOutOfScopeRequest(message: string, intent: Intent): boolean {
  if (intent.category !== 'general') {
    return false;
  }

  return OUT_OF_SCOPE_PATTERNS.some((pattern) => pattern.test(message));
}

// ============================================================
// MAIN ORCHESTRATOR
// ============================================================

export interface OrchestratorDeps {
  /** Fetch services from DB based on intent and context — pure SQL, no LLM */
  retrieveServices: (intent: Intent, context: ChatContext) => Promise<ChatRetrievalResult>;
  /** Check if a feature flag is enabled */
  isFlagEnabled: (flagName: string) => Promise<boolean>;
  /** Optional: server-side profile hydration for authenticated users. Must fail open. */
  hydrateContext?: (context: ChatContext) => Promise<ChatContext>;
  /** Optional: LLM summarization — only called if flag enabled, only summarizes retrieved records */
  summarizeWithLLM?: (services: EnrichedService[], intent: Intent) => Promise<string>;
  /** Optional: LLM intent enrichment — only called for 'general' fallback queries, if flag enabled */
  enrichIntent?: (message: string, intent: Intent) => Promise<Intent>;
  /** Optional semantic safety override for deterministic tests. */
  checkSemanticCrisis?: (message: string) => Promise<boolean>;
}

/**
 * Main chat orchestrator. Implements the full pipeline.
 */
export async function orchestrateChat(
  message: string,
  sessionId: string,
  userId: string | undefined,
  locale: string,
  rateLimitKey: string,
  deps: OrchestratorDeps
): Promise<ChatResponse> {
  const crisisScope = classifyCrisisScope(message);

  // Stage 1a: Crisis detection (keyword gate) — always first, always takes priority
  if (crisisScope === 'self' && detectCrisis(message)) {
    const intent = detectIntent(message);
    return assembleCrisisResponse(intent, sessionId);
  }

  // Stage 1b: Content Safety semantic crisis gate (second layer, async)
  // Runs only when: (a) flag enabled AND (b) local distress signals found in the message.
  // Uses Azure AI Content Safety SelfHarm severity classification.
  // FAIL-OPEN: any API error is swallowed and pipeline continues normally.
  // Cost: calls the API only when hasDistressSignals() → true (<5% of messages).
  const contentSafetyEnabled = await deps.isFlagEnabled(FEATURE_FLAGS.CONTENT_SAFETY_CRISIS);
  if (crisisScope === 'self' && contentSafetyEnabled && hasDistressSignals(message)) {
    const isCrisisBySemantic = await (deps.checkSemanticCrisis ?? checkCrisisContentSafety)(message);
    if (isCrisisBySemantic) {
      const intent = detectIntent(message);
      return assembleCrisisResponse(intent, sessionId);
    }
  }

  // Stage 2: Quota check (DB-backed when configured, in-memory fallback)
  const quota = await checkQuotaPersistent(sessionId);
  if (quota.exceeded) {
    const intent = detectIntent(message);
    return {
      message: `You've reached the current message limit (${MAX_CHAT_QUOTA} messages). Start a new chat session or continue in Directory or Map with the same search scope.`,
      services: [],
      isCrisis: false,
      intent,
      sessionId,
      quotaRemaining: 0,
      eligibilityDisclaimer: ELIGIBILITY_DISCLAIMER,
      llmSummarized: false,
      sessionContext: undefined,
      activeContextUsed: false,
    };
  }

  // Stage 3: Rate limit (after crisis + quota)
  const rateLimit = checkRateLimit(rateLimitKey);
  if (rateLimit.exceeded) {
    throw new ChatRateLimitExceededError(rateLimit.retryAfterSeconds);
  }

  // Stage 4: Context assembly. A validated guided intake may provide explicit
  // need text for classification, while crisis and safety checks above always
  // use the full visible message.
  let context = { ...assembleContext(sessionId, userId), locale };
  if (deps.hydrateContext) {
    context = await deps.hydrateContext(context);
  }

  const classificationText = context.retrievalText?.trim() || message;
  let intent = {
    ...detectIntent(classificationText),
    rawQuery: message,
  };

  // Stage 4.5: LLM intent enrichment (Idea 10)
  // Only fires when keyword classifier returns 'general' (ambiguous fallback).
  // Never runs for crisis-detected messages (guarded by early returns above).
  // FAIL-OPEN: any error keeps the original intent.
  const intentEnrichEnabled = await deps.isFlagEnabled(FEATURE_FLAGS.LLM_INTENT_ENRICH);
  if (intentEnrichEnabled && intent.category === 'general' && deps.enrichIntent) {
    try {
      intent = {
        ...await deps.enrichIntent(classificationText, intent),
        rawQuery: message,
      };
    } catch {
      // LLM failure is non-fatal — keep original intent
    }
  }

  const appliedContext = applySessionContext(intent, context);
  intent = appliedContext.intent;
  context = appliedContext.context;

  if (crisisScope === 'third_party' || crisisScope === 'informational') {
    const response = assembleClarificationResponse(
      intent,
      context,
      {
        reason: 'crisis_scope',
        prompt:
          crisisScope === 'third_party'
            ? 'If someone is in immediate danger, call 911 now. For urgent mental health crisis support, call or text 988. If you want help finding local services for them, tell me the kind of service you need, such as mental health care, shelter, food, or legal help.'
            : 'If this is an immediate crisis, call 911 or 988 now. If you want local services, tell me what kind of help to look for, such as mental health care, shelter, food, or healthcare.',
        suggestions: [
          'Mental health crisis support',
          'Emergency shelter tonight',
          'Food assistance near me',
          'Legal help',
        ],
      },
      {
        activeContextUsed: appliedContext.activeContextUsed,
        sessionSignals: appliedContext.sessionSignals,
      },
    );
    await incrementQuota(sessionId, userId);
    return response;
  }

  if (shouldClarifyWeakQuery(context.retrievalText ?? message, intent, context)) {
    const response = assembleClarificationResponse(
      intent,
      context,
      {
        reason: 'weak_query',
        prompt: 'I can search the catalog once I know the kind of help you want. Tell me the need, such as housing, food, healthcare, mental health, transportation, childcare, employment, legal help, or utility assistance.',
        suggestions: [
          'Help paying rent',
          'Food pantry near me',
          'Mental health support',
          'Free or low-cost healthcare',
        ],
      },
      {
        activeContextUsed: appliedContext.activeContextUsed,
        sessionSignals: appliedContext.sessionSignals,
      },
    );
    await incrementQuota(sessionId, userId);
    return response;
  }

  if (isOutOfScopeRequest(message, intent)) {
    const response = assembleOutOfScopeResponse(intent, context);
    await incrementQuota(sessionId, userId);
    return response;
  }

  // Stage 6: Retrieval — pure SQL, no LLM
  const retrieval = await deps.retrieveServices(intent, context);
  const services = retrieval.services;

  // Stage 7: Response assembly
  let response = assembleResponse(services, intent, context, {
    retrievalStatus: retrieval.retrievalStatus,
    effectiveSearchText: retrieval.effectiveSearchText,
    locationBiasApplied: retrieval.locationBiasApplied,
    searchBroadened: retrieval.searchBroadened,
    searchInterpretation: buildSearchInterpretation(intent, context, {
      activeContextUsed: appliedContext.activeContextUsed,
      sessionSignals: appliedContext.sessionSignals,
    }),
    activeContextUsed: appliedContext.activeContextUsed,
  });
  response = {
    ...response,
    activeContextUsed: appliedContext.activeContextUsed,
    sessionContext: buildSessionContext(intent, context),
  };

  // Stage 8: LLM summarization gate
  // ONLY activate if: (a) flag is enabled AND (b) there are services to summarize
  const llmEnabled = await deps.isFlagEnabled(FEATURE_FLAGS.LLM_SUMMARIZE);
  if (llmEnabled && retrieval.retrievalStatus === 'results' && services.length > 0 && deps.summarizeWithLLM) {
    try {
      const summary = await deps.summarizeWithLLM(services, intent);
      response = { ...response, message: summary, llmSummarized: true };
    } catch {
      // LLM failure is non-fatal — fall back to assembled message
    }
  }

  // Increment quota after successful response (DB-backed when configured)
  if (retrieval.retrievalStatus !== 'temporarily_unavailable') {
    await incrementQuota(sessionId, userId);
  }

  return response;
}
