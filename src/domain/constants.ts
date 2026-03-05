/**
 * ORAN Domain Constants
 * Centralized constants used across the platform.
 */

import type {
  ConfidenceBand,
  OranRole,
  VerificationStatus,
  SubmissionStatus,
  SubmissionType,
  SubmissionTargetType,
  ScopeRiskLevel,
  NotificationEventType,
} from './types';

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
// SUBMISSIONS (Universal Pipeline)
// ============================================================

export const SUBMISSION_STATUSES: readonly SubmissionStatus[] = [
  'draft',
  'submitted',
  'auto_checking',
  'needs_review',
  'under_review',
  'escalated',
  'pending_second_approval',
  'approved',
  'denied',
  'returned',
  'withdrawn',
  'expired',
  'archived',
] as const;

export const SUBMISSION_TYPES: readonly SubmissionType[] = [
  'service_verification',
  'confidence_regression',
  'org_claim',
  'data_correction',
  'new_service',
  'removal_request',
  'community_report',
  'appeal',
] as const;

export const SUBMISSION_TARGET_TYPES: readonly SubmissionTargetType[] = [
  'service',
  'organization',
  'location',
  'user',
  'system',
] as const;

/**
 * Valid state transitions in the submission workflow.
 * Key = current status, value = array of permitted next statuses.
 */
export const SUBMISSION_TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  draft:                    ['submitted', 'withdrawn'],
  submitted:                ['auto_checking', 'needs_review', 'withdrawn'],
  auto_checking:            ['needs_review', 'approved', 'denied'],
  needs_review:             ['under_review', 'expired'],
  under_review:             ['escalated', 'pending_second_approval', 'approved', 'denied', 'returned'],
  escalated:                ['under_review', 'approved', 'denied'],
  pending_second_approval:  ['approved', 'denied', 'returned'],
  approved:                 ['archived'],
  denied:                   ['archived'],
  returned:                 ['submitted', 'withdrawn'],
  withdrawn:                ['archived'],
  expired:                  ['archived'],
  archived:                 [],
} as const;

/**
 * Submission types that require two-person (second-approver) gating.
 */
export const TWO_PERSON_REQUIRED_TYPES: readonly SubmissionType[] = [
  'org_claim',
  'removal_request',
] as const;

/**
 * Map legacy VerificationStatus → SubmissionStatus for migration compatibility.
 */
export const LEGACY_STATUS_MAP: Record<VerificationStatus, SubmissionStatus> = {
  pending:   'submitted',
  in_review: 'under_review',
  verified:  'approved',
  rejected:  'denied',
  escalated: 'escalated',
} as const;

/**
 * Confidence score tiers for auto-checking gate.
 * Submissions with auto_score >= autoApproveMin skip manual review.
 * Submissions with auto_score < sendToReviewBelow go to needs_review.
 */
export const AUTO_CHECK_THRESHOLDS = {
  autoApproveMin: 90,
  sendToReviewBelow: 70,
} as const;

// ============================================================
// SCOPE RISK LEVELS
// ============================================================

export const SCOPE_RISK_LEVELS: readonly ScopeRiskLevel[] = [
  'low',
  'standard',
  'elevated',
  'critical',
] as const;

// ============================================================
// NOTIFICATION EVENT TYPES
// ============================================================

export const NOTIFICATION_EVENT_TYPES: readonly NotificationEventType[] = [
  'submission_assigned',
  'submission_status_changed',
  'submission_sla_warning',
  'submission_sla_breach',
  'scope_grant_requested',
  'scope_grant_decided',
  'scope_grant_revoked',
  'two_person_approval_needed',
  'system_alert',
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

  // Verification (legacy)
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

  // Submissions (universal pipeline)
  SUBMISSION_CREATE: 'submission:create',
  SUBMISSION_READ_OWN: 'submission:read_own',
  SUBMISSION_READ_ASSIGNED: 'submission:read_assigned',
  SUBMISSION_READ_ALL: 'submission:read_all',
  SUBMISSION_REVIEW: 'submission:review',
  SUBMISSION_APPROVE: 'submission:approve',
  SUBMISSION_DENY: 'submission:deny',
  SUBMISSION_ESCALATE: 'submission:escalate',
  SUBMISSION_SECOND_APPROVE: 'submission:second_approve',
  SUBMISSION_LOCK: 'submission:lock',
  SUBMISSION_REASSIGN: 'submission:reassign',
  SUBMISSION_BULK_ACTION: 'submission:bulk_action',

  // Scope administration
  SCOPE_GRANT: 'scope:grant',
  SCOPE_REVOKE: 'scope:revoke',
  SCOPE_REQUEST: 'scope:request',
  SCOPE_APPROVE_GRANT: 'scope:approve_grant',

  // Notification management
  NOTIFICATION_MANAGE_TEMPLATES: 'notification:manage_templates',
  NOTIFICATION_BROADCAST: 'notification:broadcast',

  // Platform settings
  PLATFORM_SETTINGS_READ: 'platform:settings_read',
  PLATFORM_SETTINGS_WRITE: 'platform:settings_write',
  PLATFORM_TOGGLE_FEATURES: 'platform:toggle_features',
} as const;

