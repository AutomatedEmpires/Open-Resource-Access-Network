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
import type {
  SourceSystemRow,
  NewSourceSystemRow,
  SourceFeedRow,
  NewSourceFeedRow,
  SourceFeedStateRow,
  NewSourceFeedStateRow,
  SourceRecordRow,
  NewSourceRecordRow,
  NewSourceRecordTaxonomyRow,
  EntityIdentifierRow,
  NewEntityIdentifierRow,
  HsdsExportSnapshotRow,
  NewHsdsExportSnapshotRow,
  LifecycleEventRow,
  NewLifecycleEventRow,
  CanonicalOrganizationRow,
  NewCanonicalOrganizationRow,
  CanonicalServiceRow,
  NewCanonicalServiceRow,
  CanonicalLocationRow,
  NewCanonicalLocationRow,
  CanonicalServiceLocationRow,
  NewCanonicalServiceLocationRow,
  CanonicalProvenanceRow,
  NewCanonicalProvenanceRow,
  TaxonomyRegistryRow,
  NewTaxonomyRegistryRow,
  TaxonomyTermExtRow,
  NewTaxonomyTermExtRow,
  CanonicalConceptRow,
  NewCanonicalConceptRow,
  TaxonomyCrosswalkRow,
  NewTaxonomyCrosswalkRow,
  ConceptTagDerivationRow,
  NewConceptTagDerivationRow,
  EntityClusterRow,
  NewEntityClusterRow,
  EntityClusterMemberRow,
  NewEntityClusterMemberRow,
  ResolutionCandidateRow,
  NewResolutionCandidateRow,
  ResolutionDecisionRow,
  NewResolutionDecisionRow,
} from '@/db/schema';

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
  create(snapshot: EvidenceSnapshot & {
    jobId?: string;
    correlationId: string;
    htmlRaw?: string;
    textExtracted?: string;
    title?: string;
    metaDescription?: string;
    language?: string;
    contentLength?: number;
  }): Promise<void>;

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

  /** Find by normalized org+service name (cross-path dedup). */
  findByNormalizedName(orgName: string, serviceName: string): Promise<ExtractedCandidate | null>;

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

export interface CandidatePublishReadinessSnapshot {
  candidateId: string;
  isReady: boolean;
  hasRequiredFields: boolean;
  hasRequiredTags: boolean;
  tagsConfirmed: boolean;
  meetsScoreThreshold: boolean;
  hasAdminApproval: boolean;
  pendingTagCount: number;
  adminApprovalCount: number;
  blockers: string[];
}

export interface PublishReadinessStore {
  /** Upsert the latest readiness snapshot for a candidate. */
  upsert(snapshot: CandidatePublishReadinessSnapshot): Promise<void>;

  /** Get readiness info for a candidate. */
  getReadiness(candidateId: string): Promise<CandidatePublishReadiness | null>;

  /** Check if candidate meets publish threshold. */
  meetsThreshold(candidateId: string): Promise<boolean>;

  /** Get all candidates ready for publish. */
  listReadyForPublish(limit?: number): Promise<CandidatePublishReadiness[]>;
}

// ============================================================
// SOURCE SYSTEM STORE (0032 – unified source assertion layer)
// ============================================================

export interface SourceSystemStore {
  /** Get a source system by ID. */
  getById(id: string): Promise<SourceSystemRow | null>;

  /** List active source systems, optionally filtered by family or trust tier. */
  listActive(filters?: {
    family?: string;
    trustTier?: string;
  }): Promise<SourceSystemRow[]>;

  /** Create a source system. */
  create(row: NewSourceSystemRow): Promise<SourceSystemRow>;

  /** Update a source system. */
  update(id: string, updates: Partial<NewSourceSystemRow>): Promise<void>;

  /** Deactivate (soft delete). */
  deactivate(id: string): Promise<void>;
}

// ============================================================
// SOURCE FEED STORE
// ============================================================

export interface SourceFeedStore {
  /** Get a feed by ID. */
  getById(id: string): Promise<SourceFeedRow | null>;

  /** List feeds for a source system. */
  listBySystem(sourceSystemId: string): Promise<SourceFeedRow[]>;

