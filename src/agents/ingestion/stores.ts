/**
 * Ingestion Store interfaces.
 *
 * These define how the ingestion agent reads/writes to the database.
 * Implementations can be real (PostgreSQL) or stubs (in-memory for testing).
 *
 * Architecture: Ingestion agent writes here → Chat reads from DB separately.
 */
import type { AuditEvent, EvidenceSnapshot, ExtractedCandidate, VerificationCheckResult } from './contracts';
import type { IngestionJob, IngestionJobStatus } from './jobs';
import type { ResourceTag, ResourceTagType } from './tags';
import type { SourceRegistryEntry } from './sourceRegistry';
import type { AdminProfile, AdminWithCapacity, ClosestAdmin } from './adminProfiles';
import type { AdminAssignment, AssignmentStatus, AdminDecision } from './adminAssignments';
import type { TagConfirmation, TagConfirmationStatus } from './tagConfirmations';
import type { LlmSuggestion, SuggestionField, SuggestionStatus } from './llmSuggestions';

// ============================================================
// SOURCE REGISTRY STORE
// ============================================================

export interface SourceRegistryStore {
  /** Get all active registry entries. */
  listActive(): Promise<SourceRegistryEntry[]>;

  /** Find entry by ID. */
  getById(id: string): Promise<SourceRegistryEntry | null>;

  /** Find entry that matches a URL. */
  findForUrl(url: string): Promise<SourceRegistryEntry | null>;

  /** Create or update an entry. */
  upsert(entry: SourceRegistryEntry): Promise<void>;

  /** Deactivate an entry (soft delete). */
  deactivate(id: string): Promise<void>;
}

// ============================================================
// JOB STORE
// ============================================================

export interface JobStore {
  /** Create a new job. */
  create(job: IngestionJob): Promise<void>;

  /** Get job by ID. */
  getById(id: string): Promise<IngestionJob | null>;

  /** Get job by correlation ID. */
  getByCorrelationId(correlationId: string): Promise<IngestionJob | null>;

  /** Update job status and stats. */
  update(job: IngestionJob): Promise<void>;

  /** List jobs by status. */
  listByStatus(status: IngestionJobStatus, limit?: number): Promise<IngestionJob[]>;

  /** Get next queued job (FIFO). */
  dequeueNext(): Promise<IngestionJob | null>;

  /** Increment job stats. */
  incrementStats(
    jobId: string,
    stats: Partial<{
      urlsDiscovered: number;
      urlsFetched: number;
      candidatesExtracted: number;
      candidatesVerified: number;
      errorsCount: number;
    }>
  ): Promise<void>;
}

// ============================================================
// EVIDENCE STORE
// ============================================================

export interface EvidenceStore {
  /** Store a new evidence snapshot. */
  create(snapshot: EvidenceSnapshot & { jobId?: string; correlationId: string }): Promise<void>;

  /** Get by ID. */
  getById(evidenceId: string): Promise<EvidenceSnapshot | null>;

  /** Get by content hash (for deduplication). */
  getByContentHash(hash: string): Promise<EvidenceSnapshot | null>;

  /** Get by canonical URL (most recent). */
  getByCanonicalUrl(url: string): Promise<EvidenceSnapshot | null>;

  /** Check if content changed from last snapshot for URL. */
  hasContentChanged(url: string, newHash: string): Promise<boolean>;
}

// ============================================================
// CANDIDATE STORE
// ============================================================

export type CandidateReviewStatus =
  | 'pending'
  | 'in_review'
  | 'verified'
  | 'rejected'
  | 'escalated'
  | 'published'
  | 'archived';

export interface CandidateFilters {
  reviewStatus?: CandidateReviewStatus;
  confidenceTier?: 'green' | 'yellow' | 'orange' | 'red';
  jurisdictionState?: string;
  jurisdictionCounty?: string;
  assignedToUserId?: string;
  assignedToRole?: 'community_admin' | 'oran_admin';
  reviewByBefore?: Date;
  reverifyAtBefore?: Date;
}

export interface CandidateStore {
  /** Create a new candidate. */
  create(candidate: ExtractedCandidate & {
    jobId?: string;
    correlationId: string;
    primaryEvidenceId?: string;
    jurisdictionState?: string;
    jurisdictionCounty?: string;
    jurisdictionCity?: string;
    jurisdictionKind?: string;
  }): Promise<void>;

