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
  createdAt: Date;
  updatedAt: Date;
}

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
  updatedAt: Date;
  createdAt: Date;
}

export type ServiceStatus = 'active' | 'inactive' | 'defunct';

export interface ServiceAtLocation {
  id: string;
  serviceId: string;
  locationId: string;
  description?: string | null;
  createdAt: Date;
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
}

export type Weekday = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

export interface TaxonomyTerm {
  id: string;
  term: string;
  description?: string | null;
  parentId?: string | null;
  taxonomy?: string | null;
  createdAt: Date;
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
}

export type ConfidenceBand = 'HIGH' | 'LIKELY' | 'POSSIBLE';

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
  submittedBy: string;
  assignedTo?: string | null;
  notes?: string | null;
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
  createdAt: Date;
}

export interface ChatSession {
  id: string;
  userId?: string | null;
  startedAt: Date;
  endedAt?: Date | null;
  intentSummary?: string | null;
  serviceIdsShown?: string[] | null;
}

export interface FeatureFlag {
  id: string;
  name: string;
  enabled: boolean;
  rolloutPct: number;
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
}

export type OranRole =
  | 'seeker'
  | 'host_member'
  | 'host_admin'
  | 'community_admin'
  | 'oran_admin';
