/**
 * Chat-first resource navigation contracts.
 *
 * These types describe the seeker-facing intake and recommendation layer. They
 * intentionally reference canonical provider/service IDs instead of creating a
 * second resource database. Stored HSDS entities and source records remain the
 * source of truth.
 */

export const NEED_CATEGORIES = [
  'food',
  'shelter_housing',
  'utility_assistance',
  'employment_workforce',
  'youth_family',
  'disability',
  'veterans',
  'legal_aid',
  'domestic_violence',
  'mental_health_support',
  'substance_recovery',
  'transportation',
  'healthcare_clinics',
  'emergency_urgent_routing',
] as const;

export type NeedCategory = (typeof NEED_CATEGORIES)[number];

export const URGENCY_LEVELS = ['immediate', 'today', 'within_days', 'planning'] as const;
export type UrgencyLevel = (typeof URGENCY_LEVELS)[number];

export const VERIFICATION_STATUSES = [
  'unverified',
  'source_verified',
  'phone_verified',
  'email_verified',
  'provider_verified',
  'volunteer_reviewed',
  'stale',
  'disputed',
  'retired',
] as const;

export type ResourceVerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export interface UserNeed {
  id: string;
  plainLanguageDescription: string;
  category?: NeedCategory;
  urgency?: UrgencyLevel;
  approximateLocation?: {
    cityOrPostalCode: string;
    stateProvince?: string;
  };
  audience?: 'self' | 'child' | 'family' | 'someone_else';
  eligibilityFactors?: Array<'age' | 'disability' | 'veteran' | 'housing' | 'income'>;
  accessConstraints?: Array<'can_travel' | 'cannot_travel' | 'phone' | 'online'>;
  createdAt: string;
}

export interface IntakeQuestion {
  id: string;
  prompt: string;
  field: 'need' | 'location' | 'urgency' | 'audience' | 'eligibility' | 'access';
  required: boolean;
  /** A question is asked only when its answer can change routing or ranking. */
  askWhen?: string;
}

export interface IntakeAnswer {
  questionId: string;
  value: string | string[];
  answeredAt: string;
}

export interface ResourceProvider {
  id: string;
  name: string;
  verificationStatus?: ResourceVerificationStatus;
}

export interface ServiceOffering {
  id: string;
  providerId: string;
  name: string;
  description?: string;
}

export interface EligibilityRule {
  id: string;
  serviceOfferingId: string;
  summary: string;
}

export interface CoverageArea {
  id: string;
  serviceOfferingId: string;
  label: string;
  kind: 'city' | 'county' | 'state' | 'postal_code' | 'nationwide' | 'custom';
}

export interface ContactMethod {
  kind: 'phone' | 'website' | 'intake_form' | 'email' | 'address';
  label: string;
  value: string;
}

export interface IntakeStep {
  order: number;
  label: string;
  description?: string;
  url?: string;
}

export interface SourceRecordSummary {
  id?: string;
  label: string;
  url?: string;
  lastCheckedAt?: string;
  verificationStatus?: ResourceVerificationStatus;
}

export interface IssueReport {
  id: string;
  serviceOfferingId: string;
  reason: 'closed' | 'wrong_contact' | 'wrong_hours' | 'wrong_eligibility' | 'other';
  details: string;
  status: 'submitted' | 'under_review' | 'resolved' | 'dismissed';
}

export interface VolunteerReviewTask {
  id: string;
  targetType: 'issue_report' | 'provider_update' | 'source_candidate' | 'provider_claim';
  targetId: string;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  status: 'open' | 'claimed' | 'completed' | 'escalated';
}

export interface ProviderClaim {
  id: string;
  providerId: string;
  requestedByUserId: string;
  status: 'submitted' | 'under_review' | 'approved' | 'denied';
}

export interface MatchScore {
  /** Trust remains distinct from fit and is never replaced by this score. */
  verificationConfidence: number;
  eligibilityMatch: number;
  constraintFit: number;
  reasons: string[];
}

export interface GuidedIntakeDraft {
  need: string;
  location?: string;
  urgency?: Exclude<UrgencyLevel, 'immediate'>;
  audience?: UserNeed['audience'];
  accessMode?: 'can_travel' | 'cannot_travel' | 'phone' | 'online';
}

const URGENCY_PROMPTS: Record<Exclude<UrgencyLevel, 'immediate'>, string> = {
  today: 'I need help today.',
  within_days: 'I need help within the next few days.',
  planning: 'I am planning ahead.',
};

const AUDIENCE_PROMPTS: Record<NonNullable<UserNeed['audience']>, string> = {
  self: 'This is for me.',
  child: 'This is for a child.',
  family: 'This is for my family or household.',
  someone_else: 'This is for someone else.',
};

const ACCESS_PROMPTS: Record<NonNullable<GuidedIntakeDraft['accessMode']>, string> = {
  can_travel: 'I can travel to a provider.',
  cannot_travel: 'I cannot travel and need remote or nearby help.',
  phone: 'I need help I can reach by phone.',
  online: 'I need online help.',
};

/**
 * Converts explicitly supplied intake fields into one plain-language chat turn.
 * It never adds eligibility, location, or urgency facts the seeker did not give.
 */
export function buildGuidedIntakePrompt(draft: GuidedIntakeDraft): string {
  const need = draft.need.trim().replace(/\s+/g, ' ');
  if (!need) return '';

  const parts = [need.replace(/[.!?]+$/, '') + '.'];
  const location = draft.location?.trim().replace(/\s+/g, ' ');
  if (location) parts.push(`Near ${location.replace(/[.!?]+$/, '')}.`);
  if (draft.urgency) parts.push(URGENCY_PROMPTS[draft.urgency]);
  if (draft.audience) parts.push(AUDIENCE_PROMPTS[draft.audience]);
  if (draft.accessMode) parts.push(ACCESS_PROMPTS[draft.accessMode]);
  return parts.join(' ');
}

export function formatVerificationStatus(status: ResourceVerificationStatus): string {
  return status
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function needsVerificationWarning(status?: ResourceVerificationStatus): boolean {
  return status == null || ['unverified', 'stale', 'disputed', 'retired'].includes(status);
}