  /** Get by ID. */
  getById(candidateId: string): Promise<ExtractedCandidate | null>;

  /** Get by extract key (deduplication). */
  getByExtractKey(extractKey: string): Promise<ExtractedCandidate | null>;

  /** Update a candidate. */
  update(candidateId: string, updates: Partial<ExtractedCandidate>): Promise<void>;

  /** Update review status. */
  updateReviewStatus(
    candidateId: string,
    status: CandidateReviewStatus,
    byUserId?: string
  ): Promise<void>;

  /** Update confidence score (triggers tier recalc). */
  updateConfidenceScore(candidateId: string, score: number): Promise<void>;

  /** Assign to a user for review. */
  assign(
    candidateId: string,
    role: 'community_admin' | 'oran_admin',
    userId?: string
  ): Promise<void>;

  /** List candidates with filters. */
  list(filters: CandidateFilters, limit?: number, offset?: number): Promise<ExtractedCandidate[]>;

  /** Get candidates due for review (SLA). */
  listDueForReview(limit?: number): Promise<ExtractedCandidate[]>;

  /** Get candidates due for reverification. */
  listDueForReverify(limit?: number): Promise<ExtractedCandidate[]>;

  /** Mark as published and link to service. */
  markPublished(candidateId: string, serviceId: string, byUserId: string): Promise<void>;
}

// ============================================================
// TAG STORE
// ============================================================

export interface TagStore {
  /** Add a tag to a candidate or service. */
  add(tag: ResourceTag): Promise<void>;

  /** Remove a tag. */
  remove(
    targetId: string,
    targetType: 'candidate' | 'service',
    tagType: ResourceTagType,
    tagValue: string
  ): Promise<void>;

  /** Get all tags for a candidate or service. */
  listFor(
    targetId: string,
    targetType: 'candidate' | 'service'
  ): Promise<ResourceTag[]>;

  /** Get all tags of a specific type for a target. */
  listByType(
    targetId: string,
    targetType: 'candidate' | 'service',
    tagType: ResourceTagType
  ): Promise<ResourceTag[]>;

  /** Find candidates/services by tag. */
  findByTag(
    tagType: ResourceTagType,
    tagValue: string,
    targetType: 'candidate' | 'service'
  ): Promise<string[]>;

  /** Bulk add tags (for efficiency). */
  bulkAdd(tags: ResourceTag[]): Promise<void>;

  /** Replace all tags of a type for a target. */
  replaceByType(
    targetId: string,
    targetType: 'candidate' | 'service',
    tagType: ResourceTagType,
    newTags: ResourceTag[]
  ): Promise<void>;
}

// ============================================================
// VERIFICATION CHECK STORE
// ============================================================

export interface VerificationCheckStore {
  /** Record a check result. */
  record(check: VerificationCheckResult & { candidateId: string }): Promise<void>;

  /** Get all checks for a candidate. */
  listFor(candidateId: string): Promise<VerificationCheckResult[]>;

  /** Get failing critical checks for a candidate. */
  getFailingCritical(candidateId: string): Promise<VerificationCheckResult[]>;

  /** Delete all checks for a candidate (for re-run). */
  deleteFor(candidateId: string): Promise<void>;
}

// ============================================================
// VERIFIED SERVICE LINKS STORE
// ============================================================

export type VerifiedLinkType =
  | 'home'
  | 'contact'
  | 'apply'
  | 'eligibility'
  | 'intake_form'
  | 'hours'
  | 'pdf'
  | 'privacy'
  | 'service_page'
  | 'organization_home'
  | 'other';

export interface VerifiedServiceLink {
  id?: string;
  candidateId?: string;
  serviceId?: string;
  url: string;
  label: string;
  linkType: VerifiedLinkType;
  intentActions?: string[];
  intentCategories?: string[];
  audienceTags?: string[];
  locales?: string[];
  isVerified: boolean;
  verifiedAt?: string;
  verifiedByUserId?: string;
  lastCheckedAt?: string;
  lastHttpStatus?: number;
  isLinkAlive?: boolean;
  evidenceId?: string;
  discoveredAt: string;
}

