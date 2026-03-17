/**
 * Chat Service Types
 */

import { z } from 'zod';
import type { EnrichedService } from '@/domain/types';
import { CRISIS_RESOURCES, ELIGIBILITY_DISCLAIMER } from '@/domain/constants';
import { DISCOVERY_NEED_IDS, type DiscoveryNeedId } from '@/domain/discoveryNeeds';
import { buildSeekerDiscoveryProfile } from '@/services/profile/discoveryProfile';
import { selectServiceLinks, type ServiceLink } from '@/services/chat/links';
import { formatDiscoveryAttributeLabel } from '@/services/search/discoveryPresentation';
import type { SearchFilters } from '@/services/search/types';
import { SearchFiltersSchema } from '@/services/search/types';

// ============================================================
// INTENT
// ============================================================

export const INTENT_CATEGORIES = [...DISCOVERY_NEED_IDS, 'general'] as const;

export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

export const INTENT_ACTIONS = ['apply', 'contact', 'eligibility', 'hours', 'website', 'general'] as const;
export type IntentAction = (typeof INTENT_ACTIONS)[number];

export const IntentSchema = z.object({
  category: z.enum(INTENT_CATEGORIES),
  rawQuery: z.string(),
  geoQualifier: z.string().optional(),
  populationQualifier: z.string().optional(),
  /** Optional action intent used for link selection (e.g., apply vs contact). */
  actionQualifier: z.enum(INTENT_ACTIONS).optional(),
  urgencyQualifier: z.enum(['urgent', 'standard']).default('standard'),
});

export type Intent = z.infer<typeof IntentSchema>;

// ============================================================
// CHAT MESSAGE
// ============================================================

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  timestamp: z.date().default(() => new Date()),
});

export type ChatMessage = z.infer<typeof ChatMessageSchema>;

// ============================================================
// CHAT REQUEST
// ============================================================

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  sessionId: z.string().uuid(),
  userId: z.string().optional(),
  locale: z.string().default('en'),
  profileMode: z.enum(['use', 'ignore']).default('use'),
  sessionContext: z
    .object({
      activeNeedId: z.enum(DISCOVERY_NEED_IDS).optional(),
      activeCity: z.string().trim().min(1).max(120).optional(),
      activeGeo: z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          radiusMiles: z.number().int().min(1).max(50),
        })
        .optional(),
      urgency: z.enum(['urgent', 'standard']).optional(),
      preferredDeliveryModes: z.array(z.string().min(1).max(40)).max(10).optional(),
      trustFilter: z.enum(['all', 'LIKELY', 'HIGH']).optional(),
      taxonomyTermIds: z.array(z.string().uuid()).max(20).optional(),
      attributeFilters: SearchFiltersSchema.shape.attributeFilters,
      profileShapingEnabled: z.boolean().default(true),
    })
    .optional(),
  filters: z
    .object({
      /** Canonical taxonomy term IDs (UUIDs). */
      taxonomyTermIds: z.array(z.string().uuid()).max(20).optional(),
      /** Browse-compatible ORAN attribute filters preserved from directory/map discovery. */
      attributeFilters: SearchFiltersSchema.shape.attributeFilters,
      /** Trust-tier filter aligned with Directory UI. */
      trust: z.enum(['all', 'LIKELY', 'HIGH']).optional(),
    })
    .optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export type ChatSessionContext = NonNullable<ChatRequest['sessionContext']>;

// ============================================================
// CHAT CONTEXT
// ============================================================

export interface UserProfile {
  userId: string;
  locationCity?: string;
  locationPostalCode?: string;
  categoryPreferences?: string[];
  primaryNeedId?: DiscoveryNeedId;
  browsePreference?: {
    needId?: DiscoveryNeedId | null;
    taxonomyTermIds?: string[];
    attributeFilters?: SearchFilters['attributeFilters'];
  };
  accessibilityNeeds?: string[];
  /** Self-identified tags (e.g., "veteran"). Do not persist without explicit consent. */
  audienceTags?: string[];
  serviceInterests?: string[];
  currentServices?: string[];
  selfIdentifiers?: string[];
  ageGroup?: string;
  householdType?: string;
  housingSituation?: string;
  transportationBarrier?: boolean;
  preferredDeliveryModes?: string[];
  urgencyWindow?: string;
  documentationBarriers?: string[];
  digitalAccessBarrier?: boolean;
}

export interface ChatContext {
  sessionId: string;
  userId?: string;
  locale: string;
  messageCount: number;
  profileShapingDisabled?: boolean;
  sessionContext?: ChatSessionContext;
  userProfile?: UserProfile;
  /** Approximate location — city or postal code only */
  approximateLocation?: {
    city?: string;
    postalCode?: string;
    stateProvince?: string;
  };
}

// ============================================================
// CHAT RESPONSE
// ============================================================

