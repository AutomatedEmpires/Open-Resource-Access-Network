import type { Intent, ChatContext } from './types';
import type { SearchQuery, SearchPreferenceSignals } from '@/services/search/types';
import type { ServiceInterestId } from '@/services/profile/contracts';

interface BuildChatSearchQueryOptions {
  taxonomyTermIds?: string[];
  minConfidenceScore?: number;
  limit: number;
}

const SELF_IDENTIFIER_TO_POPULATION_TAG: Record<string, string> = {
  pregnant: 'pregnant',
  new_parent: 'postpartum',
  caregiver: 'caregiver',
  dv_survivor: 'dv_survivor',
  reentry: 'reentry',
  undocumented_friendly: 'undocumented_friendly',
  refugee: 'refugee',
};

const SELF_IDENTIFIER_TO_CULTURE_TAG: Record<string, string> = {
  lgbtq: 'lgbtq_affirming',
};

const HOUSING_SITUATION_TO_SITUATION_TAG: Record<string, string> = {
  unhoused: 'no_fixed_address',
  shelter: 'no_fixed_address',
  couch_surfing: 'no_fixed_address',
};

const HOUSEHOLD_TYPE_TO_POPULATION_TAG: Record<string, string> = {
  single_parent: 'single_parent',
};

const ACCESSIBILITY_TO_ACCESS_TAGS: Record<string, string[]> = {
  language_interpretation: ['interpreter_on_site'],
  child_friendly: ['childcare_available'],
  evening_hours: ['evening_hours', 'weekend_hours', 'after_hours'],
};

const ACCESSIBILITY_TO_DELIVERY_TAGS: Record<string, string[]> = {
  virtual_option: ['virtual', 'phone', 'hybrid'],
};

const DOCUMENTATION_BARRIER_TO_ACCESS_TAGS: Record<string, string[]> = {
  no_id: ['no_id_required'],
  no_documents: ['no_documentation_required'],
  no_ssn: ['no_ssn_required'],
};

const URGENCY_WINDOW_TO_ACCESS_TAGS: Record<string, string[]> = {
  same_day: ['same_day'],
  next_day: ['same_day', 'next_day'],
};

const SERVICE_INTEREST_TO_QUERY_TERMS: Record<ServiceInterestId, string> = {
  food_assistance: 'food assistance',
  housing: 'housing',
  mental_health: 'mental health',
  healthcare: 'healthcare',
  employment: 'employment',
  childcare: 'childcare',
  transportation: 'transportation',
  legal_aid: 'legal aid',
  utility_assistance: 'utility assistance',
  substance_use: 'substance use',
  domestic_violence: 'domestic violence',
  education: 'education',
};

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function buildHydratedSearchText(intent: Intent, context: ChatContext): string {
  if (intent.category !== 'general') {
    return intent.rawQuery;
  }

  const preferenceTerms = uniqueStrings(
    (context.userProfile?.serviceInterests ?? [])
      .map((interest) => SERVICE_INTEREST_TO_QUERY_TERMS[interest as ServiceInterestId])
      .slice(0, 3)
  );

  if (preferenceTerms.length === 0) {
    return intent.rawQuery;
  }

  return `${intent.rawQuery} ${preferenceTerms.join(' ')}`.trim();
}

export function buildChatSearchProfileSignals(context: ChatContext): SearchPreferenceSignals | undefined {
  const userProfile = context.userProfile;
  if (!userProfile) {
    return undefined;
  }

  const populationTags = uniqueStrings([
    ...((userProfile.selfIdentifiers ?? []).map((value) => SELF_IDENTIFIER_TO_POPULATION_TAG[value])),
    HOUSEHOLD_TYPE_TO_POPULATION_TAG[userProfile.householdType ?? ''],
  ]);

  const situationTags = uniqueStrings([
    HOUSING_SITUATION_TO_SITUATION_TAG[userProfile.housingSituation ?? ''],
    ...(context.locale !== 'en' ? ['language_barrier'] : []),
    ...((userProfile.accessibilityNeeds ?? []).includes('language_interpretation') ? ['language_barrier'] : []),
    ...(userProfile.transportationBarrier ? ['transportation_barrier'] : []),
    ...(userProfile.digitalAccessBarrier ? ['digital_barrier'] : []),
  ]);

  const accessTags = uniqueStrings([
    ...(userProfile.accessibilityNeeds ?? []).flatMap((value) => ACCESSIBILITY_TO_ACCESS_TAGS[value] ?? []),
    ...(userProfile.documentationBarriers ?? []).flatMap((value) => DOCUMENTATION_BARRIER_TO_ACCESS_TAGS[value] ?? []),
    ...(userProfile.urgencyWindow ? (URGENCY_WINDOW_TO_ACCESS_TAGS[userProfile.urgencyWindow] ?? []) : []),
    ...(userProfile.transportationBarrier ? ['transportation_provided'] : []),
  ]);

  const deliveryTags = uniqueStrings([
    ...(userProfile.accessibilityNeeds ?? []).flatMap((value) => ACCESSIBILITY_TO_DELIVERY_TAGS[value] ?? []),
    ...(userProfile.preferredDeliveryModes ?? []),
  ]);

  const cultureTags = uniqueStrings([
    ...((userProfile.selfIdentifiers ?? []).map((value) => SELF_IDENTIFIER_TO_CULTURE_TAG[value])),
    ...((userProfile.accessibilityNeeds ?? []).includes('language_interpretation') ? ['bilingual_services'] : []),
    ...(context.locale !== 'en' ? ['bilingual_services'] : []),
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

export function buildChatSearchQuery(
  intent: Intent,
  context: ChatContext,
  options: BuildChatSearchQueryOptions
): SearchQuery {
  return {
    text: buildHydratedSearchText(intent, context),
    filters: {
      status: 'active',
      taxonomyTermIds: options.taxonomyTermIds,
      minConfidenceScore: options.minConfidenceScore,
    },
    pagination: {
      page: 1,
      limit: options.limit,
    },
    cachePolicy: 'skip',
    cityBias: context.approximateLocation?.city ?? context.userProfile?.locationCity,
    profileSignals: buildChatSearchProfileSignals(context),
    sortBy: 'relevance',
  };
}