export interface VerifiedLinkStore {
  /** Add a discovered link. */
  add(link: VerifiedServiceLink): Promise<void>;

  /** Update link verification status. */
  verify(linkId: string, byUserId: string): Promise<void>;

  /** Update link health check. */
  updateHealth(linkId: string, httpStatus: number, isAlive: boolean): Promise<void>;

  /** Get all links for a candidate. */
  listForCandidate(candidateId: string): Promise<VerifiedServiceLink[]>;

  /** Get all verified links for a service (for chat). */
  listForService(serviceId: string, onlyVerified?: boolean): Promise<VerifiedServiceLink[]>;

  /** Get links by type for a service. */
  listByType(serviceId: string, linkType: VerifiedLinkType): Promise<VerifiedServiceLink[]>;

  /** Transfer links from candidate to service on publish. */
  transferToService(candidateId: string, serviceId: string): Promise<void>;

  /** Bulk add links. */
  bulkAdd(links: VerifiedServiceLink[]): Promise<void>;
}

// ============================================================
// AUDIT STORE
// ============================================================

export interface AuditStore {
  /** Append an audit event. */
  append(event: AuditEvent): Promise<void>;

  /** Get all events for a correlation ID (job). */
  listByCorrelation(correlationId: string): Promise<AuditEvent[]>;

  /** Get events for a target. */
  listByTarget(targetType: string, targetId: string): Promise<AuditEvent[]>;

  /** Get events by type. */
  listByType(eventType: string, limit?: number): Promise<AuditEvent[]>;
}

// ============================================================
// FEED SUBSCRIPTION STORE
// ============================================================

export interface FeedSubscription {
  id?: string;
  sourceRegistryId?: string;
  feedUrl: string;
  feedType: 'rss' | 'atom' | 'sitemap' | 'api' | 'other';
  displayName?: string;
  pollIntervalHours: number;
  lastPolledAt?: string;
  lastEtag?: string;
  lastModified?: string;
  isActive: boolean;
  errorCount: number;
  lastError?: string;
  jurisdictionState?: string;
  jurisdictionCounty?: string;
}

export interface FeedStore {
  /** Add a new feed subscription. */
  add(feed: FeedSubscription): Promise<void>;

  /** Update feed after poll. */
  updateAfterPoll(
    feedId: string,
    result: {
      lastPolledAt: string;
      lastEtag?: string;
      lastModified?: string;
      error?: string;
    }
  ): Promise<void>;

  /** Get feeds due for polling. */
  listDueForPoll(): Promise<FeedSubscription[]>;

  /** List all active feeds. */
  listActive(): Promise<FeedSubscription[]>;

  /** Deactivate a feed. */
  deactivate(feedId: string): Promise<void>;
}

// ============================================================
// ADMIN ROUTING STORE
// ============================================================

export interface AdminRoutingRule {
  id?: string;
  jurisdictionCountry: string;
  jurisdictionState?: string;
  jurisdictionCounty?: string;
  assignedRole: 'community_admin' | 'oran_admin';
  assignedUserId?: string;
  priority: number;
  isActive: boolean;
}

export interface AdminRoutingStore {
  /** Find the best matching routing rule for a jurisdiction. */
  findBestMatch(
    country: string,
    state?: string,
    county?: string
  ): Promise<AdminRoutingRule | null>;

  /** List all active routing rules. */
  listActive(): Promise<AdminRoutingRule[]>;

  /** Add or update a routing rule. */
  upsert(rule: AdminRoutingRule): Promise<void>;
}

// ============================================================
// ADMIN PROFILE STORE
// ============================================================

export interface AdminProfileStore {
  /** Create a new admin profile. */
  create(profile: AdminProfile): Promise<void>;

  /** Get profile by user ID. */
  getByUserId(userId: string): Promise<AdminProfile | null>;

  /** Get profile by ID. */
  getById(profileId: string): Promise<AdminProfile | null>;

  /** Update a profile. */
  update(profileId: string, updates: Partial<AdminProfile>): Promise<void>;

  /** Get admin with their current capacity info. */
  getWithCapacity(profileId: string): Promise<AdminWithCapacity | null>;