export interface ServiceCard {
  serviceId: string;
  serviceName: string;
  organizationName: string;
  description?: string;
  address?: string;
  phone?: string;
  scheduleDescription?: string;
  /** Optional links derived from stored records only (never invented). */
  links?: ServiceLink[];
  /** Seeker-facing trust band (derived from verification confidence). */
  confidenceBand: 'HIGH' | 'LIKELY' | 'POSSIBLE';
  /** Seeker-facing trust score (0–100, derived from verification confidence). */
  confidenceScore: number;
  /** Always use qualifying language — never guarantee eligibility */
  eligibilityHint: string;
  /** Deterministic fit reasons derived only from stored facts and active filters/preferences. */
  matchReasons?: string[];
}

export const CHAT_RETRIEVAL_STATUSES = [
  'results',
  'no_match',
  'catalog_empty_for_scope',
  'temporarily_unavailable',
  'clarification_required',
  'out_of_scope',
] as const;

export type ChatRetrievalStatus = (typeof CHAT_RETRIEVAL_STATUSES)[number];

export interface SearchInterpretation {
  category: IntentCategory;
  categoryLabel: string;
  urgencyQualifier: Intent['urgencyQualifier'];
  actionQualifier?: IntentAction;
  summary: string;
  usedSessionContext: boolean;
  sessionSignals: string[];
  usedProfileShaping: boolean;
  ignoredProfileShaping: boolean;
  profileSignals: string[];
}

export interface ChatRetrievalResult {
  services: EnrichedService[];
  retrievalStatus: Exclude<ChatRetrievalStatus, 'out_of_scope' | 'clarification_required'>;
}

export interface ChatClarification {
  reason: 'weak_query' | 'crisis_scope';
  prompt: string;
  suggestions: string[];
}

export interface ChatResponse {
  message: string;
  resultSummary?: string;
  services: ServiceCard[];
  isCrisis: boolean;
  crisisResources?: typeof CRISIS_RESOURCES;
  intent: Intent;
  sessionId: string;
  quotaRemaining: number;
  /** ISO-8601 timestamp when the 24-hour quota window resets. Null if window not yet started. */
  quotaResetAt?: string;
  eligibilityDisclaimer: typeof ELIGIBILITY_DISCLAIMER;
  llmSummarized: boolean;
  retrievalStatus?: ChatRetrievalStatus;
  activeContextUsed?: boolean;
  sessionContext?: ChatSessionContext;
  searchInterpretation?: SearchInterpretation;
  clarification?: ChatClarification;
  followUpSuggestions?: string[];
}

// ============================================================
// QUOTA STATE
// ============================================================

export interface QuotaState {
  sessionId: string;
  messageCount: number;
  remaining: number;
  exceeded: boolean;
  /** When the 24-hour quota window resets (undefined if window not yet started) */
  resetAt?: Date;
}

// ============================================================
// ENRICHED SERVICE → SERVICE CARD CONVERSION
// ============================================================

const ATTRIBUTE_MATCH_REASON_LABELS: Record<string, string> = {
  phone: 'Offers phone support',
  virtual: 'Offers virtual support',
  hybrid: 'Offers flexible in-person or virtual support',
  in_person: 'Available in person',
  home_delivery: 'Offers home delivery',
  interpreter_on_site: 'Offers interpreter support',
  no_id_required: 'Does not require ID',
  no_documentation_required: 'Does not require documentation',
  no_ssn_required: 'Does not require SSN',
  no_referral_needed: 'Does not require a referral',
  walk_in: 'Allows walk-ins',
  drop_in: 'Allows drop-in access',
  accepting_new_clients: 'Marked as accepting new clients',
  weekend_hours: 'Offers weekend hours',
  evening_hours: 'Offers evening hours',
  same_day: 'Marked for same-day help',
  next_day: 'Marked for next-day help',
  transportation_provided: 'Helps with transportation',
  bilingual_services: 'Offers bilingual services',
  lgbtq_affirming: 'Marked LGBTQ+ affirming',
  child_friendly: 'Marked child friendly',
  pregnant: 'Tagged for pregnancy support',
  post_partum: 'Tagged for postpartum support',
  postpartum: 'Tagged for postpartum support',
  caregiver: 'Tagged for caregivers',
  refugee: 'Tagged for refugees or asylum seekers',
  reentry: 'Tagged for reentry support',
  dv_survivor: 'Tagged for survivors',
  single_parent: 'Tagged for single-parent households',
  no_fixed_address: 'Supports people without a fixed address',
};

function formatAttributeMatchReason(tag: string): string {
  return ATTRIBUTE_MATCH_REASON_LABELS[tag] ?? `Matched ${formatDiscoveryAttributeLabel(tag).toLowerCase()}`;
}

function addReason(reasons: string[], seen: Set<string>, reason: string) {
  if (reason && !seen.has(reason)) {
    seen.add(reason);
    reasons.push(reason);
  }
}

