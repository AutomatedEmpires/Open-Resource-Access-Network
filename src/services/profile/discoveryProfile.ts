import {
  getDiscoveryNeedSearchText,
  getPrimaryDiscoveryNeedId,
  type DiscoveryNeedId,
} from '@/domain/discoveryNeeds';
import type { DiscoveryLinkState } from '@/services/search/discovery';
import type { SearchFilters, SearchPreferenceSignals } from '@/services/search/types';

import {
  ACCESSIBILITY_NEED_VALUES,
  AGE_GROUP_VALUES,
  CURRENT_SERVICE_VALUES,
  DELIVERY_MODE_VALUES,
  DOCUMENTATION_BARRIER_VALUES,
  HOUSEHOLD_TYPE_VALUES,
  HOUSING_SITUATION_VALUES,
  normalizeSeekerProfile,
  SELF_IDENTIFIER_VALUES,
  SERVICE_INTEREST_VALUES,
  URGENCY_WINDOW_VALUES,
  type AccessibilityNeedId,
  type DocumentationBarrierId,
  type SeekerProfile,
  type SelfIdentifierId,
  type UrgencyWindowId,
} from './contracts';

export interface DiscoveryProfileInput {
  serviceInterests?: readonly string[] | null;
  ageGroup?: string | null;
  householdType?: string | null;
  housingSituation?: string | null;
  selfIdentifiers?: readonly string[] | null;
  currentServices?: readonly string[] | null;
  accessibilityNeeds?: readonly string[] | null;
  transportationBarrier?: boolean | null;
  preferredDeliveryModes?: readonly string[] | null;
  urgencyWindow?: string | null;
  documentationBarriers?: readonly string[] | null;
  digitalAccessBarrier?: boolean | null;
  pronouns?: string | null;
  profileHeadline?: string | null;
  avatarEmoji?: string | null;
  additionalContext?: string | null;
}

export interface SeekerDiscoveryProfile {
  normalizedProfile: SeekerProfile;
  primaryNeedId: DiscoveryNeedId | null;
  additionalNeedIds: DiscoveryNeedId[];
  interestSearchText: string[];
  browseState: DiscoveryLinkState;
  profileSignals?: SearchPreferenceSignals;
  hasPersonalization: boolean;
  hasIdentityContext: boolean;
}

const SELF_IDENTIFIER_TO_POPULATION_TAG: Record<SelfIdentifierId, string | undefined> = {
  veteran: undefined,
  senior_65plus: undefined,
  disability: undefined,
  pregnant: 'pregnant',
  new_parent: 'postpartum',
  caregiver: 'caregiver',
  dv_survivor: 'dv_survivor',
  reentry: 'reentry',
  undocumented_friendly: 'undocumented_friendly',
  lgbtq: undefined,
  refugee: 'refugee',
};

const SELF_IDENTIFIER_TO_CULTURE_TAG: Record<SelfIdentifierId, string | undefined> = {
  veteran: undefined,
  senior_65plus: undefined,
  disability: undefined,
  pregnant: undefined,
  new_parent: undefined,
  caregiver: undefined,
  dv_survivor: undefined,
  reentry: undefined,
  undocumented_friendly: undefined,
  lgbtq: 'lgbtq_affirming',
  refugee: undefined,
};

const HOUSING_SITUATION_TO_SITUATION_TAG: Record<NonNullable<SeekerProfile['housingSituation']>, string | undefined> = {
  '': undefined,
  housed_stable: undefined,
  at_risk: undefined,
  unhoused: 'no_fixed_address',
  shelter: 'no_fixed_address',
  couch_surfing: 'no_fixed_address',
};

const HOUSEHOLD_TYPE_TO_POPULATION_TAG: Record<NonNullable<SeekerProfile['householdType']>, string | undefined> = {
  '': undefined,
  single: undefined,
  couple: undefined,
  family_with_children: undefined,
  single_parent: 'single_parent',
  multigenerational: undefined,
  other: undefined,
};

const ACCESSIBILITY_TO_ACCESS_TAGS: Partial<Record<AccessibilityNeedId, string[]>> = {
  language_interpretation: ['interpreter_on_site'],
  child_friendly: ['childcare_available'],
  evening_hours: ['evening_hours', 'weekend_hours', 'after_hours'],
};