  /** List feeds due for polling. */
  listDueForPoll(): Promise<SourceFeedRow[]>;

  /** Create a feed. */
  create(row: NewSourceFeedRow): Promise<SourceFeedRow>;

  /** Update a feed. */
  update(id: string, updates: Partial<NewSourceFeedRow>): Promise<void>;

  /** Update after poll attempt. */
  updateAfterPoll(
    feedId: string,
    result: {
      lastPolledAt: string;
      lastSuccessAt?: string;
      lastError?: string;
      errorCount?: number;
    }
  ): Promise<void>;

  /** Deactivate a feed. */
  deactivate(id: string): Promise<void>;
}

// ============================================================
// SOURCE FEED STATE STORE
// ============================================================

export interface SourceFeedStateStore {
  /** Get operational state for a source feed. */
  getByFeedId(sourceFeedId: string): Promise<SourceFeedStateRow | null>;

  /** Create or replace operational state for a source feed. */
  upsert(row: NewSourceFeedStateRow): Promise<SourceFeedStateRow>;

  /** Partially update operational state for a source feed. */
  update(sourceFeedId: string, updates: Partial<NewSourceFeedStateRow>): Promise<void>;
}

// ============================================================
// SOURCE RECORD STORE
// ============================================================

export interface SourceRecordStore {
  /** Get a record by ID. */
  getById(id: string): Promise<SourceRecordRow | null>;

  /** Find existing record by dedup key (feed + type + sourceRecordId + hash). */
  findByDedup(
    sourceFeedId: string,
    sourceRecordType: string,
    sourceRecordId: string,
    payloadSha256: string
  ): Promise<SourceRecordRow | null>;

  /** Create a source record. */
  create(row: NewSourceRecordRow): Promise<SourceRecordRow>;

  /** Batch insert source records. */
  bulkCreate(rows: NewSourceRecordRow[]): Promise<void>;

  /** Update processing status. */
  updateStatus(
    id: string,
    status: string,
    error?: string
  ): Promise<void>;

  /** List records pending processing. */
  listPending(limit?: number): Promise<SourceRecordRow[]>;

  /** List pending records for a specific feed. */
  listPendingByFeed(sourceFeedId: string, limit?: number): Promise<SourceRecordRow[]>;

  /** List records by feed (for batch processing). */
  listByFeed(sourceFeedId: string, limit?: number): Promise<SourceRecordRow[]>;

  /** Attach taxonomy terms to a source record. */
  addTaxonomy(rows: NewSourceRecordTaxonomyRow[]): Promise<void>;
}

// ============================================================
// ENTITY IDENTIFIER STORE
// ============================================================

export interface EntityIdentifierStore {
  /** Get all identifiers for an entity. */
  listByEntity(entityType: string, entityId: string): Promise<EntityIdentifierRow[]>;

  /** Find entity by external identifier. */
  findByScheme(
    identifierScheme: string,
    identifierValue: string
  ): Promise<EntityIdentifierRow | null>;

  /** Create an identifier link. */
  create(row: NewEntityIdentifierRow): Promise<EntityIdentifierRow>;

  /** Bulk-update status for all identifiers of an entity. */
  updateStatusForEntity(
    entityType: string,
    entityId: string,
    status: string
  ): Promise<number>;

  /** Delete identifiers for a specific entity (cleanup orphans). */
  deleteByEntity(entityType: string, entityId: string): Promise<number>;
}

// ============================================================
// HSDS EXPORT SNAPSHOT STORE
// ============================================================

export interface HsdsExportSnapshotStore {
  /** Get current snapshot for an entity. */
  getCurrent(
    entityType: string,
    entityId: string
  ): Promise<HsdsExportSnapshotRow | null>;

  /** Create a new snapshot version. */
  create(row: NewHsdsExportSnapshotRow): Promise<HsdsExportSnapshotRow>;

  /** Withdraw (invalidate) all snapshots for an entity. */
  withdrawForEntity(entityType: string, entityId: string): Promise<number>;

  /** List current snapshots for export. */
  listCurrent(limit?: number, offset?: number): Promise<HsdsExportSnapshotRow[]>;
}

// ============================================================
// LIFECYCLE EVENT STORE
// ============================================================

