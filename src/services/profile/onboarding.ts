import { z } from 'zod';

import {
  DISCOVERY_NEED_IDS,
  getDiscoveryNeed,
  type DiscoveryNeedId,
} from '@/domain/discoveryNeeds';

import {
  ACCESSIBILITY_NEED_VALUES,
  EMPLOYMENT_STATUS_VALUES,
  INCOME_RANGE_VALUES,
  normalizeSeekerProfile,
  type SeekerProfile,
} from './contracts';

export const ONBOARDING_CONSENT_VERSION = 'onboarding-profile-v1';

export const ONBOARDING_URGENCY_VALUES = [
  'today',
  'one_to_two_days',
  'this_week',
  'planning',
  'prefer_not_to_say',
] as const;

export const ONBOARDING_AUDIENCE_VALUES = [
  'self',
  'child',
  'household',
  'someone_else',
  'prefer_not_to_say',
] as const;

export const IMMIGRATION_SUPPORT_VALUES = [
  'immigration_legal_aid',
  'language_support',
  'no_ssn_services',
] as const;

export type OnboardingUrgency = (typeof ONBOARDING_URGENCY_VALUES)[number];
export type OnboardingAudience = (typeof ONBOARDING_AUDIENCE_VALUES)[number];
export type ImmigrationSupportNeed = (typeof IMMIGRATION_SUPPORT_VALUES)[number];

export const OnboardingDraftSchema = z.object({
  needId: z.enum(DISCOVERY_NEED_IDS).or(z.literal('')).default(''),
  customNeed: z.string().max(160).default(''),
  approximateLocation: z.string().max(100).default(''),
  urgency: z.enum(ONBOARDING_URGENCY_VALUES).or(z.literal('')).default(''),
  audience: z.enum(ONBOARDING_AUDIENCE_VALUES).or(z.literal('')).default(''),
  householdSize: z.number().int().min(1).max(20).nullable().default(null),
  employmentStatus: z.enum(EMPLOYMENT_STATUS_VALUES).or(z.literal('')).default(''),
  incomeRange: z.enum(INCOME_RANGE_VALUES).or(z.literal('')).default(''),
  accessibilityNeeds: z.array(z.enum(ACCESSIBILITY_NEED_VALUES)).max(8).default([]),
  veteranSupport: z.boolean().default(false),
  immigrationSupportNeeds: z.array(z.enum(IMMIGRATION_SUPPORT_VALUES)).max(3).default([]),
});

export type OnboardingDraft = z.infer<typeof OnboardingDraftSchema>;

export const EMPTY_ONBOARDING_DRAFT: OnboardingDraft = OnboardingDraftSchema.parse({});

const URGENCY_PROMPTS: Partial<Record<OnboardingUrgency, string>> = {
  today: 'I need help today.',
  one_to_two_days: 'I need help within the next one or two days.',
  this_week: 'I need help this week.',
  planning: 'I am planning ahead.',
};

const AUDIENCE_PROMPTS: Partial<Record<OnboardingAudience, string>> = {
  self: 'This help is for me.',
  child: 'This help is for a child.',
  household: 'This help is for my household.',
  someone_else: 'This help is for someone else.',
};

const EMPLOYMENT_PROMPTS: Partial<Record<OnboardingDraft['employmentStatus'], string>> = {
  employed_full_time: 'I am employed full time.',
  employed_part_time: 'I am employed part time.',
  self_employed: 'I am self-employed.',
  unemployed_looking: 'I am looking for work.',
  not_currently_working: 'I am not currently working.',
  student: 'I am a student.',
  retired: 'I am retired.',
};

const INCOME_PROMPTS: Partial<Record<OnboardingDraft['incomeRange'], string>> = {
  no_income: 'My household currently has no monthly income.',
  under_1500_monthly: 'My approximate monthly household income is under $1,500.',
  '1500_2999_monthly': 'My approximate monthly household income is between $1,500 and $2,999.',
  '3000_4999_monthly': 'My approximate monthly household income is between $3,000 and $4,999.',
  '5000_plus_monthly': 'My approximate monthly household income is $5,000 or more.',
};

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}

export function normalizeOnboardingDraft(
  draft: Partial<OnboardingDraft> | null | undefined,
): OnboardingDraft {
  const parsed = OnboardingDraftSchema.safeParse(draft ?? {});
  return parsed.success ? parsed.data : { ...EMPTY_ONBOARDING_DRAFT };
}

export function hasOnboardingNeed(draft: Partial<OnboardingDraft>): boolean {
  const normalized = normalizeOnboardingDraft(draft);
  return Boolean(normalized.needId || normalized.customNeed.trim());
}

