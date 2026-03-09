import { z } from 'zod';
import { DISCOVERY_NEED_IDS } from '@/domain/discoveryNeeds';

export const ACCENT_THEME_VALUES = ['ocean', 'blossom', 'forest', 'sunset', 'midnight'] as const;
export const SERVICE_INTEREST_VALUES = DISCOVERY_NEED_IDS;
export const AGE_GROUP_VALUES = ['under18', '18_24', '25_54', '55_64', '65plus', 'prefer_not_to_say'] as const;
export const HOUSEHOLD_TYPE_VALUES = ['single', 'couple', 'family_with_children', 'single_parent', 'multigenerational', 'other'] as const;
export const HOUSING_SITUATION_VALUES = ['housed_stable', 'at_risk', 'unhoused', 'shelter', 'couch_surfing'] as const;
export const SELF_IDENTIFIER_VALUES = ['veteran', 'senior_65plus', 'disability', 'pregnant', 'new_parent', 'caregiver', 'dv_survivor', 'reentry', 'undocumented_friendly', 'lgbtq', 'refugee'] as const;
export const CURRENT_SERVICE_VALUES = ['snap', 'medicaid', 'medicare', 'wic', 'section8', 'ssi_ssdi', 'tanf', 'chip', 'va_benefits', 'head_start', 'liheap'] as const;
export const ACCESSIBILITY_NEED_VALUES = ['wheelchair_access', 'hearing_support', 'vision_support', 'language_interpretation', 'quiet_space', 'child_friendly', 'virtual_option', 'evening_hours'] as const;
export const DELIVERY_MODE_VALUES = ['in_person', 'virtual', 'phone', 'hybrid'] as const;
export const URGENCY_WINDOW_VALUES = ['same_day', 'next_day', 'flexible'] as const;
export const DOCUMENTATION_BARRIER_VALUES = ['no_id', 'no_documents', 'no_ssn'] as const;

export type ServiceInterestId = (typeof SERVICE_INTEREST_VALUES)[number];
export type AgeGroupId = (typeof AGE_GROUP_VALUES)[number];
export type HouseholdTypeId = (typeof HOUSEHOLD_TYPE_VALUES)[number];
export type HousingSituationId = (typeof HOUSING_SITUATION_VALUES)[number];
export type SelfIdentifierId = (typeof SELF_IDENTIFIER_VALUES)[number];
export type CurrentServiceId = (typeof CURRENT_SERVICE_VALUES)[number];
export type AccessibilityNeedId = (typeof ACCESSIBILITY_NEED_VALUES)[number];
export type DeliveryModeId = (typeof DELIVERY_MODE_VALUES)[number];
export type UrgencyWindowId = (typeof URGENCY_WINDOW_VALUES)[number];
export type DocumentationBarrierId = (typeof DOCUMENTATION_BARRIER_VALUES)[number];

export const SeekerProfileSchema = z.object({
  serviceInterests: z.array(z.enum(SERVICE_INTEREST_VALUES)).max(32).default([]),
  ageGroup: z.enum(AGE_GROUP_VALUES).or(z.literal('')).default(''),
  householdType: z.enum(HOUSEHOLD_TYPE_VALUES).or(z.literal('')).default(''),
  housingSituation: z.enum(HOUSING_SITUATION_VALUES).or(z.literal('')).default(''),
  selfIdentifiers: z.array(z.enum(SELF_IDENTIFIER_VALUES)).max(32).default([]),
  currentServices: z.array(z.enum(CURRENT_SERVICE_VALUES)).max(32).default([]),
  accessibilityNeeds: z.array(z.enum(ACCESSIBILITY_NEED_VALUES)).max(32).default([]),
  transportationBarrier: z.boolean().default(false),
  preferredDeliveryModes: z.array(z.enum(DELIVERY_MODE_VALUES)).max(4).default([]),
  urgencyWindow: z.enum(URGENCY_WINDOW_VALUES).or(z.literal('')).default(''),
  documentationBarriers: z.array(z.enum(DOCUMENTATION_BARRIER_VALUES)).max(3).default([]),
  digitalAccessBarrier: z.boolean().default(false),
  pronouns: z.string().max(50).default(''),
  profileHeadline: z.string().max(120).default(''),
  avatarEmoji: z.string().max(8).default(''),
  accentTheme: z.enum(ACCENT_THEME_VALUES).default('ocean'),
  contactPhone: z.string().max(50).default(''),
  contactEmail: z.string().max(254).default(''),
  additionalContext: z.string().max(500).default(''),
});

export type SeekerProfile = z.infer<typeof SeekerProfileSchema>;

export const EMPTY_SEEKER_PROFILE: SeekerProfile = {
  serviceInterests: [],
  ageGroup: '',
  householdType: '',
  housingSituation: '',
  selfIdentifiers: [],
  currentServices: [],
  accessibilityNeeds: [],
  transportationBarrier: false,
  preferredDeliveryModes: [],
  urgencyWindow: '',
  documentationBarriers: [],
  digitalAccessBarrier: false,
  pronouns: '',
  profileHeadline: '',
  avatarEmoji: '',
  accentTheme: 'ocean',
  contactPhone: '',
  contactEmail: '',
  additionalContext: '',
};

export const UpdateProfileSchema = z.object({
  approximateCity: z.string().max(100).optional(),
  preferredLocale: z.string().max(10).optional(),
  displayName: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  seekerProfile: SeekerProfileSchema.optional(),
});

export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export function normalizeSeekerProfile(profile: Partial<SeekerProfile> | null | undefined): SeekerProfile {
  const parsed = SeekerProfileSchema.safeParse(profile ?? {});
  return parsed.success ? parsed.data : { ...EMPTY_SEEKER_PROFILE };
}

export function hasMeaningfulSeekerProfile(profile: Partial<SeekerProfile> | null | undefined): boolean {
  const normalized = normalizeSeekerProfile(profile);
  return Boolean(
    normalized.serviceInterests.length > 0 ||
    normalized.ageGroup ||
    normalized.householdType ||
    normalized.housingSituation ||
    normalized.selfIdentifiers.length > 0 ||
    normalized.currentServices.length > 0 ||
    normalized.accessibilityNeeds.length > 0 ||
    normalized.transportationBarrier ||
    normalized.preferredDeliveryModes.length > 0 ||
    normalized.urgencyWindow ||
    normalized.documentationBarriers.length > 0 ||
    normalized.digitalAccessBarrier ||
    normalized.pronouns.trim() ||
    normalized.profileHeadline.trim() ||
    normalized.avatarEmoji.trim() ||
    normalized.accentTheme !== 'ocean' ||
    normalized.contactPhone.trim() ||
    normalized.contactEmail.trim() ||
    normalized.additionalContext.trim()
  );
}