const ACCESSIBILITY_TO_DELIVERY_TAGS: Partial<Record<AccessibilityNeedId, string[]>> = {
  virtual_option: ['virtual', 'phone', 'hybrid'],
};

const DOCUMENTATION_BARRIER_TO_ACCESS_TAGS: Record<DocumentationBarrierId, string[]> = {
  no_id: ['no_id_required'],
  no_documents: ['no_documentation_required'],
  no_ssn: ['no_ssn_required'],
};

const URGENCY_WINDOW_TO_ACCESS_TAGS: Partial<Record<UrgencyWindowId, string[]>> = {
  same_day: ['same_day'],
  next_day: ['same_day', 'next_day'],
};

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function sanitizeEnumArray<T extends string>(
  values: readonly (string | null | undefined)[] | null | undefined,
  allowed: readonly T[],
): T[] | undefined {
  if (!values) return undefined;
  const allowedSet = new Set<string>(allowed);
  const sanitized = values.filter((value): value is T => typeof value === 'string' && allowedSet.has(value));
  return sanitized.length > 0 ? sanitized : undefined;
}

function sanitizeEnumValue<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
): T | '' | undefined {
  if (!value) return value === '' ? '' : undefined;
  return allowed.includes(value as T) ? (value as T) : undefined;
}

