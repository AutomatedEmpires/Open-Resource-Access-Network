/**
 * Chat Service Types
 */

import { z } from 'zod';
import type { EnrichedService } from '@/domain/types';
import { CRISIS_RESOURCES, ELIGIBILITY_DISCLAIMER } from '@/domain/constants';
import { DISCOVERY_NEED_IDS, type DiscoveryNeedId } from '@/domain/discoveryNeeds';
import type { ResourceVerificationStatus } from '@/domain/resourceNavigator';
import { selectServiceLinks, type ServiceLink } from '@/services/chat/links';
import { formatDiscoveryAttributeLabel } from '@/services/search/discoveryPresentation';
import type { SearchFilters } from '@/services/search/types';
import { SearchFiltersSchema } from '@/services/search/types';
import { GuidedIntakeRequestSchema } from '@/services/chat/guidedIntakeContract';
import {
  buildChatSearchProfileSignals,
  shouldUseSavedSeekerProfile,
} from '@/services/chat/profileSignals';
export { GuidedIntakeRequestSchema } from '@/services/chat/guidedIntakeContract';
export type { GuidedIntakeRequest } from '@/services/chat/guidedIntakeContract';

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

export const ApproximateLocationSchema = z.object({
  city: z.string().trim().min(1).max(120).optional(),
  postalCode: z.string().regex(/^\d{5}$/).optional(),
  stateProvince: z.string().trim().min(1).max(60).optional(),
}).strict().refine((location) => Boolean(location.city || location.postalCode), {
  message: 'City or postal code is required',
});