  /** List all admins with capacity info. */
  listWithCapacity(filters?: {
    isActive?: boolean;
    isAcceptingReviews?: boolean;
    profileType?: 'admin' | 'org';
  }): Promise<AdminWithCapacity[]>;

  /** Find closest admins with available capacity. */
  findClosestWithCapacity(
    location: { longitude: number; latitude: number },
    filters?: {
      jurisdictionState?: string;
      jurisdictionCounty?: string;
      category?: string;
    },
    limit?: number
  ): Promise<ClosestAdmin[]>;

  /** Increment review count for an admin. */
  incrementReviewCount(profileId: string): Promise<void>;

  /** Update average review time. */
  updateAvgReviewTime(profileId: string, durationSecs: number): Promise<void>;
}

// ============================================================
// ADMIN ASSIGNMENT STORE
// ============================================================

export interface AdminAssignmentFilters {
  candidateId?: string;
  adminProfileId?: string;
  assignmentStatus?: AssignmentStatus;
  decision?: AdminDecision;
  isOverdue?: boolean;
}

export interface AdminAssignmentStore {
  /** Create an assignment. */
  create(assignment: AdminAssignment): Promise<void>;

  /** Create multiple assignments (for routing). */
  bulkCreate(assignments: AdminAssignment[]): Promise<void>;

  /** Get assignment by ID. */
  getById(assignmentId: string): Promise<AdminAssignment | null>;

  /** Get assignment for a specific candidate-admin pair. */
  getForCandidateAdmin(
    candidateId: string,
    adminProfileId: string
  ): Promise<AdminAssignment | null>;

  /** Update assignment status. */
  updateStatus(
    assignmentId: string,
    status: AssignmentStatus,
    decision?: AdminDecision,
    notes?: string
  ): Promise<void>;

  /** List assignments with filters. */
  list(
    filters: AdminAssignmentFilters,
    limit?: number,
    offset?: number
  ): Promise<AdminAssignment[]>;

  /** Get all assignments for a candidate. */
  listForCandidate(candidateId: string): Promise<AdminAssignment[]>;

  /** Get all assignments for an admin (pending/accepted). */
  listForAdmin(
    adminProfileId: string,
    statusFilter?: AssignmentStatus[]
  ): Promise<AdminAssignment[]>;

  /** Get overdue assignments. */
  listOverdue(limit?: number): Promise<AdminAssignment[]>;

  /** Withdraw all non-terminal assignments for a candidate. */
  withdrawAllForCandidate(candidateId: string): Promise<number>;

  /** Count pending assignments for an admin. */
  countPending(adminProfileId: string): Promise<number>;
}

// ============================================================
// TAG CONFIRMATION STORE
// ============================================================

export interface TagConfirmationFilters {
  candidateId?: string;
  tagType?: ResourceTagType;
  confirmationStatus?: TagConfirmationStatus;
  confidenceTier?: 'green' | 'yellow' | 'orange' | 'red';
  reviewedByUserId?: string;
}

export interface TagConfirmationStore {
  /** Create a tag confirmation entry. */
  create(confirmation: TagConfirmation): Promise<void>;

  /** Create multiple confirmations (batch from extraction). */
  bulkCreate(confirmations: TagConfirmation[]): Promise<void>;

  /** Get by ID. */
  getById(confirmationId: string): Promise<TagConfirmation | null>;

  /** Update confirmation decision. */
  updateDecision(
    confirmationId: string,
    status: TagConfirmationStatus,
    confirmedValue?: string,
    confirmedConfidence?: number,
    userId?: string,
    notes?: string
  ): Promise<void>;

  /** List confirmations with filters. */
  list(
    filters: TagConfirmationFilters,
    limit?: number,
    offset?: number
  ): Promise<TagConfirmation[]>;

  /** Get all confirmations for a candidate. */
  listForCandidate(candidateId: string): Promise<TagConfirmation[]>;

  /** Get only pending confirmations for a candidate. */
  listPendingForCandidate(candidateId: string): Promise<TagConfirmation[]>;

  /** Count pending confirmations by tier for a candidate. */
  countPendingByTier(candidateId: string): Promise<Record<string, number>>;

