import { z } from 'zod';

export const ACCENT_THEME_VALUES = ['ocean', 'blossom', 'forest', 'sunset', 'midnight'] as const;
export const SERVICE_INTEREST_VALUES = [
  'food_assistance',
  'housing',
  'mental_health',
  'healthcare',
  'employment',
  'childcare',
  'transportation',
  'legal_aid',
  'utility_assistance',
  'substance_use',
  'domestic_violence',
  'education',
] as const;
export const DELIVERY_MODE_VALUES = ['in_person', 'virtual', 'phone', 'hybrid'] as const;
export const URGENCY_WINDOW_VALUES = ['same_day', 'next_day', 'flexible'] as const;
export const DOCUMENTATION_BARRIER_VALUES = ['no_id', 'no_documents', 'no_ssn'] as const;

export type ServiceInterestId = (typeof SERVICE_INTEREST_VALUES)[number];
export type DeliveryModeId = (typeof DELIVERY_MODE_VALUES)[number];
export type UrgencyWindowId = (typeof URGENCY_WINDOW_VALUES)[number];
export type DocumentationBarrierId = (typeof DOCUMENTATION_BARRIER_VALUES)[number];

export const SeekerProfileSchema = z.object({
  serviceInterests: z.array(z.enum(SERVICE_INTEREST_VALUES)).max(32).default([]),
  ageGroup: z.string().max(50).default(''),
  householdType: z.string().max(50).default(''),
  housingSituation: z.string().max(50).default(''),
  selfIdentifiers: z.array(z.string().min(1).max(100)).max(32).default([]),
  currentServices: z.array(z.string().min(1).max(100)).max(32).default([]),
  accessibilityNeeds: z.array(z.string().min(1).max(100)).max(32).default([]),
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