export interface LifecycleEventStore {
  /** Record a lifecycle event. */
  create(row: NewLifecycleEventRow): Promise<LifecycleEventRow>;

  /** Get events for an entity. */
  listByEntity(
    entityType: string,
    entityId: string
  ): Promise<LifecycleEventRow[]>;

  /** Get recent events by type. */
  listByType(eventType: string, limit?: number): Promise<LifecycleEventRow[]>;
}

// ============================================================
// CANONICAL ORGANIZATION STORE (0033 – canonical federation)
// ============================================================

export interface CanonicalOrganizationStore {
  /** Get a canonical organization by ID. */
  getById(id: string): Promise<CanonicalOrganizationRow | null>;

  /** List canonical organizations by lifecycle status. */
  listByLifecycle(lifecycleStatus: string, limit?: number): Promise<CanonicalOrganizationRow[]>;

  /** List canonical organizations by publication status. */
  listByPublication(publicationStatus: string, limit?: number, offset?: number): Promise<CanonicalOrganizationRow[]>;

  /** List canonical organizations by winning source system. */
  listByWinningSource(sourceSystemId: string, limit?: number): Promise<CanonicalOrganizationRow[]>;

  /** Create a canonical organization. */
  create(row: NewCanonicalOrganizationRow): Promise<CanonicalOrganizationRow>;

  /** Update a canonical organization. */
  update(id: string, updates: Partial<NewCanonicalOrganizationRow>): Promise<void>;

  /** Transition lifecycle status. */
  updateLifecycleStatus(id: string, status: string): Promise<void>;

  /** Transition publication status. */
  updatePublicationStatus(id: string, status: string): Promise<void>;
}

// ============================================================
// CANONICAL SERVICE STORE
// ============================================================

export interface CanonicalServiceStore {
  /** Get a canonical service by ID. */
  getById(id: string): Promise<CanonicalServiceRow | null>;

  /** List services for a canonical organization. */
  listByOrganization(canonicalOrganizationId: string): Promise<CanonicalServiceRow[]>;

  /** List canonical services by lifecycle status. */
  listByLifecycle(lifecycleStatus: string, limit?: number): Promise<CanonicalServiceRow[]>;

  /** List canonical services by publication status. */
  listByPublication(publicationStatus: string, limit?: number, offset?: number): Promise<CanonicalServiceRow[]>;

  /** List canonical services by winning source system. */
  listByWinningSource(sourceSystemId: string, limit?: number): Promise<CanonicalServiceRow[]>;

  /** Create a canonical service. */
  create(row: NewCanonicalServiceRow): Promise<CanonicalServiceRow>;

  /** Update a canonical service. */
  update(id: string, updates: Partial<NewCanonicalServiceRow>): Promise<void>;

  /** Transition lifecycle status. */
  updateLifecycleStatus(id: string, status: string): Promise<void>;

  /** Transition publication status. */
  updatePublicationStatus(id: string, status: string): Promise<void>;

  /** Find active services matching a URL (for entity resolution). */
  findActiveByUrl(url: string): Promise<CanonicalServiceRow | null>;

  /** Find active services matching an exact name (for entity resolution). */
  findActiveByName(name: string): Promise<CanonicalServiceRow | null>;
}

// ============================================================
// CANONICAL LOCATION STORE
// ============================================================

export interface CanonicalLocationStore {
  /** Get a canonical location by ID. */
  getById(id: string): Promise<CanonicalLocationRow | null>;

  /** Get multiple canonical locations by ID (batch). */
  getByIds(ids: string[]): Promise<CanonicalLocationRow[]>;

  /** List locations for a canonical organization. */
  listByOrganization(canonicalOrganizationId: string): Promise<CanonicalLocationRow[]>;

  /** List canonical locations by lifecycle status. */
  listByLifecycle(lifecycleStatus: string, limit?: number): Promise<CanonicalLocationRow[]>;

  /** List canonical locations by publication status. */
  listByPublication(publicationStatus: string, limit?: number, offset?: number): Promise<CanonicalLocationRow[]>;

  /** List canonical locations by winning source system. */
  listByWinningSource(sourceSystemId: string, limit?: number): Promise<CanonicalLocationRow[]>;