export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(2000),
  sessionId: z.string().uuid(),
  userId: z.string().optional(),
  locale: z.string().default('en'),
  profileMode: z.enum(['use', 'ignore']).default('use'),
  guidedIntake: GuidedIntakeRequestSchema.optional(),
  sessionContext: z
    .object({
      activeNeedId: z.enum(DISCOVERY_NEED_IDS).optional(),
      activeRetrievalText: z.string().trim().min(1).max(500).optional(),
      activeCity: z.string().trim().min(1).max(120).optional(),
      activeLocation: ApproximateLocationSchema.optional(),
      activeGeo: z
        .object({
          lat: z.number().min(-90).max(90),
          lng: z.number().min(-180).max(180),
          radiusMiles: z.number().int().min(1).max(50),
        })
        .optional(),
      urgency: z.enum(['urgent', 'standard']).optional(),
      urgencyWindow: z.enum(['today', 'within_days', 'planning']).optional(),
      audience: z.enum(['self', 'child', 'family', 'someone_else']).optional(),
      accessMode: z.enum(['can_travel', 'cannot_travel', 'phone', 'online']).optional(),
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
}).strict();

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
  /** Explicit need text used only for deterministic catalog retrieval. */
  retrievalText?: string;
  sessionContext?: ChatSessionContext;
  userProfile?: UserProfile;
  /** Approximate location — city/state or ZIP only; never a street address. */
  approximateLocation?: z.infer<typeof ApproximateLocationSchema>;
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
  /** Seeker-facing record-confidence band; never an implicit provider-verification claim. */
  confidenceBand: 'HIGH' | 'LIKELY' | 'POSSIBLE';
  /** Record-confidence score (0–100) used for ranking, separate from workflow verification. */
  confidenceScore: number;
  /** Always use qualifying language — never guarantee eligibility */
  eligibilityHint: string;
  /** Deterministic fit reasons derived only from stored facts and active filters/preferences. */
  matchReasons?: string[];
  /** Distance from the seeker-provided approximate location, when available. */
  distanceMeters?: number;
  /** Stored geographic coverage summary. */
  serviceAreaSummary?: string;
  /** Stored documents that the provider may request. */
  requiredDocuments?: string[];
  /** The clearest action supported by the stored record. */
  nextStep?: string;
  /** A safe, deterministic question to ask the provider. */
  whatToAsk?: string;
  /** Exact workflow state only when present in stored verification evidence. */
  verificationStatus?: ResourceVerificationStatus;
  /** Date tied to the exact verification state, never a guessed source-check date. */
  verificationLastCheckedAt?: string;
  /** A stored provider/source page. Presence does not imply it was recently checked. */
  sourceLabel?: string;
  sourceUrl?: string;
  sourceLastCheckedAt?: string;
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
  /** Exact text used by the successful or final deterministic catalog query. */
  effectiveSearchText?: string;
  /** True only when a soft city/ZIP preference changed deterministic ordering. */
  locationBiasApplied?: boolean;
  /** True when exact need text missed and results came from a broader category query. */
  searchBroadened?: boolean;
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
  effectiveSearchText?: string;
  locationBiasApplied?: boolean;
  searchBroadened?: boolean;
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
  '24_7': 'Marked as available 24/7',
  after_hours: 'Offers after-hours access',
  transportation_provided: 'Helps with transportation',
  bilingual_services: 'Offers bilingual services',
  youth_focused: 'Offers youth-focused services',
  family_centered: 'Offers family-centered services',
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
  const useSavedProfile = options?.context
    ? shouldUseSavedSeekerProfile(options.context)
    : false;
  const browsePreference = useSavedProfile
    ? options?.context?.userProfile?.browsePreference
    : undefined;
  const hasExplicitDeliveryPreference = Boolean(
    options?.context?.sessionContext
    && Object.prototype.hasOwnProperty.call(
      options.context.sessionContext,
      'preferredDeliveryModes',
    ),
  );
  const browseAttributeFilters: NonNullable<SearchFilters['attributeFilters']> = {
    ...(browsePreference?.attributeFilters ?? {}),
    ...(options?.context?.sessionContext?.attributeFilters ?? {}),
  };
  if (hasExplicitDeliveryPreference) {
    const deliveryModes = options?.context?.sessionContext?.preferredDeliveryModes ?? [];
    if (deliveryModes.length > 0) {
      browseAttributeFilters.delivery = deliveryModes;
    } else {
      delete browseAttributeFilters.delivery;
    }
  }
  const browseTaxonomyIds = new Set(
    options?.context?.sessionContext?.taxonomyTermIds
    ?? browsePreference?.taxonomyTermIds
    ?? [],
  );

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

  if (options?.context) {
    const signalGroups = buildChatSearchProfileSignals(options.context);

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
    audienceTags: options?.context && shouldUseSavedSeekerProfile(options.context)
      ? options.context.userProfile?.audienceTags
      : undefined,
  });

  const trustScore = confidenceScore?.verificationConfidence ?? 0;
  const band = trustScore >= 80 ? 'HIGH' : trustScore >= 60 ? 'LIKELY' : 'POSSIBLE';
  const matchReasons = deriveChatMatchReasons(enriched, {
    intent: options?.intent,
    context: options?.context,
    links,
  });
  const eligibilityDescriptions = (enriched.eligibility ?? [])
    .map((rule) => rule.description?.trim())
    .filter((description): description is string => Boolean(description))
    .slice(0, 2);
  const eligibilityHint = eligibilityDescriptions.length > 0
    ? `Stored eligibility criteria: ${eligibilityDescriptions.join(' · ')} Confirm current eligibility with the provider.`
    : 'This record does not list who may qualify. Confirm current requirements with the provider.';
  const serviceAreaSummary = (enriched.serviceAreas ?? [])
    .map((area) => area.name?.trim() || area.description?.trim() || area.extentType)
    .filter((area): area is string => Boolean(area))
    .slice(0, 3)
    .join(', ') || undefined;
  const requiredDocuments = (enriched.requiredDocuments ?? [])
    .map((document) => document.document?.trim())
    .filter((document): document is string => Boolean(document));
  const applyLink = links.find((link) => link.kind === 'apply');
  const providerLink = links.find((link) => link.url === service.url)
    ?? links.find((link) => ['primary', 'service_page', 'organization_home'].includes(link.kind));
  const nextStep = service.applicationProcess?.trim()
    || (applyLink ? `Open ${applyLink.label} and review the provider's intake instructions.` : undefined)
    || (phone ? 'Call the provider to confirm current hours, eligibility, and intake steps.' : undefined)
    || (providerLink ? 'Open the provider page and confirm the current intake process.' : undefined)
    || 'Open ORAN details and confirm the current intake process with the provider.';
  const verificationLastCheckedAt = organization.verifiedAt?.trim() || undefined;

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
    eligibilityHint,
    matchReasons: matchReasons.length > 0 ? matchReasons : undefined,
    distanceMeters: enriched.distanceMeters ?? undefined,
    serviceAreaSummary,
    requiredDocuments: requiredDocuments.length > 0 ? requiredDocuments : undefined,
    nextStep,
    whatToAsk: `Ask whether ${service.name} is currently available, what you need to bring, and how to start.`,
    // Organization-level verified_at is evidence the ORGANIZATION was
    // verified, not that this service's details were checked — present it as
    // source verification, never provider verification of the record.
    verificationStatus: verificationLastCheckedAt ? 'source_verified' : undefined,
    verificationLastCheckedAt,
    sourceLabel: providerLink ? `${organization.name} provider page` : undefined,
    sourceUrl: providerLink?.url,
  };
}