// ============================================================
// CHAT & QUOTA
// ============================================================

/** Maximum messages per chat session */
export const MAX_CHAT_QUOTA = 50;

/** Session quota TTL for in-memory quota tracking (6 hours) */
export const SESSION_QUOTA_TTL_MS = 6 * 60 * 60 * 1000;

/** Maximum number of sessions tracked in-memory for quota (evicts oldest by lastSeen) */
export const MAX_SESSION_QUOTA_ENTRIES = 2000;

/** Rate limit sliding window in milliseconds (1 minute) */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Maximum chat API requests per RATE_LIMIT_WINDOW_MS */
export const RATE_LIMIT_MAX_REQUESTS = 20;

/** Maximum search API requests per RATE_LIMIT_WINDOW_MS */
export const SEARCH_RATE_LIMIT_MAX_REQUESTS = 60;

/** Maximum feedback API requests per RATE_LIMIT_WINDOW_MS */
export const FEEDBACK_RATE_LIMIT_MAX_REQUESTS = 10;

/** Maximum host write (create/update/delete) API requests per RATE_LIMIT_WINDOW_MS */
export const HOST_WRITE_RATE_LIMIT_MAX_REQUESTS = 30;

/** Maximum host read API requests per RATE_LIMIT_WINDOW_MS */
export const HOST_READ_RATE_LIMIT_MAX_REQUESTS = 60;

/** Maximum community-admin write API requests per RATE_LIMIT_WINDOW_MS */
export const COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS = 30;

/** Maximum community-admin read API requests per RATE_LIMIT_WINDOW_MS */
export const COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS = 60;

/** Maximum oran-admin write API requests per RATE_LIMIT_WINDOW_MS */
export const ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS = 30;

/** Maximum oran-admin read API requests per RATE_LIMIT_WINDOW_MS */
export const ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS = 60;

/** Maximum authenticated user read API requests per RATE_LIMIT_WINDOW_MS */
export const USER_READ_RATE_LIMIT_MAX_REQUESTS = 60;

/** Maximum authenticated user write API requests per RATE_LIMIT_WINDOW_MS */
export const USER_WRITE_RATE_LIMIT_MAX_REQUESTS = 30;

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
  LLM_SUMMARIZE:         'llm_summarize',
  MAP_ENABLED:           'map_enabled',
  FEEDBACK_FORM:         'feedback_form',
  HOST_CLAIMS:           'host_claims',
  TWO_PERSON_APPROVAL:   'two_person_approval',
  SLA_ENFORCEMENT:       'sla_enforcement',
  AUTO_CHECK_GATE:       'auto_check_gate',
  NOTIFICATIONS_IN_APP:  'notifications_in_app',
  /**
   * Enables Azure AI Content Safety as a second crisis detection gate.
   * Runs AFTER keyword matching, ONLY when local distress signals are found.
   * Requires AZURE_CONTENT_SAFETY_ENDPOINT + AZURE_CONTENT_SAFETY_KEY env vars.
   * Azure AI Content Safety F0 free tier: 5,000 text records/month.
   */
  CONTENT_SAFETY_CRISIS: 'content_safety_crisis',
} as const;

// ============================================================
// SEARCH DEFAULTS
// ============================================================

export const DEFAULT_SEARCH_RADIUS_METERS = 16_093; // ~10 miles
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