function buildAttributeFilters(profile: SeekerProfile): SearchFilters['attributeFilters'] | undefined {
  const delivery = uniqueStrings([
    ...profile.preferredDeliveryModes,
    ...profile.accessibilityNeeds.flatMap((value) => ACCESSIBILITY_TO_DELIVERY_TAGS[value] ?? []),
  ]);

  const access = uniqueStrings([
    ...profile.accessibilityNeeds.flatMap((value) => ACCESSIBILITY_TO_ACCESS_TAGS[value] ?? []),
    ...profile.documentationBarriers.flatMap((value) => DOCUMENTATION_BARRIER_TO_ACCESS_TAGS[value] ?? []),
    ...(profile.urgencyWindow ? (URGENCY_WINDOW_TO_ACCESS_TAGS[profile.urgencyWindow] ?? []) : []),
  ]);

  const filters: Record<string, string[]> = {};
  if (delivery.length > 0) {
    filters.delivery = delivery;
  }
  if (access.length > 0) {
    filters.access = access;
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}

function buildProfileSignals(profile: SeekerProfile, locale?: string): SearchPreferenceSignals | undefined {
  const populationTags = uniqueStrings([
    ...profile.selfIdentifiers.map((value) => SELF_IDENTIFIER_TO_POPULATION_TAG[value]),
    HOUSEHOLD_TYPE_TO_POPULATION_TAG[profile.householdType],
  ]);

  const situationTags = uniqueStrings([
    HOUSING_SITUATION_TO_SITUATION_TAG[profile.housingSituation],
    ...(locale && locale !== 'en' ? ['language_barrier'] : []),
    ...(profile.accessibilityNeeds.includes('language_interpretation') ? ['language_barrier'] : []),
    ...(profile.transportationBarrier ? ['transportation_barrier'] : []),
    ...(profile.digitalAccessBarrier ? ['digital_barrier'] : []),
  ]);

  const accessTags = uniqueStrings([
    ...profile.accessibilityNeeds.flatMap((value) => ACCESSIBILITY_TO_ACCESS_TAGS[value] ?? []),
    ...profile.documentationBarriers.flatMap((value) => DOCUMENTATION_BARRIER_TO_ACCESS_TAGS[value] ?? []),
    ...(profile.urgencyWindow ? (URGENCY_WINDOW_TO_ACCESS_TAGS[profile.urgencyWindow] ?? []) : []),
    ...(profile.transportationBarrier ? ['transportation_provided'] : []),
  ]);

  const deliveryTags = uniqueStrings([
    ...profile.accessibilityNeeds.flatMap((value) => ACCESSIBILITY_TO_DELIVERY_TAGS[value] ?? []),
    ...profile.preferredDeliveryModes,
  ]);

  const cultureTags = uniqueStrings([
    ...profile.selfIdentifiers.map((value) => SELF_IDENTIFIER_TO_CULTURE_TAG[value]),
    ...(profile.accessibilityNeeds.includes('language_interpretation') ? ['bilingual_services'] : []),
    ...(locale && locale !== 'en' ? ['bilingual_services'] : []),
  ]);

  if (
    populationTags.length === 0 &&
    situationTags.length === 0 &&
    accessTags.length === 0 &&
    deliveryTags.length === 0 &&
    cultureTags.length === 0
  ) {
    return undefined;
  }

  return {
    populationTags: populationTags.length > 0 ? populationTags : undefined,
    situationTags: situationTags.length > 0 ? situationTags : undefined,
    accessTags: accessTags.length > 0 ? accessTags : undefined,
    deliveryTags: deliveryTags.length > 0 ? deliveryTags : undefined,
    cultureTags: cultureTags.length > 0 ? cultureTags : undefined,
  };
}

export function buildSeekerDiscoveryProfile(
  profile: DiscoveryProfileInput | null | undefined,
  options: { locale?: string } = {},
): SeekerDiscoveryProfile {
  const normalizedProfile = normalizeSeekerProfile({
    serviceInterests: sanitizeEnumArray(profile?.serviceInterests, SERVICE_INTEREST_VALUES),
    ageGroup: sanitizeEnumValue(profile?.ageGroup ?? undefined, AGE_GROUP_VALUES),
    householdType: sanitizeEnumValue(profile?.householdType ?? undefined, HOUSEHOLD_TYPE_VALUES),
    housingSituation: sanitizeEnumValue(profile?.housingSituation ?? undefined, HOUSING_SITUATION_VALUES),
    selfIdentifiers: sanitizeEnumArray(profile?.selfIdentifiers, SELF_IDENTIFIER_VALUES),
    currentServices: sanitizeEnumArray(profile?.currentServices, CURRENT_SERVICE_VALUES),
    accessibilityNeeds: sanitizeEnumArray(profile?.accessibilityNeeds, ACCESSIBILITY_NEED_VALUES),
    transportationBarrier: profile?.transportationBarrier ?? undefined,
    preferredDeliveryModes: sanitizeEnumArray(profile?.preferredDeliveryModes, DELIVERY_MODE_VALUES),
    urgencyWindow: sanitizeEnumValue(profile?.urgencyWindow ?? undefined, URGENCY_WINDOW_VALUES),
    documentationBarriers: sanitizeEnumArray(profile?.documentationBarriers, DOCUMENTATION_BARRIER_VALUES),
    digitalAccessBarrier: profile?.digitalAccessBarrier ?? undefined,
    pronouns: profile?.pronouns ?? undefined,
    profileHeadline: profile?.profileHeadline ?? undefined,
    avatarEmoji: profile?.avatarEmoji ?? undefined,
    additionalContext: profile?.additionalContext ?? undefined,
  });
  const primaryNeedId = getPrimaryDiscoveryNeedId(normalizedProfile.serviceInterests);
  const additionalNeedIds = normalizedProfile.serviceInterests.filter((id) => id !== primaryNeedId);
  const interestSearchText = uniqueStrings(
    normalizedProfile.serviceInterests.map((interest) => getDiscoveryNeedSearchText(interest)),
  );
  const attributeFilters = buildAttributeFilters(normalizedProfile);

  const browseState: DiscoveryLinkState = {
    needId: primaryNeedId,
    attributeFilters,
  };

  const profileSignals = buildProfileSignals(normalizedProfile, options.locale);
  const hasIdentityContext = Boolean(
    normalizedProfile.avatarEmoji.trim() ||
    normalizedProfile.profileHeadline.trim() ||
    normalizedProfile.pronouns.trim(),
  );
  const hasPersonalization = Boolean(
    normalizedProfile.serviceInterests.length > 0 ||
    normalizedProfile.accessibilityNeeds.length > 0 ||
    normalizedProfile.preferredDeliveryModes.length > 0 ||
    normalizedProfile.transportationBarrier ||
    normalizedProfile.documentationBarriers.length > 0 ||
    normalizedProfile.urgencyWindow ||
    normalizedProfile.digitalAccessBarrier ||
    normalizedProfile.additionalContext.trim(),
  );

  return {
    normalizedProfile,
    primaryNeedId,
    additionalNeedIds,
    interestSearchText,
    browseState,
    profileSignals,
    hasPersonalization,
    hasIdentityContext,
  };
}