export function deriveChatMatchReasons(
  enriched: EnrichedService,
  options?: { intent?: Intent; context?: ChatContext; links?: ServiceLink[] },
): string[] {
  const reasons: string[] = [];
  const seen = new Set<string>();
  const serviceAttributes = enriched.attributes ?? [];
  const browsePreference = options?.context?.userProfile?.browsePreference;
  const browseAttributeFilters = browsePreference?.attributeFilters ?? {};
  const browseTaxonomyIds = new Set(browsePreference?.taxonomyTermIds ?? []);

  for (const [taxonomy, tags] of Object.entries(browseAttributeFilters)) {
    tags.forEach((tag) => {
      const matched = serviceAttributes.some((attribute) => attribute.taxonomy === taxonomy && attribute.tag === tag);
      if (matched) {
        addReason(reasons, seen, formatAttributeMatchReason(tag));
      }
    });
  }

  if ((browseTaxonomyIds.size ?? 0) > 0) {
    enriched.taxonomyTerms.forEach((term) => {
      if (browseTaxonomyIds.has(term.id)) {
        addReason(reasons, seen, `Tagged with ${term.term}`);
      }
    });
  }

  if (options?.context?.userProfile) {
    const discoveryProfile = buildSeekerDiscoveryProfile(options.context.userProfile, {
      locale: options.context.locale,
    });
    const signalGroups = discoveryProfile.profileSignals;

    signalGroups?.deliveryTags?.forEach((tag) => {
      const matched = serviceAttributes.some((attribute) => attribute.taxonomy === 'delivery' && attribute.tag === tag);
      if (matched) addReason(reasons, seen, formatAttributeMatchReason(tag));
    });
    signalGroups?.accessTags?.forEach((tag) => {
      const matched = serviceAttributes.some((attribute) => attribute.taxonomy === 'access' && attribute.tag === tag);
      if (matched) addReason(reasons, seen, formatAttributeMatchReason(tag));
    });
    signalGroups?.cultureTags?.forEach((tag) => {
      const matched = serviceAttributes.some((attribute) => attribute.taxonomy === 'culture' && attribute.tag === tag);
      if (matched) addReason(reasons, seen, formatAttributeMatchReason(tag));
    });
    signalGroups?.populationTags?.forEach((tag) => {
      const matched = serviceAttributes.some((attribute) => attribute.taxonomy === 'population' && attribute.tag === tag);
      if (matched) addReason(reasons, seen, formatAttributeMatchReason(tag));
    });
    signalGroups?.situationTags?.forEach((tag) => {
      const matched = serviceAttributes.some((attribute) => attribute.taxonomy === 'situation' && attribute.tag === tag);
      if (matched) addReason(reasons, seen, formatAttributeMatchReason(tag));
    });
  }

  if (options?.intent?.actionQualifier === 'apply' && options.links?.some((link) => link.kind === 'apply')) {
    addReason(reasons, seen, 'Includes an application path');
  }

  if (
    options?.intent?.actionQualifier === 'contact'
    && (Boolean(enriched.phones[0]?.number) || options.links?.some((link) => link.kind === 'contact'))
  ) {
    addReason(reasons, seen, 'Includes direct contact details');
  }

  if (options?.intent?.actionQualifier === 'hours' && Boolean(enriched.schedules[0]?.description)) {
    addReason(reasons, seen, 'Includes hours information');
  }

  return reasons.slice(0, 4);
}

export function enrichedServiceToCard(
  enriched: EnrichedService,
  options?: { intent?: Intent; context?: ChatContext }
): ServiceCard {
  const { service, organization, address, phones, schedules, confidenceScore } = enriched;

  const addressStr = address
    ? [address.address1, address.city, address.stateProvince, address.postalCode]
        .filter(Boolean)
        .join(', ')
    : undefined;

  const phone = phones[0]?.number;
  const schedule = schedules[0]?.description;

  const links = selectServiceLinks(enriched, {
    intentCategory: options?.intent?.category ?? 'general',
    intentAction: options?.intent?.actionQualifier,
    locale: options?.context?.locale ?? 'en',
    audienceTags: options?.context?.userProfile?.audienceTags,
  });

  const trustScore = confidenceScore?.verificationConfidence ?? 0;
  const band = trustScore >= 80 ? 'HIGH' : trustScore >= 60 ? 'LIKELY' : 'POSSIBLE';
  const matchReasons = deriveChatMatchReasons(enriched, {
    intent: options?.intent,
    context: options?.context,
    links,
  });

  return {
    serviceId: service.id,
    serviceName: service.name,
    organizationName: organization.name,
    description: service.description ?? undefined,
    address: addressStr,
    phone,
    scheduleDescription: schedule ?? undefined,
    links: links.length > 0 ? links : undefined,
    confidenceBand: band,
    confidenceScore: trustScore,
    eligibilityHint: 'You may qualify for this service. Please confirm eligibility with the provider.',
    matchReasons: matchReasons.length > 0 ? matchReasons : undefined,
  };
}