export function buildOnboardingChatPrompt(draft: Partial<OnboardingDraft>): string {
  const normalized = normalizeOnboardingDraft(draft);
  const selectedNeed = normalized.needId ? getDiscoveryNeed(normalized.needId) : undefined;
  const customNeed = normalized.customNeed.trim().replace(/\s+/g, ' ');
  const need = customNeed || selectedNeed?.queryText;
  if (!need) return '';

  const parts = [customNeed
    ? `I am looking for ${customNeed.replace(/[.!?]+$/, '')}.`
    : `I need help with ${need.replace(/[.!?]+$/, '')}.`];
  const location = normalized.approximateLocation.trim().replace(/\s+/g, ' ');
  if (location) parts.push(`Please look near ${location.replace(/[.!?]+$/, '')}.`);

  const urgency = normalized.urgency ? URGENCY_PROMPTS[normalized.urgency] : undefined;
  if (urgency) parts.push(urgency);

  const audience = normalized.audience ? AUDIENCE_PROMPTS[normalized.audience] : undefined;
  if (audience) parts.push(audience);
  if (normalized.householdSize !== null) {
    parts.push(`My household has ${normalized.householdSize} ${normalized.householdSize === 1 ? 'person' : 'people'}.`);
  }

  const employment = normalized.employmentStatus
    ? EMPLOYMENT_PROMPTS[normalized.employmentStatus]
    : undefined;
  if (employment) parts.push(employment);

  const income = normalized.incomeRange ? INCOME_PROMPTS[normalized.incomeRange] : undefined;
  if (income) parts.push(income);

  if (normalized.accessibilityNeeds.length > 0) {
    parts.push(`I need these access options: ${normalized.accessibilityNeeds.join(', ').replaceAll('_', ' ')}.`);
  }
  if (normalized.veteranSupport) {
    parts.push('Please include veteran or military-family services.');
  }
  if (normalized.immigrationSupportNeeds.includes('immigration_legal_aid')) {
    parts.push('Please include immigration legal aid.');
  }
  if (normalized.immigrationSupportNeeds.includes('language_support')) {
    parts.push('Please prioritize services with language support.');
  }
  if (normalized.immigrationSupportNeeds.includes('no_ssn_services')) {
    parts.push('Please prioritize services that do not require a Social Security number.');
  }

  return parts.join(' ');
}

export function getOnboardingNeedId(draft: Partial<OnboardingDraft>): DiscoveryNeedId | null {
  const normalized = normalizeOnboardingDraft(draft);
  return normalized.needId || null;
}

export function mergeOnboardingIntoProfile(
  existingProfile: Partial<SeekerProfile> | null | undefined,
  draft: Partial<OnboardingDraft>,
  completedAt = new Date().toISOString(),
): SeekerProfile {
  const existing = normalizeSeekerProfile(existingProfile);
  const normalized = normalizeOnboardingDraft(draft);
  const legalAidRequested = normalized.immigrationSupportNeeds.includes('immigration_legal_aid');
  const languageSupportRequested = normalized.immigrationSupportNeeds.includes('language_support');
  const noSsnRequested = normalized.immigrationSupportNeeds.includes('no_ssn_services');

  const serviceInterests = unique([
    ...existing.serviceInterests,
    ...(normalized.needId ? [normalized.needId] : []),
    ...(legalAidRequested ? ['legal_aid' as const] : []),
  ]);

  return normalizeSeekerProfile({
    ...existing,
    serviceInterests,
    accessibilityNeeds: unique([
      ...existing.accessibilityNeeds,
      ...normalized.accessibilityNeeds,
      ...(languageSupportRequested ? ['language_interpretation' as const] : []),
    ]),
    documentationBarriers: unique([
      ...existing.documentationBarriers,
      ...(noSsnRequested ? ['no_ssn' as const] : []),
    ]),
    urgencyWindow: normalized.urgency === 'today'
      ? 'same_day'
      : normalized.urgency === 'one_to_two_days'
        ? 'next_day'
        : normalized.urgency === 'this_week' || normalized.urgency === 'planning'
          ? 'flexible'
          : existing.urgencyWindow,
    employmentStatus: normalized.employmentStatus || existing.employmentStatus,
    incomeRange: normalized.incomeRange || existing.incomeRange,
    householdSize: normalized.householdSize ?? existing.householdSize,
    veteranServicePreference: normalized.veteranSupport || existing.veteranServicePreference,
    onboardingProfileConsent: true,
    onboardingConsentVersion: ONBOARDING_CONSENT_VERSION,
    onboardingCompletedAt: completedAt,
  });
}