  /** Create a canonical location. */
  create(row: NewCanonicalLocationRow): Promise<CanonicalLocationRow>;

  /** Update a canonical location. */
  update(id: string, updates: Partial<NewCanonicalLocationRow>): Promise<void>;

  /** Transition lifecycle status. */
  updateLifecycleStatus(id: string, status: string): Promise<void>;

  /** Transition publication status. */
  updatePublicationStatus(id: string, status: string): Promise<void>;
}

// ============================================================
// CANONICAL SERVICE LOCATION STORE (Junction)
// ============================================================

export interface CanonicalServiceLocationStore {
  /** List locations for a canonical service. */
  listByService(canonicalServiceId: string): Promise<CanonicalServiceLocationRow[]>;

  /** List services at a canonical location. */
  listByLocation(canonicalLocationId: string): Promise<CanonicalServiceLocationRow[]>;

  /** Link a service to a location. */
  create(row: NewCanonicalServiceLocationRow): Promise<CanonicalServiceLocationRow>;

  /** Bulk-create service–location links. */
  bulkCreate(rows: NewCanonicalServiceLocationRow[]): Promise<CanonicalServiceLocationRow[]>;

  /** Remove a service–location link. */
  remove(canonicalServiceId: string, canonicalLocationId: string): Promise<void>;
}

// ============================================================
// CANONICAL PROVENANCE STORE (Field-level Lineage)
// ============================================================

export interface CanonicalProvenanceStore {
  /** List all provenance records for an entity. */
  listByEntity(entityType: string, entityId: string): Promise<CanonicalProvenanceRow[]>;

  /** List accepted provenance for an entity’s specific field. */
  getAcceptedForField(
    entityType: string,
    entityId: string,
    fieldName: string
  ): Promise<CanonicalProvenanceRow | null>;

  /** Create a provenance record. */
  create(row: NewCanonicalProvenanceRow): Promise<CanonicalProvenanceRow>;

  /** Bulk-create provenance records (for batch normalization). */
  bulkCreate(rows: NewCanonicalProvenanceRow[]): Promise<void>;

  /** Update decision status for a provenance record. */
  updateDecision(
    id: string,
    decisionStatus: string,
    decidedBy?: string
  ): Promise<void>;

  /** Supersede all accepted records for a field (before accepting a new one). */
  supersedeField(
    entityType: string,
    entityId: string,
    fieldName: string
  ): Promise<number>;

  /**
   * Atomically supersede any existing accepted provenance for a field,
   * then mark the given record as accepted — inside a single transaction.
   */
  acceptField(
    provenanceId: string,
    entityType: string,
    entityId: string,
    fieldName: string,
    decidedBy?: string
  ): Promise<{ supersededCount: number }>;
}

// ============================================================
// TAXONOMY FEDERATION STORES (migration 0037)
// ============================================================

export interface TaxonomyRegistryStore {
  getById(id: string): Promise<TaxonomyRegistryRow | null>;
  findByName(name: string): Promise<TaxonomyRegistryRow | null>;
  listActive(): Promise<TaxonomyRegistryRow[]>;
  create(row: NewTaxonomyRegistryRow): Promise<TaxonomyRegistryRow>;
  update(id: string, fields: Partial<NewTaxonomyRegistryRow>): Promise<void>;
}

export interface TaxonomyTermExtStore {
  getById(id: string): Promise<TaxonomyTermExtRow | null>;
  findByRegistryAndCode(registryId: string, code: string): Promise<TaxonomyTermExtRow | null>;
  listByRegistry(registryId: string): Promise<TaxonomyTermExtRow[]>;
  create(row: NewTaxonomyTermExtRow): Promise<TaxonomyTermExtRow>;
  bulkCreate(rows: NewTaxonomyTermExtRow[]): Promise<void>;
}

export interface CanonicalConceptStore {
  getById(id: string): Promise<CanonicalConceptRow | null>;
  findByKey(conceptKey: string): Promise<CanonicalConceptRow | null>;
  listActive(): Promise<CanonicalConceptRow[]>;
  create(row: NewCanonicalConceptRow): Promise<CanonicalConceptRow>;
  update(id: string, fields: Partial<NewCanonicalConceptRow>): Promise<void>;
}