  /** Get confirmed tags for a candidate (for publish). */
  listConfirmed(candidateId: string): Promise<TagConfirmation[]>;
}

// ============================================================
// LLM SUGGESTION STORE
// ============================================================

export interface LlmSuggestionFilters {
  candidateId?: string;
  fieldName?: SuggestionField;
  suggestionStatus?: SuggestionStatus;
  minConfidence?: number;
  reviewedByUserId?: string;
}

export interface LlmSuggestionStore {
  /** Create an LLM suggestion. */
  create(suggestion: LlmSuggestion): Promise<void>;

  /** Create multiple suggestions (batch from extraction). */
  bulkCreate(suggestions: LlmSuggestion[]): Promise<void>;

  /** Get by ID. */
  getById(suggestionId: string): Promise<LlmSuggestion | null>;

  /** Update suggestion decision. */
  updateDecision(
    suggestionId: string,
    status: SuggestionStatus,
    acceptedValue?: string,
    userId?: string,
    notes?: string
  ): Promise<void>;

  /** List suggestions with filters. */
  list(
    filters: LlmSuggestionFilters,
    limit?: number,
    offset?: number
  ): Promise<LlmSuggestion[]>;

  /** Get all suggestions for a candidate. */
  listForCandidate(candidateId: string): Promise<LlmSuggestion[]>;

  /** Get only pending suggestions for a candidate. */
  listPendingForCandidate(candidateId: string): Promise<LlmSuggestion[]>;

  /** Get accepted values for a candidate (to apply). */
  getAcceptedValues(candidateId: string): Promise<Map<SuggestionField, string>>;
}

// ============================================================
// PUBLISH THRESHOLD STORE
// ============================================================

export interface PublishThreshold {
  id?: string;
  category?: string;
  jurisdictionState?: string;
  minConfidenceScore: number;
  minConfirmedTags: number;
  maxPendingTags: number;
  requiredChecklistItems: string[];
  minAdminApprovals: number;
  requireOrgApproval: boolean;
  autoPublishThreshold?: number;
  priority: number;
  isActive: boolean;
}

export interface PublishThresholdStore {
  /** Get the best matching threshold for a category/jurisdiction. */
  findBestMatch(
    category?: string,
    jurisdictionState?: string
  ): Promise<PublishThreshold | null>;

  /** List all active thresholds. */
  listActive(): Promise<PublishThreshold[]>;

  /** Create or update a threshold. */
  upsert(threshold: PublishThreshold): Promise<void>;
}

// ============================================================
// PUBLISH READINESS (aggregated view)
// ============================================================

export interface CandidatePublishReadiness {
  candidateId: string;
  reviewStatus: string;
  confidenceScore: number;
  confidenceTier: string;
  confirmedTagsCount: number;
  pendingTagsCount: number;
  approvalCount: number;
  rejectionCount: number;
  hasOrgApproval: boolean;
  satisfiedChecklistCount: number;
  missingChecklistCount: number;
  pendingLlmSuggestions: number;
  meetsPublishThreshold: boolean;
}

export interface PublishReadinessStore {
  /** Get readiness info for a candidate. */
  getReadiness(candidateId: string): Promise<CandidatePublishReadiness | null>;

  /** Check if candidate meets publish threshold. */
  meetsThreshold(candidateId: string): Promise<boolean>;

  /** Get all candidates ready for publish. */
  listReadyForPublish(limit?: number): Promise<CandidatePublishReadiness[]>;
}

// ============================================================
// COMPOSITE STORE (aggregates all stores)
// ============================================================

export interface IngestionStores {
  sourceRegistry: SourceRegistryStore;
  jobs: JobStore;
  evidence: EvidenceStore;
  candidates: CandidateStore;
  tags: TagStore;
  checks: VerificationCheckStore;
  links: VerifiedLinkStore;
  audit: AuditStore;
  feeds: FeedStore;
  routing: AdminRoutingStore;

  // Admin approval workflow stores
  adminProfiles: AdminProfileStore;
  assignments: AdminAssignmentStore;
  tagConfirmations: TagConfirmationStore;
  llmSuggestions: LlmSuggestionStore;
  publishThresholds: PublishThresholdStore;
  publishReadiness: PublishReadinessStore;
}

