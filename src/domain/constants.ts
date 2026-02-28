/**
 * ORAN Domain Constants
 * Centralized constants used across the platform.
 */

import type { ConfidenceBand, OranRole, VerificationStatus } from './types';

// ============================================================
// CRISIS DETECTION
// ============================================================

/**
 * Keywords that trigger immediate crisis routing to 911/988/211.
 * These are checked before any other processing.
 * Adding a keyword here means ANY message containing it will route to crisis resources.
 */
export const CRISIS_KEYWORDS: readonly string[] = [
  // Suicidal ideation
  'suicide',
  'suicidal',
  'kill myself',
  'end my life',
  'take my life',
  'want to die',
  'better off dead',
  'no reason to live',
  'not worth living',
  'ending it all',
  'ending my life',
  'can\'t go on',
  'don\'t want to be here anymore',

  // Self-harm
  'self harm',
  'self-harm',
  'cutting myself',
  'hurt myself',
  'harming myself',

  // Overdose
  'overdose',
  'od\'ing',
  'took too many pills',
  'took too much',

  // Imminent danger / violence
  'being attacked',
  'someone is hurting me',
  'about to be hurt',
  'in danger right now',
  'immediate danger',
  'life threatening',
  'life-threatening',
  'emergency help',
  'help me now',
  'call 911',

  // Domestic violence
  'domestic violence',
  'being abused',
  'spouse is hurting me',
  'partner is hurting me',
  'boyfriend hitting me',
  'girlfriend hitting me',
  'abusive relationship',
  'afraid to go home',

  // Child abuse
  'child abuse',
  'abusing a child',
  'hurting a child',
  'child is being hurt',
  'cps',

  // Homelessness emergency
  'sleeping outside tonight',
  'nowhere to sleep',
  'no shelter tonight',
  'about to lose my home',
  'being evicted today',
  'evicted tonight',

  // Mental health crisis
  'mental breakdown',
  'having a breakdown',
  'psychotic break',
  'hearing voices telling me to',
  'can\'t stop crying',
  'complete despair',

  // Substance crisis
  'withdrawals',
  'going through withdrawal',
  'drug overdose',
] as const;

// ============================================================
// CONFIDENCE SCORING
// ============================================================

export const ORAN_CONFIDENCE_WEIGHTS = {
  verification: 0.45,
  eligibility: 0.40,
  constraint: 0.15,
} as const;

export const VERIFICATION_SIGNAL_WEIGHTS = {
  orgVerified: 35,
  communityPhone: 25,
  communityInPerson: 35,
  documentProof: 20,
  websiteHealth: 10,
  multipleConfirmations90d: 10,
} as const;

export const VERIFICATION_PENALTIES = {
  staleOver180Days: -25,
  repeatedUserReportsTrend: -15,
  invalidContact: -30,
  moderationFlag: -10,
} as const;

export const CONFIDENCE_BANDS: Record<ConfidenceBand, { min: number; max: number; label: string }> = {
  HIGH:     { min: 80, max: 100, label: 'High confidence' },
  LIKELY:   { min: 60, max: 79, label: 'Likely — confirm hours/eligibility' },
  POSSIBLE: { min: 0, max: 59, label: "Possible — here's what to verify" },
} as const;

// ============================================================
// VERIFICATION
// ============================================================

export const VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'pending',
  'in_review',
  'verified',
  'rejected',
  'escalated',
] as const;

// ============================================================
// ROLES
// ============================================================

export const ROLES: readonly OranRole[] = [
  'seeker',
  'host_member',
  'host_admin',
  'community_admin',
  'oran_admin',
] as const;

export const ROLE_HIERARCHY: Record<OranRole, number> = {
  seeker:           0,
  host_member:      1,
  host_admin:       2,
  community_admin:  3,
  oran_admin:       4,
} as const;

// ============================================================
// PERMISSIONS
// ============================================================

export const PERMISSIONS = {
  // Organizations
  READ_ORGANIZATIONS: 'read:organizations',
  WRITE_OWN_ORGANIZATION: 'write:own_organization',
  WRITE_ANY_ORGANIZATION: 'write:any_organization',

  // Services
  READ_SERVICES: 'read:services',
  WRITE_OWN_SERVICES: 'write:own_services',
  WRITE_ANY_SERVICES: 'write:any_services',

  // Verification
  SUBMIT_VERIFICATION: 'submit:verification',
  REVIEW_VERIFICATION: 'review:verification',
  APPROVE_VERIFICATION: 'approve:verification',

  // Users & Roles
  READ_OWN_PROFILE: 'read:own_profile',
  MANAGE_HOST_MEMBERS: 'manage:host_members',
  MANAGE_ROLES: 'manage:roles',

  // Admin
  READ_AUDIT_LOGS: 'read:audit_logs',
  MANAGE_FEATURE_FLAGS: 'manage:feature_flags',
  MANAGE_COVERAGE_ZONES: 'manage:coverage_zones',
} as const;

// ============================================================
// CHAT & QUOTA
// ============================================================

/** Maximum messages per chat session */
export const MAX_CHAT_QUOTA = 50;

/** Rate limit sliding window in milliseconds (1 minute) */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Maximum chat API requests per RATE_LIMIT_WINDOW_MS */
export const RATE_LIMIT_MAX_REQUESTS = 20;

/** Maximum search API requests per RATE_LIMIT_WINDOW_MS */
export const SEARCH_RATE_LIMIT_MAX_REQUESTS = 60;

/** Maximum feedback API requests per RATE_LIMIT_WINDOW_MS */
export const FEEDBACK_RATE_LIMIT_MAX_REQUESTS = 10;

/** Maximum services returned per chat response */
export const MAX_SERVICES_PER_RESPONSE = 5;

// ============================================================
// ELIGIBILITY DISCLAIMER
// ============================================================

/**
 * REQUIRED disclaimer — must appear on every response containing service recommendations.
 * ORAN never guarantees eligibility. Services are surfaced from DB records only.
 */
export const ELIGIBILITY_DISCLAIMER =
  'Results shown are from verified records. Eligibility is determined by each service ' +
  'provider — ORAN does not guarantee qualification. Always confirm with the provider. ' +
  'Information may have changed since last verification.';

// ============================================================
// CRISIS RESOURCES
// ============================================================

export const CRISIS_RESOURCES = {
  emergency: '911' as const,
  crisisLine: '988' as const,
  communityLine: '211' as const,
  crisisMessage:
    'It sounds like you may be in crisis or immediate danger. Please reach out for help immediately. ' +
    'You are not alone, and support is available right now.',
} as const;

// ============================================================
// FEATURE FLAG NAMES
// ============================================================

export const FEATURE_FLAGS = {
  LLM_SUMMARIZE:  'llm_summarize',
  MAP_ENABLED:    'map_enabled',
  FEEDBACK_FORM:  'feedback_form',
  HOST_CLAIMS:    'host_claims',
} as const;

// ============================================================
// SEARCH DEFAULTS
// ============================================================

export const DEFAULT_SEARCH_RADIUS_METERS = 16_093; // ~10 miles
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
