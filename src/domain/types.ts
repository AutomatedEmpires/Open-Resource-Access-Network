/**
 * ORAN Domain Types
 * TypeScript types for all HSDS entities and ORAN extensions.
 * These types match the database schema defined in db/migrations/0000_initial_schema.sql
 */

// ============================================================
// CORE HSDS ENTITIES
// ============================================================

export interface Organization {
  id: string;
  name: string;
  description?: string | null;
  url?: string | null;
  email?: string | null;
  taxStatus?: string | null;
  taxId?: string | null;
  yearIncorporated?: number | null;
  legalStatus?: string | null;
  logoUrl?: string | null;
  uri?: string | null;
  /** Organization status: 'active', 'inactive', 'defunct' (migration 0007) */
  status: 'active' | 'inactive' | 'defunct';
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface Location {
  id: string;
  organizationId: string;
  name?: string | null;
  alternateName?: string | null;
  description?: string | null;
  transportation?: string | null;
  /** Approximate latitude (WGS84) — rounded for privacy in API responses */
  latitude?: number | null;
  /** Approximate longitude (WGS84) — rounded for privacy in API responses */
  longitude?: number | null;
  /** Structured transit access tags: 'bus_stop_nearby', 'subway_nearby', etc. */
  transitAccess?: string[] | null;
  /** Parking availability: 'yes', 'no', 'street_only', 'paid', 'unknown' */
  parkingAvailable?: LocationParkingType | null;
  /** Location status: 'active', 'inactive', 'defunct' (migration 0007) */
  status: 'active' | 'inactive' | 'defunct';
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type LocationParkingType = 'yes' | 'no' | 'street_only' | 'paid' | 'unknown';

export interface Service {
  id: string;
  organizationId: string;
  programId?: string | null;
  name: string;
  alternateName?: string | null;
  description?: string | null;
  url?: string | null;
  email?: string | null;
  status: ServiceStatus;
  interpretationServices?: string | null;
  applicationProcess?: string | null;
  waitTime?: string | null;
  fees?: string | null;
  accreditations?: string | null;
  licenses?: string | null;
  /** Estimated wait time in days (NULL = unknown) */
  estimatedWaitDays?: number | null;
  /** Current capacity status: 'available', 'limited', 'waitlist', 'closed' */
  capacityStatus?: ServiceCapacityStatus | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export type ServiceStatus = 'active' | 'inactive' | 'defunct';
export type ServiceCapacityStatus = 'available' | 'limited' | 'waitlist' | 'closed';

export interface ServiceAtLocation {
  id: string;
  serviceId: string;
  locationId: string;
  description?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Phone {
  id: string;
  locationId?: string | null;
  serviceId?: string | null;
  organizationId?: string | null;
  number: string;
  extension?: string | null;
  type?: PhoneType | null;
  language?: string | null;
  description?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PhoneType = 'voice' | 'fax' | 'tty' | 'hotline' | 'sms';

export interface Address {
  id: string;
  locationId: string;
  attention?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  region?: string | null;
  stateProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Schedule {
  id: string;
  serviceId?: string | null;
  locationId?: string | null;
  validFrom?: Date | null;
  validTo?: Date | null;
  dtstart?: string | null;
  until?: string | null;
  wkst?: string | null;
  days?: string[] | null;
  opensAt?: string | null;
  closesAt?: string | null;
  description?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export interface TaxonomyTerm {
  id: string;
  term: string;
  description?: string | null;
  parentId?: string | null;
  taxonomy?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// ORAN EXTENSIONS
// ============================================================

export interface ConfidenceScore {
  id: string;
  serviceId: string;
  /** Final public confidence score on a 0–100 scale */
  score: number;
  /** ORAN public sub-score: verification confidence (0–100) */
  verificationConfidence: number;
  /** ORAN public sub-score: eligibility match (0–100) */
  eligibilityMatch: number;
  /** ORAN public sub-score: actionability/constraint fit (0–100) */
  constraintFit: number;
  computedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Re-export ConfidenceBand from the canonical source in confidence.ts
 * to avoid duplication. Use `import { ConfidenceBand } from '@/domain/confidence'`
 * for new code.
 */
export type { ConfidenceBand } from './confidence';

// ============================================================
// LEGACY VERIFICATION (kept for backward compatibility)
// ============================================================

export type VerificationStatus =
  | 'pending'
  | 'in_review'
  | 'verified'
  | 'rejected'
  | 'escalated';

export interface VerificationQueueEntry {
  id: string;
  serviceId: string;
  status: VerificationStatus;
  submittedByUserId: string;
  assignedToUserId?: string | null;
  notes?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// UNIVERSAL SUBMISSIONS (migration 0022)
// ============================================================

export type SubmissionType =
  | 'service_verification'
  | 'confidence_regression'
  | 'org_claim'
  | 'data_correction'
  | 'new_service'
  | 'removal_request'
  | 'community_report'
  | 'appeal'
  | 'managed_form';

export type SubmissionStatus =
  | 'draft'
  | 'submitted'
  | 'auto_checking'
  | 'needs_review'
  | 'under_review'
  | 'escalated'
  | 'pending_second_approval'
  | 'approved'
  | 'denied'
  | 'returned'
  | 'withdrawn'
  | 'expired'
  | 'archived';

export type SubmissionTargetType =
  | 'service'
  | 'organization'
  | 'location'
  | 'user'
  | 'system'
  | 'form_template';

export type SubmissionPriority = 0 | 1 | 2 | 3;

export interface Submission {
  id: string;
  submissionType: SubmissionType;
  status: SubmissionStatus;
  targetType: SubmissionTargetType;
  targetId?: string | null;
  serviceId?: string | null;
  submittedByUserId: string;
  assignedToUserId?: string | null;
  title?: string | null;
  notes?: string | null;
  reviewerNotes?: string | null;
  payload: Record<string, unknown>;
  evidence: SubmissionEvidenceItem[];
  priority: SubmissionPriority;
  isLocked: boolean;
  lockedAt?: Date | null;
  lockedByUserId?: string | null;
  slaDeadline?: Date | null;
  slaBreached: boolean;
  jurisdictionState?: string | null;
  jurisdictionCounty?: string | null;
  submittedAt?: Date | null;
  reviewedAt?: Date | null;
  resolvedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubmissionEvidenceItem {
  type: VerificationEvidenceType;
  description?: string;
  fileUrl?: string;
  fileName?: string;
  fileSizeBytes?: number;
  submittedByUserId: string;
  submittedAt: string;
}

export interface SubmissionTransition {
  id: string;
  submissionId: string;
  fromStatus: SubmissionStatus;
  toStatus: SubmissionStatus;
  actorUserId: string;
  actorRole?: string | null;
  reason?: string | null;
  gatesChecked: GateCheckResult[];
  gatesPassed: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface GateCheckResult {
  gate: string;
  passed: boolean;
  message?: string;
}

export interface SubmissionSla {
  id: string;
  submissionType: SubmissionType;
  jurisdictionState?: string | null;
  jurisdictionCounty?: string | null;
  reviewHours: number;
  escalationHours: number;
  notifyOnBreach: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// PLATFORM SCOPES & RBAC (migration 0022)
// ============================================================

export type ScopeRiskLevel = 'low' | 'standard' | 'elevated' | 'critical';
export type ScopeCategory =
  | 'submission'
  | 'verification'
  | 'org_management'
  | 'user_management'
  | 'platform_admin'
  | 'data_management'
  | 'reporting';

export interface PlatformScope {
  id: string;
  name: string;
  description: string;
  category: ScopeCategory;
  riskLevel: ScopeRiskLevel;
  requiresApproval: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformRole {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  isOrgScoped: boolean;
  hierarchyLevel: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RoleScopeAssignment {
  id: string;
  roleId: string;
  scopeId: string;
  createdAt: Date;
}

export interface UserScopeGrant {
  id: string;
  userId: string;
  scopeId: string;
  organizationId?: string | null;
  grantedByUserId: string;
  grantedAt: Date;
  expiresAt?: Date | null;
  isActive: boolean;
  approvalId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// TWO-PERSON APPROVAL (migration 0022)
// ============================================================

export type PendingGrantStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface PendingScopeGrant {
  id: string;
  userId: string;
  scopeId: string;
  organizationId?: string | null;
  requestedByUserId: string;
  requestedAt: Date;
  justification: string;
  status: PendingGrantStatus;
  decidedByUserId?: string | null;
  decidedAt?: Date | null;
  decisionReason?: string | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScopeAuditLogEntry {
  id: string;
  actorUserId: string;
  actorRole?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  justification?: string | null;
  ipDigest?: string | null;
  createdAt: Date;
}

// ============================================================
// NOTIFICATIONS (migration 0022)
// ============================================================

export type NotificationChannel = 'in_app' | 'email';
export type NotificationStatus = 'pending' | 'sent' | 'read' | 'failed';

export type NotificationEventType =
  | 'submission_assigned'
  | 'submission_status_changed'
  | 'submission_sla_warning'
  | 'submission_sla_breach'
  | 'submission_escalation_warning'
  | 'scope_grant_requested'
  | 'scope_grant_decided'
  | 'scope_grant_revoked'
  | 'two_person_approval_needed'
  | 'system_alert';

export interface NotificationEvent {
  id: string;
  recipientUserId: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  title: string;
  body: string;
  resourceType?: string | null;
  resourceId?: string | null;
  actionUrl?: string | null;
  status: NotificationStatus;
  sentAt?: Date | null;
  readAt?: Date | null;
  idempotencyKey?: string | null;
  createdAt: Date;
}

export interface NotificationPreference {
  id: string;
  userId: string;
  eventType: NotificationEventType;
  channel: NotificationChannel;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeekerFeedback {
  id: string;
  serviceId: string;
  sessionId: string;
  /** Rating from 1 to 5 */
  rating: number;
  comment?: string | null;
  contactSuccess?: boolean | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatSession {
  id: string;
  userId?: string | null;
  startedAt: Date;
  endedAt?: Date | null;
  intentSummary?: string | null;
  serviceIdsShown?: string[] | null;
  /** Number of messages in this session (migration 0017) */
  messageCount: number;
}

export interface FeatureFlag {
  id: string;
  name: string;
  enabled: boolean;
  rolloutPct: number;
  /** Human-readable description (migration 0007) */
  description?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// HSDS COMPLETENESS ENTITIES (migrations 0009–0011)
// ============================================================

export interface Program {
  id: string;
  organizationId: string;
  name: string;
  alternateName?: string | null;
  description?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Eligibility {
  id: string;
  serviceId: string;
  /** Human-readable criterion: "Must be 18 or older" */
  description: string;
  /** Structured minimum age (NULL = no minimum) */
  minimumAge?: number | null;
  /** Structured maximum age (NULL = no maximum) */
  maximumAge?: number | null;
  /** Structured tags: e.g. ['veteran', 'senior', 'family'] */
  eligibleValues?: string[] | null;
  /** Minimum household size (NULL = no minimum) */
  householdSizeMin?: number | null;
  /** Maximum household size (NULL = no maximum) */
  householdSizeMax?: number | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RequiredDocument {
  id: string;
  serviceId: string;
  /** Document name: "Photo ID", "Proof of income" */
  document: string;
  /** Category: 'identification', 'income', 'residency', 'medical', 'other' */
  type?: string | null;
  /** Link to downloadable form or instructions */
  uri?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type ServiceAreaExtentType = 'city' | 'county' | 'state' | 'zip' | 'nationwide' | 'custom' | 'other';

export interface ServiceArea {
  id: string;
  serviceId: string;
  name?: string | null;
  description?: string | null;
  extentType?: ServiceAreaExtentType | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Language {
  id: string;
  serviceId?: string | null;
  locationId?: string | null;
  /** ISO 639-1 code: 'en', 'es', 'zh', etc. */
  language: string;
  note?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccessibilityForDisabilities {
  id: string;
  locationId: string;
  /** Feature tag: 'wheelchair', 'hearing_loop', 'braille', 'elevator', etc. */
  accessibility: string;
  details?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Contact {
  id: string;
  organizationId?: string | null;
  serviceId?: string | null;
  locationId?: string | null;
  name?: string | null;
  title?: string | null;
  department?: string | null;
  email?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedService {
  id: string;
  userId: string;
  serviceId: string;
  notes?: string | null;
  savedAt: Date;
}

export type VerificationEvidenceType =
  | 'website_screenshot'
  | 'phone_confirmation'
  | 'in_person_visit'
  | 'official_document'
  | 'photo'
  | 'correspondence'
  | 'other';

export interface VerificationEvidence {
  id: string;
  queueEntryId: string;
  evidenceType: VerificationEvidenceType;
  description?: string | null;
  fileUrl?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  submittedByUserId: string;
  createdAt: Date;
}

export interface CoverageZone {
  id: string;
  name: string;
  description?: string | null;
  assignedUserId?: string | null;
  status: 'active' | 'inactive';
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: 'host_member' | 'host_admin';
  status: 'invited' | 'active' | 'deactivated';
  invitedByUserId?: string | null;
  invitedAt: Date;
  activatedAt?: Date | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserProfile {
  id: string;
  userId: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  authProvider?: string | null;
  preferredLocale?: string | null;
  approximateCity?: string | null;
  role: OranRole;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SeekerProfile {
  id: string;
  userId: string;
  serviceInterests: string[];
  ageGroup?: string | null;
  householdType?: string | null;
  housingSituation?: string | null;
  selfIdentifiers: string[];
  currentServices: string[];
  accessibilityNeeds: string[];
  transportationBarrier?: boolean | null;
  preferredDeliveryModes?: string[];
  urgencyWindow?: string | null;
  documentationBarriers?: string[];
  digitalAccessBarrier?: boolean | null;
  pronouns?: string | null;
  profileHeadline?: string | null;
  avatarEmoji?: string | null;
  accentTheme?: 'ocean' | 'blossom' | 'forest' | 'sunset' | 'midnight' | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  additionalContext?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// SERVICE ATTRIBUTES (migration 0012)
// ============================================================

/** Canonical taxonomy namespaces for service_attributes */
export type ServiceAttributeTaxonomy =
  | 'delivery'
  | 'cost'
  | 'access'
  | 'culture'
  | 'population'
  | 'situation';

/**
 * Universal service attribute tag.
 * Each row is one (taxonomy, tag) pair on a service.
 * Examples:
 *   { taxonomy: 'delivery', tag: 'virtual' }
 *   { taxonomy: 'cost', tag: 'free' }
 *   { taxonomy: 'access', tag: 'no_id_required' }
 *   { taxonomy: 'population', tag: 'refugee' }
 */
export interface ServiceAttribute {
  id: string;
  serviceId: string;
  /** Namespace: 'delivery', 'cost', 'access', 'culture', 'population', 'situation' */
  taxonomy: ServiceAttributeTaxonomy;
  /** Value within the taxonomy namespace */
  tag: string;
  /** Optional human-readable elaboration */
  details?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// SERVICE ADAPTATIONS & DIETARY OPTIONS (migration 0013)
// ============================================================

/** Canonical adaptation type namespaces for service_adaptations */
export type ServiceAdaptationType =
  | 'disability'
  | 'health_condition'
  | 'age_group'
  | 'learning';

/**
 * Service-level disability/health adaptations.
 * Distinct from location accessibility (physical access to building).
 * Examples:
 *   { adaptationType: 'disability', adaptationTag: 'autism' }
 *   { adaptationType: 'health_condition', adaptationTag: 'hiv_aids' }
 *   { adaptationType: 'age_group', adaptationTag: 'infant' }
 */
export interface ServiceAdaptation {
  id: string;
  serviceId: string;
  /** Namespace: 'disability', 'health_condition', 'age_group', 'learning' */
  adaptationType: ServiceAdaptationType;
  /** Tag within namespace */
  adaptationTag: string;
  /** Human-readable description of the adaptation */
  details?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Dietary availability status */
export type DietaryAvailability = 'always' | 'by_request' | 'limited' | 'seasonal';

/**
 * Dietary options for food assistance services.
 * Examples:
 *   { dietaryType: 'halal', availability: 'always' }
 *   { dietaryType: 'vegan', availability: 'by_request' }
 */
export interface DietaryOption {
  id: string;
  serviceId: string;
  /** Dietary type: 'halal', 'kosher', 'vegan', 'gluten_free', etc. */
  dietaryType: string;
  /** Availability: 'always', 'by_request', 'limited', 'seasonal' */
  availability?: DietaryAvailability | null;
  /** Additional details */
  details?: string | null;
  createdByUserId?: string | null;
  updatedByUserId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// COMPOSITE / VIEW TYPES
// ============================================================

/** A service enriched with its organization, location, phones, address, and confidence score */
export interface EnrichedService {
  service: Service;
  organization: Organization;
  location?: Location | null;
  address?: Address | null;
  phones: Phone[];
  schedules: Schedule[];
  taxonomyTerms: TaxonomyTerm[];
  confidenceScore?: ConfidenceScore | null;
  distanceMeters?: number | null;
  eligibility?: Eligibility[] | null;
  requiredDocuments?: RequiredDocument[] | null;
  languages?: Language[] | null;
  serviceAreas?: ServiceArea[] | null;
  contacts?: Contact[] | null;
  accessibility?: AccessibilityForDisabilities[] | null;
  program?: Program | null;
  /** Structured attributes: delivery mode, cost, access requirements, cultural competency, population, situation */
  attributes?: ServiceAttribute[] | null;
  /** Service-level disability/health adaptations (distinct from location accessibility) */
  adaptations?: ServiceAdaptation[] | null;
  /** Dietary options for food services (halal, kosher, vegan, etc.) */
  dietaryOptions?: DietaryOption[] | null;
}

export type OranRole =
  | 'seeker'
  | 'host_member'
  | 'host_admin'
  | 'community_admin'
  | 'oran_admin';