export interface TaxonomyCrosswalkStore {
  getById(id: string): Promise<TaxonomyCrosswalkRow | null>;
  findBySourceCode(registryId: string, sourceCode: string): Promise<TaxonomyCrosswalkRow[]>;
  findExact(registryId: string, sourceCode: string, conceptId: string): Promise<TaxonomyCrosswalkRow | null>;
  create(row: NewTaxonomyCrosswalkRow): Promise<TaxonomyCrosswalkRow>;
  bulkCreate(rows: NewTaxonomyCrosswalkRow[]): Promise<void>;
}

export interface ConceptTagDerivationStore {
  findByEntity(entityType: string, entityId: string): Promise<ConceptTagDerivationRow[]>;
  create(row: NewConceptTagDerivationRow): Promise<ConceptTagDerivationRow>;
  bulkCreate(rows: NewConceptTagDerivationRow[]): Promise<void>;
}

// ============================================================
// RESOLUTION & CLUSTERING STORES (migration 0038)
// ============================================================

export interface EntityClusterStore {
  getById(id: string): Promise<EntityClusterRow | null>;
  findByCanonicalEntity(entityType: string, entityId: string): Promise<EntityClusterRow[]>;
  listByStatus(status: string, limit?: number): Promise<EntityClusterRow[]>;
  create(row: NewEntityClusterRow): Promise<EntityClusterRow>;
  update(id: string, fields: Partial<NewEntityClusterRow>): Promise<void>;
}

export interface EntityClusterMemberStore {
  findByCluster(clusterId: string): Promise<EntityClusterMemberRow[]>;
  findByEntity(entityType: string, entityId: string): Promise<EntityClusterMemberRow[]>;
  create(row: NewEntityClusterMemberRow): Promise<EntityClusterMemberRow>;
  deleteByCluster(clusterId: string): Promise<number>;
}

export interface ResolutionCandidateStore {
  getById(id: string): Promise<ResolutionCandidateRow | null>;
  findBySourceRecord(sourceRecordId: string): Promise<ResolutionCandidateRow[]>;
  findByEntity(entityType: string, entityId: string): Promise<ResolutionCandidateRow[]>;
  listByStatus(status: string, limit?: number): Promise<ResolutionCandidateRow[]>;
  create(row: NewResolutionCandidateRow): Promise<ResolutionCandidateRow>;
  update(id: string, fields: Partial<NewResolutionCandidateRow>): Promise<void>;
}

export interface ResolutionDecisionStore {
  getById(id: string): Promise<ResolutionDecisionRow | null>;
  findBySourceRecord(sourceRecordId: string): Promise<ResolutionDecisionRow[]>;
  findByEntity(entityType: string, entityId: string): Promise<ResolutionDecisionRow[]>;
  create(row: NewResolutionDecisionRow): Promise<ResolutionDecisionRow>;
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

  // Source assertion layer (0032)
  sourceSystems: SourceSystemStore;
  sourceFeeds: SourceFeedStore;
  sourceFeedStates: SourceFeedStateStore;
  sourceRecords: SourceRecordStore;
  entityIdentifiers: EntityIdentifierStore;
  hsdsExportSnapshots: HsdsExportSnapshotStore;
  lifecycleEvents: LifecycleEventStore;

  // Canonical federation layer (0033)
  canonicalOrganizations: CanonicalOrganizationStore;
  canonicalServices: CanonicalServiceStore;
  canonicalLocations: CanonicalLocationStore;
  canonicalServiceLocations: CanonicalServiceLocationStore;
  canonicalProvenance: CanonicalProvenanceStore;

  // Taxonomy federation layer (0037)
  taxonomyRegistries: TaxonomyRegistryStore;
  taxonomyTermsExt: TaxonomyTermExtStore;
  canonicalConcepts: CanonicalConceptStore;
  taxonomyCrosswalks: TaxonomyCrosswalkStore;
  conceptTagDerivations: ConceptTagDerivationStore;

  // Resolution & clustering layer (0038)
  entityClusters: EntityClusterStore;
  entityClusterMembers: EntityClusterMemberStore;
  resolutionCandidates: ResolutionCandidateStore;
  resolutionDecisions: ResolutionDecisionStore;
}
