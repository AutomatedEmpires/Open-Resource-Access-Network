/**
 * Drizzle ORM Schema for ORAN Ingestion Tables
 *
 * This defines the TypeScript schema for tables used by the ingestion agent.
 * Corresponds to db/migrations/0002_ingestion_tables.sql
 */
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  numeric,
  uniqueIndex,
  index,
  customType,
  doublePrecision,
  date,
  time,
} from 'drizzle-orm/pg-core';

/**
 * Custom Drizzle type for PostGIS GEOMETRY columns.
 * Stored as WKT text in Drizzle, converted to/from GEOMETRY by PostGIS.
 * Use raw SQL (ST_AsText, ST_GeomFromText) for spatial queries.
 */
const geometryPoint = customType<{ data: string | null; driverParam: string | null }>({
  dataType() {
    return 'GEOMETRY(POINT, 4326)';
  },
  toDriver(value: string | null): string | null {
    return value;
  },
  fromDriver(value: unknown): string | null {
    return value as string | null;
  },
});

/**
 * Custom Drizzle type for PostGIS POLYGON columns.
 * Used for coverage zones and service areas.
 */
const geometryPolygon = customType<{ data: string | null; driverParam: string | null }>({
  dataType() {
    return 'GEOMETRY(Polygon, 4326)';
  },
  toDriver(value: string | null): string | null {
    return value;
  },
  fromDriver(value: unknown): string | null {
    return value as string | null;
  },
});

/**
 * Custom Drizzle type for pgvector VECTOR columns.
 * Stored/retrieved as string representation (e.g. "[0.1,0.2,...]").
 */
const vector1024 = customType<{ data: string | null; driverParam: string | null }>({
  dataType() {
    return 'vector(1024)';
  },
  toDriver(value: string | null): string | null {
    return value;
  },
  fromDriver(value: unknown): string | null {
    return value as string | null;
  },
});
import { relations } from 'drizzle-orm';

// ============================================================
// INGESTION SOURCES (Source Registry)
// ============================================================
export const ingestionSources = pgTable(
  'ingestion_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    pattern: text('pattern').notNull(),
    patternType: text('pattern_type').notNull().default('domain'),
    trustLevel: text('trust_level').notNull().default('quarantine'),
    maxDepth: integer('max_depth').notNull().default(2),
    crawlFrequency: integer('crawl_frequency').notNull().default(7),
    ownerOrgId: uuid('owner_org_id'),
    isActive: boolean('is_active').notNull().default(true),
    flags: jsonb('flags').notNull().default({}),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ingestion_sources_pattern').on(table.pattern),
    index('idx_ingestion_sources_trust').on(table.trustLevel),
  ]
);

export type IngestionSource = typeof ingestionSources.$inferSelect;
export type NewIngestionSource = typeof ingestionSources.$inferInsert;

// ============================================================
// INGESTION JOBS
// ============================================================
export const ingestionJobs = pgTable(
  'ingestion_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    correlationId: text('correlation_id').notNull().unique(),
    jobType: text('job_type').notNull(),
    sourceId: uuid('source_id').references(() => ingestionSources.id),
    sourceSystemId: uuid('source_system_id').references(() => sourceSystems.id),
    seedUrl: text('seed_url'),
    status: text('status').notNull().default('queued'),
    priority: integer('priority').notNull().default(0),
    maxUrls: integer('max_urls').default(100),
    currentDepth: integer('current_depth').default(0),
    statsUrlsDiscovered: integer('stats_urls_discovered').notNull().default(0),
    statsUrlsFetched: integer('stats_urls_fetched').notNull().default(0),
    statsCandidatesExtracted: integer('stats_candidates_extracted').notNull().default(0),
    statsCandidatesVerified: integer('stats_candidates_verified').notNull().default(0),
    statsErrorsCount: integer('stats_errors_count').notNull().default(0),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_ingestion_jobs_status').on(table.status),
    index('idx_ingestion_jobs_source').on(table.sourceId),
  ]
);

export type IngestionJobRow = typeof ingestionJobs.$inferSelect;
export type NewIngestionJobRow = typeof ingestionJobs.$inferInsert;

// ============================================================
// EVIDENCE SNAPSHOTS
// ============================================================
export const evidenceSnapshots = pgTable(
  'evidence_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evidenceId: text('evidence_id').notNull().unique(),
    canonicalUrl: text('canonical_url').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    httpStatus: integer('http_status').notNull(),
    contentHashSha256: text('content_hash_sha256').notNull(),
    contentLength: integer('content_length').notNull().default(0),
    contentType: text('content_type'),
    blobStorageKey: text('blob_storage_key'),
    htmlRaw: text('html_raw'),
    textExtracted: text('text_extracted'),
    title: text('title'),
    metaDescription: text('meta_description'),
    language: text('language'),
    jobId: uuid('job_id').references(() => ingestionJobs.id),
    correlationId: text('correlation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_evidence_canonical_url').on(table.canonicalUrl),
    index('idx_evidence_content_hash').on(table.contentHashSha256),
    index('idx_evidence_job').on(table.jobId),
  ]
);

export type EvidenceSnapshotRow = typeof evidenceSnapshots.$inferSelect;
export type NewEvidenceSnapshotRow = typeof evidenceSnapshots.$inferInsert;

// ============================================================
// EXTRACTED CANDIDATES
// ============================================================
export const extractedCandidates = pgTable(
  'extracted_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: text('candidate_id').notNull().unique(),
    extractionId: text('extraction_id').notNull().unique(),
    extractKeySha256: text('extract_key_sha256').notNull(),
    extractedAt: timestamp('extracted_at', { withTimezone: true }).notNull(),

    // Extracted fields
    organizationName: text('organization_name').notNull(),
    serviceName: text('service_name').notNull(),
    description: text('description'),
    websiteUrl: text('website_url'),
    phone: text('phone'),
    phones: jsonb('phones').default([]),
    addressLine1: text('address_line1'),
    addressLine2: text('address_line2'),
    addressCity: text('address_city'),
    addressRegion: text('address_region'),
    addressPostalCode: text('address_postal_code'),
    addressCountry: text('address_country').default('US'),
    isRemoteService: boolean('is_remote_service').default(false),

    // Review workflow
    reviewStatus: text('review_status').notNull().default('pending'),
    assignedToRole: text('assigned_to_role'),
    assignedToUserId: text('assigned_to_user_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    // Jurisdiction
    jurisdictionState: text('jurisdiction_state'),
    jurisdictionCounty: text('jurisdiction_county'),
    jurisdictionCity: text('jurisdiction_city'),
    jurisdictionKind: text('jurisdiction_kind').default('municipal'),

    // Scoring
    confidenceScore: integer('confidence_score').notNull().default(0),
    confidenceTier: text('confidence_tier').notNull().default('red'),
    scoreVerification: integer('score_verification').default(0),
    scoreCompleteness: integer('score_completeness').default(0),
    scoreFreshness: integer('score_freshness').default(0),

    // Timers
    reviewBy: timestamp('review_by', { withTimezone: true }),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    reverifyAt: timestamp('reverify_at', { withTimezone: true }),

    // Verification checklist
    verificationChecklist: jsonb('verification_checklist').notNull().default({}),

    // Investigation pack
    investigationPack: jsonb('investigation_pack').notNull().default({}),

    // Provenance
    primaryEvidenceId: text('primary_evidence_id'),
    provenanceRecords: jsonb('provenance_records').notNull().default([]),

    // Published
    publishedServiceId: uuid('published_service_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedByUserId: text('published_by_user_id'),

    // Job link
    jobId: uuid('job_id').references(() => ingestionJobs.id),
    correlationId: text('correlation_id').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_candidates_extract_key').on(table.extractKeySha256),
    index('idx_candidates_status').on(table.reviewStatus),
    index('idx_candidates_tier').on(table.confidenceTier),
    index('idx_candidates_jurisdiction').on(table.jurisdictionState, table.jurisdictionCounty),
    index('idx_candidates_job').on(table.jobId),
  ]
);

export type ExtractedCandidateRow = typeof extractedCandidates.$inferSelect;
export type NewExtractedCandidateRow = typeof extractedCandidates.$inferInsert;

// ============================================================
// RESOURCE TAGS
// ============================================================
export const resourceTags = pgTable(
  'resource_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    targetId: text('target_id').notNull(),
    targetType: text('target_type').notNull(),
    tagType: text('tag_type').notNull(),
    tagValue: text('tag_value').notNull(),
    confidence: integer('confidence'),
    source: text('source').notNull().default('llm'),
    addedBy: text('added_by'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_tags_unique').on(table.targetId, table.targetType, table.tagType, table.tagValue),
    index('idx_tags_target').on(table.targetId, table.targetType),
    index('idx_tags_type').on(table.tagType),
  ]
);

export type ResourceTagRow = typeof resourceTags.$inferSelect;
export type NewResourceTagRow = typeof resourceTags.$inferInsert;

// ============================================================
// DISCOVERED LINKS
// ============================================================
export const discoveredLinks = pgTable(
  'discovered_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    evidenceId: text('evidence_id').notNull(),
    url: text('url').notNull(),
    linkType: text('link_type').notNull(),
    label: text('label'),
    confidence: integer('confidence').default(50),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_discovered_links_evidence').on(table.evidenceId),
    index('idx_discovered_links_type').on(table.linkType),
  ]
);

export type DiscoveredLinkRow = typeof discoveredLinks.$inferSelect;
export type NewDiscoveredLinkRow = typeof discoveredLinks.$inferInsert;

// ============================================================
// AUDIT EVENTS
// ============================================================
export const ingestionAuditEvents = pgTable(
  'ingestion_audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: text('candidate_id').notNull(),
    eventType: text('event_type').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    details: jsonb('details').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_candidate').on(table.candidateId),
    index('idx_audit_type').on(table.eventType),
  ]
);

export type IngestionAuditEventRow = typeof ingestionAuditEvents.$inferSelect;
export type NewIngestionAuditEventRow = typeof ingestionAuditEvents.$inferInsert;

// ============================================================
// LLM SUGGESTIONS
// ============================================================
export const llmSuggestions = pgTable(
  'llm_suggestions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: text('candidate_id').notNull(),
    suggestionId: text('suggestion_id').notNull().unique(),
    field: text('field').notNull(),
    suggestedValue: text('suggested_value').notNull(),
    originalValue: text('original_value'),
    confidence: integer('confidence').notNull(),
    reasoning: text('reasoning'),
    status: text('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    evidenceId: text('evidence_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_suggestions_candidate').on(table.candidateId),
    index('idx_suggestions_status').on(table.status),
    index('idx_suggestions_field').on(table.field),
  ]
);

export type LlmSuggestionRow = typeof llmSuggestions.$inferSelect;
export type NewLlmSuggestionRow = typeof llmSuggestions.$inferInsert;

// ============================================================
// RELATIONS
// ============================================================
export const ingestionJobsRelations = relations(ingestionJobs, ({ one, many }) => ({
  source: one(ingestionSources, {
    fields: [ingestionJobs.sourceId],
    references: [ingestionSources.id],
  }),
  evidenceSnapshots: many(evidenceSnapshots),
  candidates: many(extractedCandidates),
}));

export const evidenceSnapshotsRelations = relations(evidenceSnapshots, ({ one, many }) => ({
  job: one(ingestionJobs, {
    fields: [evidenceSnapshots.jobId],
    references: [ingestionJobs.id],
  }),
  links: many(discoveredLinks),
}));

export const extractedCandidatesRelations = relations(extractedCandidates, ({ one, many }) => ({
  job: one(ingestionJobs, {
    fields: [extractedCandidates.jobId],
    references: [ingestionJobs.id],
  }),
  auditEvents: many(ingestionAuditEvents),
  suggestions: many(llmSuggestions),
}));

export const discoveredLinksRelations = relations(discoveredLinks, ({ one }) => ({
  evidence: one(evidenceSnapshots, {
    fields: [discoveredLinks.evidenceId],
    references: [evidenceSnapshots.evidenceId],
  }),
}));

export const ingestionAuditEventsRelations = relations(ingestionAuditEvents, ({ one }) => ({
  candidate: one(extractedCandidates, {
    fields: [ingestionAuditEvents.candidateId],
    references: [extractedCandidates.candidateId],
  }),
}));

export const llmSuggestionsRelations = relations(llmSuggestions, ({ one }) => ({
  candidate: one(extractedCandidates, {
    fields: [llmSuggestions.candidateId],
    references: [extractedCandidates.candidateId],
  }),
}));

// ============================================================
// ADMIN REVIEW PROFILES (0018_admin_capacity_routing.sql)
// ============================================================
export const adminReviewProfiles = pgTable(
  'admin_review_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().unique(),

    // Capacity limits
    maxPending: integer('max_pending').notNull().default(10),
    maxInReview: integer('max_in_review').notNull().default(5),

    // Current counts (maintained by triggers)
    pendingCount: integer('pending_count').notNull().default(0),
    inReviewCount: integer('in_review_count').notNull().default(0),

    // Geographic location for routing (PostGIS GEOMETRY)
    location: geometryPoint('location'),

    // Coverage filters
    coverageZoneId: uuid('coverage_zone_id'),
    coverageStates: text('coverage_states').array().default([]),
    coverageCounties: text('coverage_counties').array().default([]),

    // Expertise
    categoryExpertise: text('category_expertise').array().default([]),

    // Performance metrics
    totalVerified: integer('total_verified').notNull().default(0),
    totalRejected: integer('total_rejected').notNull().default(0),
    avgReviewHours: numeric('avg_review_hours', { precision: 10, scale: 2 }),
    lastReviewAt: timestamp('last_review_at', { withTimezone: true }),

    // Status
    isActive: boolean('is_active').notNull().default(true),
    isAcceptingNew: boolean('is_accepting_new').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_admin_review_profiles_user').on(table.userId),
    index('idx_admin_review_profiles_available').on(table.isActive, table.isAcceptingNew, table.pendingCount),
  ]
);

export type AdminReviewProfileRow = typeof adminReviewProfiles.$inferSelect;
export type NewAdminReviewProfileRow = typeof adminReviewProfiles.$inferInsert;

// ============================================================
// CANDIDATE ADMIN ASSIGNMENTS (0018_admin_capacity_routing.sql)
// ============================================================
export const candidateAdminAssignments = pgTable(
  'candidate_admin_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: text('candidate_id').notNull(),
    adminProfileId: uuid('admin_profile_id').notNull().references(() => adminReviewProfiles.id),

    assignmentType: text('assignment_type').notNull().default('geographic'),
    priorityRank: integer('priority_rank').notNull().default(1),
    distanceMeters: numeric('distance_meters', { precision: 12, scale: 2 }),

    status: text('status').notNull().default('pending'),

    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    outcome: text('outcome'),
    outcomeNotes: text('outcome_notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_candidate_assignments_unique').on(table.candidateId, table.adminProfileId),
    index('idx_candidate_assignments_candidate').on(table.candidateId),
    index('idx_candidate_assignments_admin').on(table.adminProfileId),
    index('idx_candidate_assignments_status').on(table.status),
  ]
);

export type CandidateAdminAssignmentRow = typeof candidateAdminAssignments.$inferSelect;
export type NewCandidateAdminAssignmentRow = typeof candidateAdminAssignments.$inferInsert;

// ============================================================
// SEEKER PROFILES (0034_seeker_profiles.sql)
// ============================================================
export const seekerProfiles = pgTable(
  'seeker_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().unique(),
    serviceInterests: text('service_interests').array().notNull().default([]),
    ageGroup: text('age_group'),
    householdType: text('household_type'),
    housingSituation: text('housing_situation'),
    selfIdentifiers: text('self_identifiers').array().notNull().default([]),
    currentServices: text('current_services').array().notNull().default([]),
    accessibilityNeeds: text('accessibility_needs').array().notNull().default([]),
    transportationBarrier: boolean('transportation_barrier').notNull().default(false),
    preferredDeliveryModes: text('preferred_delivery_modes').array().notNull().default([]),
    urgencyWindow: text('urgency_window'),
    documentationBarriers: text('documentation_barriers').array().notNull().default([]),
    digitalAccessBarrier: boolean('digital_access_barrier').notNull().default(false),
    pronouns: text('pronouns'),
    profileHeadline: text('profile_headline'),
    avatarEmoji: text('avatar_emoji'),
    accentTheme: text('accent_theme').notNull().default('ocean'),
    contactPhone: text('contact_phone'),
    contactEmail: text('contact_email'),
    additionalContext: text('additional_context'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_seeker_profiles_user').on(table.userId),
  ]
);

export type SeekerProfileRow = typeof seekerProfiles.$inferSelect;
export type NewSeekerProfileRow = typeof seekerProfiles.$inferInsert;

// ============================================================
// TAG CONFIRMATION QUEUE (0019_tag_confirmation_queue.sql)
// ============================================================
export const tagConfirmationQueue = pgTable(
  'tag_confirmation_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceTagId: uuid('resource_tag_id').notNull(),
    candidateId: text('candidate_id').notNull(),
    tagType: text('tag_type').notNull(),
    tagValue: text('tag_value').notNull(),
    originalConfidence: integer('original_confidence').notNull(),

    status: text('status').notNull().default('pending'),

    assignedToUserId: text('assigned_to_user_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),

    reviewedByUserId: text('reviewed_by_user_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),

    modifiedTagValue: text('modified_tag_value'),
    reviewNotes: text('review_notes'),

    evidenceSnippet: text('evidence_snippet'),
    evidenceId: text('evidence_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_tag_queue_candidate').on(table.candidateId),
    index('idx_tag_queue_status').on(table.status),
    index('idx_tag_queue_resource_tag').on(table.resourceTagId),
  ]
);

export type TagConfirmationQueueRow = typeof tagConfirmationQueue.$inferSelect;
export type NewTagConfirmationQueueRow = typeof tagConfirmationQueue.$inferInsert;

// ============================================================
// PUBLISH CRITERIA (0019_tag_confirmation_queue.sql)
// ============================================================
export const publishCriteria = pgTable(
  'publish_criteria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jurisdictionState: text('jurisdiction_state'),
    jurisdictionCounty: text('jurisdiction_county'),
    primaryCategory: text('primary_category'),

    minOverallScore: integer('min_overall_score').notNull().default(60),
    minTagConfidence: integer('min_tag_confidence').notNull().default(70),
    minAdminApprovals: integer('min_admin_approvals').notNull().default(1),
    requireOrgApproval: boolean('require_org_approval').notNull().default(false),

    requiredFields: jsonb('required_fields').notNull().default(['organization_name', 'service_name']),
    minServiceTypeTags: integer('min_service_type_tags').notNull().default(1),
    requireDemographicTag: boolean('require_demographic_tag').notNull().default(false),

    maxReviewHours: integer('max_review_hours').notNull().default(48),
    isActive: boolean('is_active').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_publish_criteria_state').on(table.jurisdictionState),
    index('idx_publish_criteria_category').on(table.primaryCategory),
  ]
);

export type PublishCriteriaRow = typeof publishCriteria.$inferSelect;
export type NewPublishCriteriaRow = typeof publishCriteria.$inferInsert;

// ============================================================
// CANDIDATE READINESS (0019_tag_confirmation_queue.sql)
// ============================================================
export const candidateReadiness = pgTable(
  'candidate_readiness',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: text('candidate_id').notNull().unique(),

    isReady: boolean('is_ready').notNull().default(false),

    hasRequiredFields: boolean('has_required_fields').notNull().default(false),
    hasRequiredTags: boolean('has_required_tags').notNull().default(false),
    tagsConfirmed: boolean('tags_confirmed').notNull().default(false),
    meetsScoreThreshold: boolean('meets_score_threshold').notNull().default(false),
    hasAdminApproval: boolean('has_admin_approval').notNull().default(false),

    pendingTagCount: integer('pending_tag_count').notNull().default(0),
    adminApprovalCount: integer('admin_approval_count').notNull().default(0),

    blockers: jsonb('blockers').notNull().default([]),

    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_candidate_readiness_ready').on(table.isReady),
    index('idx_candidate_readiness_pending').on(table.pendingTagCount),
  ]
);

export type CandidateReadinessRow = typeof candidateReadiness.$inferSelect;
export type NewCandidateReadinessRow = typeof candidateReadiness.$inferInsert;

// ============================================================
// VERIFICATION CHECKS (0021_ingestion_completion.sql)
// ============================================================
export const verificationChecks = pgTable(
  'verification_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: text('candidate_id').notNull(),
    checkType: text('check_type').notNull(),
    severity: text('severity').notNull().default('info'),
    status: text('status').notNull().default('pending'),
    message: text('message'),
    details: jsonb('details').notNull().default({}),
    evidenceRefs: text('evidence_refs').array().default([]),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_verification_checks_unique').on(table.candidateId, table.checkType),
    index('idx_verification_checks_candidate').on(table.candidateId),
    index('idx_verification_checks_status').on(table.status),
  ]
);

export type VerificationCheckRow = typeof verificationChecks.$inferSelect;
export type NewVerificationCheckRow = typeof verificationChecks.$inferInsert;

// ============================================================
// VERIFIED SERVICE LINKS (0021_ingestion_completion.sql)
// ============================================================
export const verifiedServiceLinks = pgTable(
  'verified_service_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    candidateId: text('candidate_id'),
    serviceId: uuid('service_id'),
    url: text('url').notNull(),
    label: text('label').notNull().default(''),
    linkType: text('link_type').notNull().default('other'),
    intentActions: text('intent_actions').array().default([]),
    intentCategories: text('intent_categories').array().default([]),
    audienceTags: text('audience_tags').array().default([]),
    locales: text('locales').array().default([]),
    isVerified: boolean('is_verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verifiedByUserId: text('verified_by_user_id'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    lastHttpStatus: integer('last_http_status'),
    isLinkAlive: boolean('is_link_alive').default(true),
    evidenceId: text('evidence_id'),
    discoveredAt: timestamp('discovered_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_verified_links_candidate').on(table.candidateId),
    index('idx_verified_links_service').on(table.serviceId),
    index('idx_verified_links_type').on(table.linkType),
    index('idx_verified_links_verified').on(table.isVerified, table.isLinkAlive),
  ]
);

export type VerifiedServiceLinkRow = typeof verifiedServiceLinks.$inferSelect;
export type NewVerifiedServiceLinkRow = typeof verifiedServiceLinks.$inferInsert;

// ============================================================
// FEED SUBSCRIPTIONS (0021_ingestion_completion.sql)
// ============================================================
export const feedSubscriptions = pgTable(
  'feed_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRegistryId: uuid('source_registry_id').references(() => ingestionSources.id),
    feedUrl: text('feed_url').notNull().unique(),
    feedType: text('feed_type').notNull().default('rss'),
    displayName: text('display_name'),
    pollIntervalHours: integer('poll_interval_hours').notNull().default(24),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    lastEtag: text('last_etag'),
    lastModified: text('last_modified'),
    isActive: boolean('is_active').notNull().default(true),
    errorCount: integer('error_count').notNull().default(0),
    lastError: text('last_error'),
    jurisdictionState: text('jurisdiction_state'),
    jurisdictionCounty: text('jurisdiction_county'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_feed_subs_active').on(table.isActive),
    index('idx_feed_subs_source').on(table.sourceRegistryId),
  ]
);

export type FeedSubscriptionRow = typeof feedSubscriptions.$inferSelect;
export type NewFeedSubscriptionRow = typeof feedSubscriptions.$inferInsert;

// ============================================================
// ADMIN ROUTING RULES (0021_ingestion_completion.sql)
// ============================================================
export const adminRoutingRules = pgTable(
  'admin_routing_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jurisdictionCountry: text('jurisdiction_country').notNull().default('US'),
    jurisdictionState: text('jurisdiction_state'),
    jurisdictionCounty: text('jurisdiction_county'),
    assignedRole: text('assigned_role').notNull().default('community_admin'),
    assignedUserId: text('assigned_user_id'),
    priority: integer('priority').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_admin_routing_jurisdiction').on(
      table.jurisdictionCountry,
      table.jurisdictionState,
      table.jurisdictionCounty
    ),
    index('idx_admin_routing_active').on(table.isActive),
  ]
);

export type AdminRoutingRuleRow = typeof adminRoutingRules.$inferSelect;
export type NewAdminRoutingRuleRow = typeof adminRoutingRules.$inferInsert;

// ============================================================
// ADDITIONAL RELATIONS (0018/0019/0021)
// ============================================================
export const adminReviewProfilesRelations = relations(adminReviewProfiles, ({ many }) => ({
  assignments: many(candidateAdminAssignments),
}));

export const candidateAdminAssignmentsRelations = relations(candidateAdminAssignments, ({ one }) => ({
  adminProfile: one(adminReviewProfiles, {
    fields: [candidateAdminAssignments.adminProfileId],
    references: [adminReviewProfiles.id],
  }),
}));

export const tagConfirmationQueueRelations = relations(tagConfirmationQueue, ({ one }) => ({
  resourceTag: one(resourceTags, {
    fields: [tagConfirmationQueue.resourceTagId],
    references: [resourceTags.id],
  }),
}));

// ============================================================
// SUBMISSIONS (Universal Pipeline) — 0022_universal_pipeline.sql
// ============================================================
export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    submissionType: text('submission_type').notNull(),
    status: text('status').notNull().default('draft'),

    targetType: text('target_type').notNull().default('service'),
    targetId: uuid('target_id'),
    serviceId: uuid('service_id'),

    submittedByUserId: text('submitted_by_user_id').notNull(),
    assignedToUserId: text('assigned_to_user_id'),

    title: text('title'),
    notes: text('notes'),
    reviewerNotes: text('reviewer_notes'),

    payload: jsonb('payload').notNull().default({}),
    evidence: jsonb('evidence').notNull().default([]),

    priority: integer('priority').notNull().default(0),

    isLocked: boolean('is_locked').notNull().default(false),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedByUserId: text('locked_by_user_id'),

    slaDeadline: timestamp('sla_deadline', { withTimezone: true }),
    slaBreached: boolean('sla_breached').notNull().default(false),

    jurisdictionState: text('jurisdiction_state'),
    jurisdictionCounty: text('jurisdiction_county'),

    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_submissions_type').on(table.submissionType),
    index('idx_submissions_status').on(table.status),
    index('idx_submissions_target').on(table.targetType, table.targetId),
    index('idx_submissions_service').on(table.serviceId),
    index('idx_submissions_submitter').on(table.submittedByUserId),
    index('idx_submissions_assigned').on(table.assignedToUserId),
    index('idx_submissions_priority').on(table.priority),
    index('idx_submissions_type_status').on(table.submissionType, table.status),
    index('idx_submissions_created').on(table.createdAt),
  ]
);

export type SubmissionRow = typeof submissions.$inferSelect;
export type NewSubmissionRow = typeof submissions.$inferInsert;

// ============================================================
// SUBMISSION TRANSITIONS (Full State Audit Trail)
// ============================================================
export const submissionTransitions = pgTable(
  'submission_transitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),

    fromStatus: text('from_status').notNull(),
    toStatus: text('to_status').notNull(),

    actorUserId: text('actor_user_id').notNull(),
    actorRole: text('actor_role'),

    reason: text('reason'),

    gatesChecked: jsonb('gates_checked').notNull().default([]),
    gatesPassed: boolean('gates_passed').notNull().default(true),

    metadata: jsonb('metadata').notNull().default({}),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_sub_transitions_submission').on(table.submissionId),
    index('idx_sub_transitions_actor').on(table.actorUserId),
    index('idx_sub_transitions_created').on(table.createdAt),
  ]
);

export type SubmissionTransitionRow = typeof submissionTransitions.$inferSelect;
export type NewSubmissionTransitionRow = typeof submissionTransitions.$inferInsert;

// ============================================================
// SUBMISSION SLAS (Deadline Rules)
// ============================================================
export const submissionSlas = pgTable(
  'submission_slas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionType: text('submission_type').notNull(),
    jurisdictionState: text('jurisdiction_state'),
    jurisdictionCounty: text('jurisdiction_county'),
    reviewHours: integer('review_hours').notNull().default(48),
    escalationHours: integer('escalation_hours').notNull().default(72),
    notifyOnBreach: text('notify_on_breach').array().default([]),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_sub_slas_type').on(table.submissionType),
  ]
);

export type SubmissionSlaRow = typeof submissionSlas.$inferSelect;
export type NewSubmissionSlaRow = typeof submissionSlas.$inferInsert;

// ============================================================
// PLATFORM SCOPES (Global Scope Registry)
// ============================================================
export const platformScopes = pgTable(
  'platform_scopes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    description: text('description').notNull(),
    category: text('category').notNull(),
    riskLevel: text('risk_level').notNull().default('standard'),
    requiresApproval: boolean('requires_approval').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_platform_scopes_category').on(table.category),
    index('idx_platform_scopes_risk').on(table.riskLevel),
  ]
);

export type PlatformScopeRow = typeof platformScopes.$inferSelect;
export type NewPlatformScopeRow = typeof platformScopes.$inferInsert;

// ============================================================
// PLATFORM ROLES (Role Templates)
// ============================================================
export const platformRoles = pgTable(
  'platform_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    description: text('description').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    isOrgScoped: boolean('is_org_scoped').notNull().default(false),
    hierarchyLevel: integer('hierarchy_level').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_platform_roles_active').on(table.isActive),
  ]
);

export type PlatformRoleRow = typeof platformRoles.$inferSelect;
export type NewPlatformRoleRow = typeof platformRoles.$inferInsert;

// ============================================================
// ROLE SCOPE ASSIGNMENTS (Role → Scope mappings)
// ============================================================
export const roleScopeAssignments = pgTable(
  'role_scope_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roleId: uuid('role_id').notNull().references(() => platformRoles.id, { onDelete: 'cascade' }),
    scopeId: uuid('scope_id').notNull().references(() => platformScopes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_role_scopes_unique').on(table.roleId, table.scopeId),
    index('idx_role_scopes_role').on(table.roleId),
    index('idx_role_scopes_scope').on(table.scopeId),
  ]
);

export type RoleScopeAssignmentRow = typeof roleScopeAssignments.$inferSelect;
export type NewRoleScopeAssignmentRow = typeof roleScopeAssignments.$inferInsert;

// ============================================================
// USER SCOPE GRANTS (Direct scope grants to users)
// ============================================================
export const userScopeGrants = pgTable(
  'user_scope_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    scopeId: uuid('scope_id').notNull().references(() => platformScopes.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id'),
    grantedByUserId: text('granted_by_user_id').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    approvalId: uuid('approval_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_user_scopes_unique').on(table.userId, table.scopeId, table.organizationId),
    index('idx_user_scopes_user').on(table.userId),
    index('idx_user_scopes_scope').on(table.scopeId),
    index('idx_user_scopes_active').on(table.isActive, table.expiresAt),
  ]
);

export type UserScopeGrantRow = typeof userScopeGrants.$inferSelect;
export type NewUserScopeGrantRow = typeof userScopeGrants.$inferInsert;

// ============================================================
// PENDING SCOPE GRANTS (Two-Person Approval Queue)
// ============================================================
export const pendingScopeGrants = pgTable(
  'pending_scope_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    scopeId: uuid('scope_id').notNull().references(() => platformScopes.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id'),
    requestedByUserId: text('requested_by_user_id').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    justification: text('justification').notNull(),
    status: text('status').notNull().default('pending'),
    decidedByUserId: text('decided_by_user_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReason: text('decision_reason'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_pending_grants_status').on(table.status),
    index('idx_pending_grants_user').on(table.userId),
    index('idx_pending_grants_requester').on(table.requestedByUserId),
  ]
);

export type PendingScopeGrantRow = typeof pendingScopeGrants.$inferSelect;
export type NewPendingScopeGrantRow = typeof pendingScopeGrants.$inferInsert;

// ============================================================
// SCOPE AUDIT LOG
// ============================================================
export const scopeAuditLog = pgTable(
  'scope_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actor_user_id').notNull(),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    beforeState: jsonb('before_state'),
    afterState: jsonb('after_state'),
    justification: text('justification'),
    ipDigest: text('ip_digest'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_scope_audit_actor').on(table.actorUserId),
    index('idx_scope_audit_action').on(table.action),
    index('idx_scope_audit_target').on(table.targetType, table.targetId),
    index('idx_scope_audit_created').on(table.createdAt),
  ]
);

export type ScopeAuditLogRow = typeof scopeAuditLog.$inferSelect;
export type NewScopeAuditLogRow = typeof scopeAuditLog.$inferInsert;

// ============================================================
// NOTIFICATION EVENTS
// ============================================================
export const notificationEvents = pgTable(
  'notification_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recipientUserId: text('recipient_user_id').notNull(),
    eventType: text('event_type').notNull(),
    channel: text('channel').notNull().default('in_app'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    actionUrl: text('action_url'),
    status: text('status').notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    idempotencyKey: text('idempotency_key').unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_notifications_recipient').on(table.recipientUserId, table.status),
    index('idx_notifications_type').on(table.eventType),
    index('idx_notifications_created').on(table.createdAt),
  ]
);

export type NotificationEventRow = typeof notificationEvents.$inferSelect;
export type NewNotificationEventRow = typeof notificationEvents.$inferInsert;

// ============================================================
// NOTIFICATION PREFERENCES
// ============================================================
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    eventType: text('event_type').notNull(),
    channel: text('channel').notNull().default('in_app'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_notif_prefs_unique').on(table.userId, table.eventType, table.channel),
    index('idx_notif_prefs_user').on(table.userId),
  ]
);

export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferenceRow = typeof notificationPreferences.$inferInsert;

// ============================================================
// RELATIONS (0022 Universal Pipeline)
// ============================================================.
export const submissionsRelations = relations(submissions, ({ many }) => ({
  transitions: many(submissionTransitions),
}));

export const submissionTransitionsRelations = relations(submissionTransitions, ({ one }) => ({
  submission: one(submissions, {
    fields: [submissionTransitions.submissionId],
    references: [submissions.id],
  }),
}));

export const platformRolesRelations = relations(platformRoles, ({ many }) => ({
  scopeAssignments: many(roleScopeAssignments),
}));

export const platformScopesRelations = relations(platformScopes, ({ many }) => ({
  roleAssignments: many(roleScopeAssignments),
  userGrants: many(userScopeGrants),
  pendingGrants: many(pendingScopeGrants),
}));

export const roleScopeAssignmentsRelations = relations(roleScopeAssignments, ({ one }) => ({
  role: one(platformRoles, {
    fields: [roleScopeAssignments.roleId],
    references: [platformRoles.id],
  }),
  scope: one(platformScopes, {
    fields: [roleScopeAssignments.scopeId],
    references: [platformScopes.id],
  }),
}));

export const userScopeGrantsRelations = relations(userScopeGrants, ({ one }) => ({
  scope: one(platformScopes, {
    fields: [userScopeGrants.scopeId],
    references: [platformScopes.id],
  }),
}));

export const pendingScopeGrantsRelations = relations(pendingScopeGrants, ({ one }) => ({
  scope: one(platformScopes, {
    fields: [pendingScopeGrants.scopeId],
    references: [platformScopes.id],
  }),
}));

export const candidateReadinessRelations = relations(candidateReadiness, ({ one }) => ({
  candidate: one(extractedCandidates, {
    fields: [candidateReadiness.candidateId],
    references: [extractedCandidates.candidateId],
  }),
}));

// ============================================================
// SOURCE SYSTEMS (0032_source_assertion_layer.sql)
// ============================================================
// Unified source registry. Subsumes ingestion_sources with a
// superset design supporting HSDS publishers, partner APIs,
// government data, scrape, and manual intake.
export const sourceSystems = pgTable(
  'source_systems',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    family: text('family').notNull(),
    homepageUrl: text('homepage_url'),
    licenseNotes: text('license_notes'),
    termsUrl: text('terms_url'),
    trustTier: text('trust_tier').notNull().default('quarantine'),
    hsdsProfileUri: text('hsds_profile_uri'),
    domainRules: jsonb('domain_rules').notNull().default([]),
    crawlPolicy: jsonb('crawl_policy').notNull().default({}),
    jurisdictionScope: jsonb('jurisdiction_scope').notNull().default({}),
    contactInfo: jsonb('contact_info').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    legacyIngestionSourceId: uuid('legacy_ingestion_source_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_source_systems_name').on(table.name),
    index('idx_source_systems_family').on(table.family),
    index('idx_source_systems_trust').on(table.trustTier),
    index('idx_source_systems_active').on(table.isActive),
  ]
);

export type SourceSystemRow = typeof sourceSystems.$inferSelect;
export type NewSourceSystemRow = typeof sourceSystems.$inferInsert;

// ============================================================
// SOURCE FEEDS (0032_source_assertion_layer.sql)
// ============================================================
export const sourceFeeds = pgTable(
  'source_feeds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceSystemId: uuid('source_system_id').notNull().references(() => sourceSystems.id, { onDelete: 'cascade' }),
    feedName: text('feed_name').notNull(),
    feedType: text('feed_type').notNull(),
    feedHandler: text('feed_handler').notNull().default('none'),
    baseUrl: text('base_url'),
    healthcheckUrl: text('healthcheck_url'),
    authType: text('auth_type').default('none'),
    profileUri: text('profile_uri'),
    jurisdictionScope: jsonb('jurisdiction_scope').notNull().default({}),
    refreshIntervalHours: integer('refresh_interval_hours').default(24),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),
    errorCount: integer('error_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_source_feeds_system').on(table.sourceSystemId),
    index('idx_source_feeds_active').on(table.isActive),
    index('idx_source_feeds_type').on(table.feedType),
    index('idx_source_feeds_handler').on(table.feedHandler),
  ]
);

export type SourceFeedRow = typeof sourceFeeds.$inferSelect;
export type NewSourceFeedRow = typeof sourceFeeds.$inferInsert;

// ============================================================
// SOURCE FEED STATES (0046_source_feed_operational_state.sql)
// ============================================================
export const sourceFeedStates = pgTable(
  'source_feed_states',
  {
    sourceFeedId: uuid('source_feed_id').primaryKey().references(() => sourceFeeds.id, { onDelete: 'cascade' }),
    publicationMode: text('publication_mode').notNull().default('review_required'),
    autoPublishApprovedAt: timestamp('auto_publish_approved_at', { withTimezone: true }),
    autoPublishApprovedBy: text('auto_publish_approved_by'),
    emergencyPause: boolean('emergency_pause').notNull().default(false),
    includedDataOwners: jsonb('included_data_owners').notNull().default([]),
    excludedDataOwners: jsonb('excluded_data_owners').notNull().default([]),
    maxOrganizationsPerPoll: integer('max_organizations_per_poll'),
    checkpointCursor: text('checkpoint_cursor'),
    replayFromCursor: text('replay_from_cursor'),
    lastAttemptStatus: text('last_attempt_status').notNull().default('idle'),
    lastAttemptStartedAt: timestamp('last_attempt_started_at', { withTimezone: true }),
    lastAttemptCompletedAt: timestamp('last_attempt_completed_at', { withTimezone: true }),
    lastSuccessfulSyncStartedAt: timestamp('last_successful_sync_started_at', { withTimezone: true }),
    lastSuccessfulSyncCompletedAt: timestamp('last_successful_sync_completed_at', { withTimezone: true }),
    lastAttemptSummary: jsonb('last_attempt_summary').notNull().default({}),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_source_feed_states_publication_mode').on(table.publicationMode),
    index('idx_source_feed_states_last_attempt_status').on(table.lastAttemptStatus),
    index('idx_source_feed_states_emergency_pause').on(table.emergencyPause),
  ]
);

export type SourceFeedStateRow = typeof sourceFeedStates.$inferSelect;
export type NewSourceFeedStateRow = typeof sourceFeedStates.$inferInsert;

// ============================================================
// SOURCE RECORDS (0032_source_assertion_layer.sql)
// ============================================================
// Immutable assertion layer. Every inbound record lands here
// before reaching canonical ORAN tables.
export const sourceRecords = pgTable(
  'source_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceFeedId: uuid('source_feed_id').notNull().references(() => sourceFeeds.id, { onDelete: 'cascade' }),
    sourceRecordType: text('source_record_type').notNull(),
    sourceRecordId: text('source_record_id').notNull(),
    sourceVersion: text('source_version'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    canonicalSourceUrl: text('canonical_source_url'),
    payloadSha256: text('payload_sha256').notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    parsedPayload: jsonb('parsed_payload'),
    evidenceId: text('evidence_id'),
    correlationId: text('correlation_id'),
    sourceLicense: text('source_license'),
    sourceConfidenceSignals: jsonb('source_confidence_signals').notNull().default({}),
    processingStatus: text('processing_status').notNull().default('pending'),
    processingError: text('processing_error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_source_records_dedup').on(
      table.sourceFeedId, table.sourceRecordType, table.sourceRecordId, table.payloadSha256
    ),
    index('idx_source_records_feed').on(table.sourceFeedId),
    index('idx_source_records_type').on(table.sourceRecordType),
    index('idx_source_records_status').on(table.processingStatus),
    index('idx_source_records_fetched').on(table.fetchedAt),
    index('idx_source_records_source_id').on(table.sourceRecordId),
    index('idx_source_records_correlation').on(table.correlationId),
  ]
);

export type SourceRecordRow = typeof sourceRecords.$inferSelect;
export type NewSourceRecordRow = typeof sourceRecords.$inferInsert;

// ============================================================
// SOURCE RECORD TAXONOMY (0032_source_assertion_layer.sql)
// ============================================================
// Preserves external taxonomy codes from inbound records for
// round-trip fidelity. Never overwritten by ORAN tagging.
export const sourceRecordTaxonomy = pgTable(
  'source_record_taxonomy',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRecordId: uuid('source_record_id').notNull().references(() => sourceRecords.id, { onDelete: 'cascade' }),
    taxonomyName: text('taxonomy_name').notNull(),
    termCode: text('term_code').notNull(),
    termName: text('term_name'),
    termUri: text('term_uri'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_src_taxonomy_record').on(table.sourceRecordId),
    index('idx_src_taxonomy_code').on(table.taxonomyName, table.termCode),
  ]
);

export type SourceRecordTaxonomyRow = typeof sourceRecordTaxonomy.$inferSelect;
export type NewSourceRecordTaxonomyRow = typeof sourceRecordTaxonomy.$inferInsert;

// ============================================================
// ENTITY IDENTIFIERS (0032_source_assertion_layer.sql)
// ============================================================
// Cross-database reference IDs. Links ORAN entities to their
// identifiers in external systems. When a listing changes status,
// all linked identifiers reflect that.
export const entityIdentifiers = pgTable(
  'entity_identifiers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    identifierScheme: text('identifier_scheme').notNull(),
    identifierValue: text('identifier_value').notNull(),
    sourceSystemId: uuid('source_system_id').references(() => sourceSystems.id, { onDelete: 'set null' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    confidence: integer('confidence').default(100),
    status: text('status').notNull().default('active'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_entity_ids_unique').on(
      table.entityType, table.entityId, table.identifierScheme, table.identifierValue
    ),
    index('idx_entity_ids_entity').on(table.entityType, table.entityId),
    index('idx_entity_ids_scheme').on(table.identifierScheme, table.identifierValue),
    index('idx_entity_ids_source').on(table.sourceSystemId),
    index('idx_entity_ids_status').on(table.status),
  ]
);

export type EntityIdentifierRow = typeof entityIdentifiers.$inferSelect;
export type NewEntityIdentifierRow = typeof entityIdentifiers.$inferInsert;

// ============================================================
// HSDS EXPORT SNAPSHOTS (0032_source_assertion_layer.sql)
// ============================================================
// Pre-computed HSDS-compatible JSON for published entities.
export const hsdsExportSnapshots = pgTable(
  'hsds_export_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    snapshotVersion: integer('snapshot_version').notNull().default(1),
    hsdsPayload: jsonb('hsds_payload').notNull(),
    profileUri: text('profile_uri'),
    status: text('status').notNull().default('current'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_hsds_snapshots_entity').on(table.entityType, table.entityId),
    index('idx_hsds_snapshots_status').on(table.status),
  ]
);

export type HsdsExportSnapshotRow = typeof hsdsExportSnapshots.$inferSelect;
export type NewHsdsExportSnapshotRow = typeof hsdsExportSnapshots.$inferInsert;

// ============================================================
// LIFECYCLE EVENTS (0032_source_assertion_layer.sql)
// ============================================================
// Status change audit trail for cross-database propagation.
export const lifecycleEvents = pgTable(
  'lifecycle_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    actorType: text('actor_type').notNull().default('system'),
    actorId: text('actor_id'),
    reason: text('reason'),
    metadata: jsonb('metadata').notNull().default({}),
    identifiersAffected: integer('identifiers_affected').notNull().default(0),
    snapshotsInvalidated: integer('snapshots_invalidated').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_lifecycle_entity').on(table.entityType, table.entityId),
    index('idx_lifecycle_type').on(table.eventType),
    index('idx_lifecycle_created').on(table.createdAt),
  ]
);

export type LifecycleEventRow = typeof lifecycleEvents.$inferSelect;
export type NewLifecycleEventRow = typeof lifecycleEvents.$inferInsert;

// ============================================================
// RELATIONS (0032_source_assertion_layer.sql)
// ============================================================
export const sourceSystemsRelations = relations(sourceSystems, ({ many }) => ({
  feeds: many(sourceFeeds),
  entityIdentifiers: many(entityIdentifiers),
}));

export const sourceFeedsRelations = relations(sourceFeeds, ({ one, many }) => ({
  sourceSystem: one(sourceSystems, {
    fields: [sourceFeeds.sourceSystemId],
    references: [sourceSystems.id],
  }),
  state: one(sourceFeedStates, {
    fields: [sourceFeeds.id],
    references: [sourceFeedStates.sourceFeedId],
  }),
  records: many(sourceRecords),
}));

export const sourceFeedStatesRelations = relations(sourceFeedStates, ({ one }) => ({
  feed: one(sourceFeeds, {
    fields: [sourceFeedStates.sourceFeedId],
    references: [sourceFeeds.id],
  }),
}));

export const sourceRecordsRelations = relations(sourceRecords, ({ one, many }) => ({
  feed: one(sourceFeeds, {
    fields: [sourceRecords.sourceFeedId],
    references: [sourceFeeds.id],
  }),
  taxonomyTerms: many(sourceRecordTaxonomy),
}));

export const sourceRecordTaxonomyRelations = relations(sourceRecordTaxonomy, ({ one }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [sourceRecordTaxonomy.sourceRecordId],
    references: [sourceRecords.id],
  }),
}));

export const entityIdentifiersRelations = relations(entityIdentifiers, ({ one }) => ({
  sourceSystem: one(sourceSystems, {
    fields: [entityIdentifiers.sourceSystemId],
    references: [sourceSystems.id],
  }),
}));

// ============================================================
// CANONICAL FEDERATION LAYER (Phase 2 – migration 0033)
// ============================================================

// --- Canonical Organizations ---
export const canonicalOrganizations = pgTable('canonical_organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  alternateName: text('alternate_name'),
  description: text('description'),
  url: text('url'),
  email: text('email'),
  phone: text('phone'),
  taxStatus: text('tax_status'),
  taxId: text('tax_id'),
  yearIncorporated: integer('year_incorporated'),
  legalStatus: text('legal_status'),
  lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
  publicationStatus: text('publication_status').notNull().default('unpublished'),
  winningSourceSystemId: uuid('winning_source_system_id').references(() => sourceSystems.id, { onDelete: 'set null' }),
  sourceCount: integer('source_count').notNull().default(1),
  sourceConfidenceSummary: jsonb('source_confidence_summary').notNull().default({}),
  publishedOrganizationId: uuid('published_organization_id'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CanonicalOrganizationRow = typeof canonicalOrganizations.$inferSelect;
export type NewCanonicalOrganizationRow = typeof canonicalOrganizations.$inferInsert;

// --- Canonical Services ---
export const canonicalServices = pgTable('canonical_services', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalOrganizationId: uuid('canonical_organization_id').notNull().references(() => canonicalOrganizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  alternateName: text('alternate_name'),
  description: text('description'),
  url: text('url'),
  email: text('email'),
  status: text('status').notNull().default('active'),
  interpretationServices: text('interpretation_services'),
  applicationProcess: text('application_process'),
  waitTime: text('wait_time'),
  fees: text('fees'),
  accreditations: text('accreditations'),
  licenses: text('licenses'),
  lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
  publicationStatus: text('publication_status').notNull().default('unpublished'),
  winningSourceSystemId: uuid('winning_source_system_id').references(() => sourceSystems.id, { onDelete: 'set null' }),
  sourceCount: integer('source_count').notNull().default(1),
  sourceConfidenceSummary: jsonb('source_confidence_summary').notNull().default({}),
  publishedServiceId: uuid('published_service_id'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CanonicalServiceRow = typeof canonicalServices.$inferSelect;
export type NewCanonicalServiceRow = typeof canonicalServices.$inferInsert;

// --- Canonical Locations ---
export const canonicalLocations = pgTable('canonical_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalOrganizationId: uuid('canonical_organization_id').notNull().references(() => canonicalOrganizations.id, { onDelete: 'cascade' }),
  name: text('name'),
  alternateName: text('alternate_name'),
  description: text('description'),
  transportation: text('transportation'),
  latitude: doublePrecision('latitude'),
  longitude: doublePrecision('longitude'),
  geom: geometryPoint('geom'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  addressCity: text('address_city'),
  addressRegion: text('address_region'),
  addressPostalCode: text('address_postal_code'),
  addressCountry: text('address_country').default('US'),
  lifecycleStatus: text('lifecycle_status').notNull().default('draft'),
  publicationStatus: text('publication_status').notNull().default('unpublished'),
  winningSourceSystemId: uuid('winning_source_system_id').references(() => sourceSystems.id, { onDelete: 'set null' }),
  sourceCount: integer('source_count').notNull().default(1),
  sourceConfidenceSummary: jsonb('source_confidence_summary').notNull().default({}),
  publishedLocationId: uuid('published_location_id'),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CanonicalLocationRow = typeof canonicalLocations.$inferSelect;
export type NewCanonicalLocationRow = typeof canonicalLocations.$inferInsert;

// --- Canonical Service Locations (Junction) ---
export const canonicalServiceLocations = pgTable('canonical_service_locations', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalServiceId: uuid('canonical_service_id').notNull().references(() => canonicalServices.id, { onDelete: 'cascade' }),
  canonicalLocationId: uuid('canonical_location_id').notNull().references(() => canonicalLocations.id, { onDelete: 'cascade' }),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pairIndex: uniqueIndex('idx_canonical_service_locations_pair').on(table.canonicalServiceId, table.canonicalLocationId),
}));

export type CanonicalServiceLocationRow = typeof canonicalServiceLocations.$inferSelect;
export type NewCanonicalServiceLocationRow = typeof canonicalServiceLocations.$inferInsert;

// --- Canonical Provenance (Field-level Lineage) ---
export const canonicalProvenance = pgTable('canonical_provenance', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalEntityType: text('canonical_entity_type').notNull(),
  canonicalEntityId: uuid('canonical_entity_id').notNull(),
  fieldName: text('field_name').notNull(),
  assertedValue: jsonb('asserted_value'),
  sourceRecordId: uuid('source_record_id').references(() => sourceRecords.id, { onDelete: 'set null' }),
  evidenceId: text('evidence_id'),
  selectorOrHint: text('selector_or_hint'),
  confidenceHint: integer('confidence_hint').default(0),
  decisionStatus: text('decision_status').notNull().default('candidate'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: text('decided_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  entityIndex: index('idx_canonical_provenance_entity').on(table.canonicalEntityType, table.canonicalEntityId),
  decisionIndex: index('idx_canonical_provenance_decision').on(table.canonicalEntityType, table.canonicalEntityId, table.decisionStatus),
}));

export type CanonicalProvenanceRow = typeof canonicalProvenance.$inferSelect;
export type NewCanonicalProvenanceRow = typeof canonicalProvenance.$inferInsert;

// --- Canonical Federation Relations ---
export const canonicalOrganizationsRelations = relations(canonicalOrganizations, ({ one, many }) => ({
  winningSourceSystem: one(sourceSystems, {
    fields: [canonicalOrganizations.winningSourceSystemId],
    references: [sourceSystems.id],
  }),
  services: many(canonicalServices),
  locations: many(canonicalLocations),
}));

export const canonicalServicesRelations = relations(canonicalServices, ({ one, many }) => ({
  organization: one(canonicalOrganizations, {
    fields: [canonicalServices.canonicalOrganizationId],
    references: [canonicalOrganizations.id],
  }),
  winningSourceSystem: one(sourceSystems, {
    fields: [canonicalServices.winningSourceSystemId],
    references: [sourceSystems.id],
  }),
  serviceLocations: many(canonicalServiceLocations),
}));

export const canonicalLocationsRelations = relations(canonicalLocations, ({ one, many }) => ({
  organization: one(canonicalOrganizations, {
    fields: [canonicalLocations.canonicalOrganizationId],
    references: [canonicalOrganizations.id],
  }),
  winningSourceSystem: one(sourceSystems, {
    fields: [canonicalLocations.winningSourceSystemId],
    references: [sourceSystems.id],
  }),
  serviceLocations: many(canonicalServiceLocations),
}));

export const canonicalServiceLocationsRelations = relations(canonicalServiceLocations, ({ one }) => ({
  service: one(canonicalServices, {
    fields: [canonicalServiceLocations.canonicalServiceId],
    references: [canonicalServices.id],
  }),
  location: one(canonicalLocations, {
    fields: [canonicalServiceLocations.canonicalLocationId],
    references: [canonicalLocations.id],
  }),
}));

export const canonicalProvenanceRelations = relations(canonicalProvenance, ({ one }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [canonicalProvenance.sourceRecordId],
    references: [sourceRecords.id],
  }),
}));

// ============================================================
// TAXONOMY FEDERATION LAYER  (migration 0037)
// ============================================================
// Multi-taxonomy awareness, cross-walk logic, and automated tag
// derivation from external taxonomy codes.
// ============================================================

/** External taxonomy registries (AIRS/211, Open Eligibility, etc.) */
export const taxonomyRegistries = pgTable(
  'taxonomy_registries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    uri: text('uri'),
    version: text('version'),
    description: text('description'),
    isDefault: boolean('is_default').notNull().default(false),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type TaxonomyRegistryRow = typeof taxonomyRegistries.$inferSelect;
export type NewTaxonomyRegistryRow = typeof taxonomyRegistries.$inferInsert;

/** Extended taxonomy terms with hierarchy (external vocabularies). */
export const taxonomyTermsExt = pgTable(
  'taxonomy_terms_ext',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    registryId: uuid('registry_id').notNull().references(() => taxonomyRegistries.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    term: text('term').notNull(),
    parentCode: text('parent_code'),
    description: text('description'),
    uri: text('uri'),
    depth: integer('depth').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type TaxonomyTermExtRow = typeof taxonomyTermsExt.$inferSelect;
export type NewTaxonomyTermExtRow = typeof taxonomyTermsExt.$inferInsert;

/** ORAN canonical concepts — abstract service concepts mapped to ORAN tags. */
export const canonicalConcepts = pgTable(
  'canonical_concepts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conceptKey: text('concept_key').notNull().unique(),
    label: text('label').notNull(),
    description: text('description'),
    oranTaxonomyTermId: uuid('oran_taxonomy_term_id').references(() => taxonomyTerms.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type CanonicalConceptRow = typeof canonicalConcepts.$inferSelect;
export type NewCanonicalConceptRow = typeof canonicalConcepts.$inferInsert;

/** Cross-walks mapping external taxonomy codes to canonical concepts. */
export const taxonomyCrosswalks = pgTable(
  'taxonomy_crosswalks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRegistryId: uuid('source_registry_id').notNull().references(() => taxonomyRegistries.id, { onDelete: 'cascade' }),
    sourceCode: text('source_code').notNull(),
    targetConceptId: uuid('target_concept_id').notNull().references(() => canonicalConcepts.id, { onDelete: 'cascade' }),
    matchType: text('match_type').notNull().default('exact'),
    confidence: integer('confidence').notNull().default(100),
    notes: text('notes'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type TaxonomyCrosswalkRow = typeof taxonomyCrosswalks.$inferSelect;
export type NewTaxonomyCrosswalkRow = typeof taxonomyCrosswalks.$inferInsert;

/** Audit log: how a resource tag was derived from an external taxonomy code. */
export const conceptTagDerivations = pgTable(
  'concept_tag_derivations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRecordId: uuid('source_record_id').references(() => sourceRecords.id, { onDelete: 'set null' }),
    sourceRegistryId: uuid('source_registry_id').notNull().references(() => taxonomyRegistries.id, { onDelete: 'cascade' }),
    sourceCode: text('source_code').notNull(),
    crosswalkId: uuid('crosswalk_id').references(() => taxonomyCrosswalks.id, { onDelete: 'set null' }),
    conceptId: uuid('concept_id').notNull().references(() => canonicalConcepts.id, { onDelete: 'cascade' }),
    derivedTagType: text('derived_tag_type').notNull().default('category'),
    derivedTagValue: text('derived_tag_value').notNull(),
    confidence: integer('confidence').notNull().default(100),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type ConceptTagDerivationRow = typeof conceptTagDerivations.$inferSelect;
export type NewConceptTagDerivationRow = typeof conceptTagDerivations.$inferInsert;

// ---- Taxonomy Federation Relations ----

export const taxonomyRegistriesRelations = relations(taxonomyRegistries, ({ many }) => ({
  terms: many(taxonomyTermsExt),
  crosswalks: many(taxonomyCrosswalks),
  derivations: many(conceptTagDerivations),
}));

export const taxonomyTermsExtRelations = relations(taxonomyTermsExt, ({ one }) => ({
  registry: one(taxonomyRegistries, {
    fields: [taxonomyTermsExt.registryId],
    references: [taxonomyRegistries.id],
  }),
}));

export const canonicalConceptsRelations = relations(canonicalConcepts, ({ one, many }) => ({
  oranTaxonomyTerm: one(taxonomyTerms, {
    fields: [canonicalConcepts.oranTaxonomyTermId],
    references: [taxonomyTerms.id],
  }),
  crosswalks: many(taxonomyCrosswalks),
  derivations: many(conceptTagDerivations),
}));

export const taxonomyCrosswalksRelations = relations(taxonomyCrosswalks, ({ one }) => ({
  sourceRegistry: one(taxonomyRegistries, {
    fields: [taxonomyCrosswalks.sourceRegistryId],
    references: [taxonomyRegistries.id],
  }),
  targetConcept: one(canonicalConcepts, {
    fields: [taxonomyCrosswalks.targetConceptId],
    references: [canonicalConcepts.id],
  }),
}));

export const conceptTagDerivationsRelations = relations(conceptTagDerivations, ({ one }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [conceptTagDerivations.sourceRecordId],
    references: [sourceRecords.id],
  }),
  sourceRegistry: one(taxonomyRegistries, {
    fields: [conceptTagDerivations.sourceRegistryId],
    references: [taxonomyRegistries.id],
  }),
  crosswalk: one(taxonomyCrosswalks, {
    fields: [conceptTagDerivations.crosswalkId],
    references: [taxonomyCrosswalks.id],
  }),
  concept: one(canonicalConcepts, {
    fields: [conceptTagDerivations.conceptId],
    references: [canonicalConcepts.id],
  }),
}));

// ============================================================
// RESOLUTION & CLUSTERING LAYER  (migration 0038)
// ============================================================
// Entity resolution decisions, candidate tracking, and cluster
// management for deduplication across source systems.
// ============================================================

/** Entity clusters — groups of canonical entities believed to be the same real-world entity. */
export const entityClusters = pgTable(
  'entity_clusters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    entityType: text('entity_type').notNull(),
    canonicalEntityId: uuid('canonical_entity_id').notNull(),
    label: text('label'),
    status: text('status').notNull().default('active'),
    confidence: integer('confidence').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type EntityClusterRow = typeof entityClusters.$inferSelect;
export type NewEntityClusterRow = typeof entityClusters.$inferInsert;

/** Entity cluster members — individual canonical entities within a cluster. */
export const entityClusterMembers = pgTable(
  'entity_cluster_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clusterId: uuid('cluster_id').notNull().references(() => entityClusters.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    role: text('role').notNull().default('member'),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pairIndex: uniqueIndex('idx_entity_cluster_members_pair').on(table.clusterId, table.entityId),
    entityIndex: index('idx_entity_cluster_members_entity').on(table.entityType, table.entityId),
  }),
);

export type EntityClusterMemberRow = typeof entityClusterMembers.$inferSelect;
export type NewEntityClusterMemberRow = typeof entityClusterMembers.$inferInsert;

/** Resolution candidates — proposed matches between a source record and an existing canonical entity. */
export const resolutionCandidates = pgTable(
  'resolution_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceRecordId: uuid('source_record_id').references(() => sourceRecords.id, { onDelete: 'set null' }),
    candidateEntityType: text('candidate_entity_type').notNull(),
    candidateEntityId: uuid('candidate_entity_id').notNull(),
    matchStrategy: text('match_strategy').notNull(),
    matchKey: text('match_key'),
    confidence: integer('confidence').notNull().default(0),
    autoResolved: boolean('auto_resolved').notNull().default(false),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
  },
);

export type ResolutionCandidateRow = typeof resolutionCandidates.$inferSelect;
export type NewResolutionCandidateRow = typeof resolutionCandidates.$inferInsert;

/** Resolution decisions — audit log of all resolution actions taken. */
export const resolutionDecisions = pgTable(
  'resolution_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resolutionCandidateId: uuid('resolution_candidate_id').references(() => resolutionCandidates.id, { onDelete: 'set null' }),
    sourceRecordId: uuid('source_record_id').references(() => sourceRecords.id, { onDelete: 'set null' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    decision: text('decision').notNull(),
    matchStrategy: text('match_strategy'),
    matchConfidence: integer('match_confidence').notNull().default(0),
    rationale: text('rationale'),
    decidedBy: text('decided_by').notNull().default('system'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

export type ResolutionDecisionRow = typeof resolutionDecisions.$inferSelect;
export type NewResolutionDecisionRow = typeof resolutionDecisions.$inferInsert;

// ---- Resolution & Clustering Relations ----

export const entityClustersRelations = relations(entityClusters, ({ many }) => ({
  members: many(entityClusterMembers),
}));

export const entityClusterMembersRelations = relations(entityClusterMembers, ({ one }) => ({
  cluster: one(entityClusters, {
    fields: [entityClusterMembers.clusterId],
    references: [entityClusters.id],
  }),
}));

export const resolutionCandidatesRelations = relations(resolutionCandidates, ({ one, many }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [resolutionCandidates.sourceRecordId],
    references: [sourceRecords.id],
  }),
  decisions: many(resolutionDecisions),
}));

export const resolutionDecisionsRelations = relations(resolutionDecisions, ({ one }) => ({
  candidate: one(resolutionCandidates, {
    fields: [resolutionDecisions.resolutionCandidateId],
    references: [resolutionCandidates.id],
  }),
  sourceRecord: one(sourceRecords, {
    fields: [resolutionDecisions.sourceRecordId],
    references: [sourceRecords.id],
  }),
}));

// ============================================================
// ZONE C: LIVE / SEEKER-VISIBLE TABLES
// ============================================================
// HSDS-core and ORAN-extension tables powering seeker-facing
// search, chat, and detail views.
// SQL migrations: 0000, 0003, 0004, 0005, 0006, 0009–0013.
// ============================================================

// ---- HSDS Core (migration 0000) ----

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    url: text('url'),
    email: text('email'),
    taxStatus: text('tax_status'),
    taxId: text('tax_id'),
    yearIncorporated: integer('year_incorporated'),
    legalStatus: text('legal_status'),
    logoUrl: text('logo_url'),
    uri: text('uri'),
    status: text('status').notNull().default('active'),
    phone: text('phone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
);

export type OrganizationRow = typeof organizations.$inferSelect;
export type NewOrganizationRow = typeof organizations.$inferInsert;

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name'),
    alternateName: text('alternate_name'),
    description: text('description'),
    transportation: text('transportation'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    geom: geometryPoint('geom'),
    status: text('status').notNull().default('active'),
    transitAccess: text('transit_access').array(),
    parkingAvailable: text('parking_available').default('unknown'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_locations_organization').on(table.organizationId),
  ]
);

export type LocationRow = typeof locations.$inferSelect;
export type NewLocationRow = typeof locations.$inferInsert;

export const programs = pgTable(
  'programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    alternateName: text('alternate_name'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_programs_organization').on(table.organizationId),
  ]
);

export type ProgramRow = typeof programs.$inferSelect;
export type NewProgramRow = typeof programs.$inferInsert;

export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    programId: uuid('program_id'),
    name: text('name').notNull(),
    alternateName: text('alternate_name'),
    description: text('description'),
    url: text('url'),
    email: text('email'),
    status: text('status').notNull().default('active'),
    interpretationServices: text('interpretation_services'),
    applicationProcess: text('application_process'),
    waitTime: text('wait_time'),
    fees: text('fees'),
    accreditations: text('accreditations'),
    licenses: text('licenses'),
    estimatedWaitDays: integer('estimated_wait_days'),
    capacityStatus: text('capacity_status').default('available'),
    integrityHoldAt: timestamp('integrity_hold_at', { withTimezone: true }),
    integrityHoldReason: text('integrity_hold_reason'),
    integrityHeldByUserId: text('integrity_held_by_user_id'),
    embedding: vector1024('embedding'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_services_organization').on(table.organizationId),
    index('idx_services_status').on(table.status),
    index('idx_services_capacity_status').on(table.capacityStatus),
    index('idx_services_integrity_hold_at').on(table.integrityHoldAt),
  ]
);

export type ServiceRow = typeof services.$inferSelect;
export type NewServiceRow = typeof services.$inferInsert;

export const serviceAtLocation = pgTable(
  'service_at_location',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    uniqueIndex('idx_sal_unique').on(table.serviceId, table.locationId),
    index('idx_sal_service').on(table.serviceId),
    index('idx_sal_location').on(table.locationId),
  ]
);

export type ServiceAtLocationRow = typeof serviceAtLocation.$inferSelect;
export type NewServiceAtLocationRow = typeof serviceAtLocation.$inferInsert;

export const phones = pgTable(
  'phones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    extension: text('extension'),
    type: text('type').default('voice'),
    language: text('language'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_phones_service').on(table.serviceId),
    index('idx_phones_location').on(table.locationId),
    index('idx_phones_organization').on(table.organizationId),
  ]
);

export type PhoneRow = typeof phones.$inferSelect;
export type NewPhoneRow = typeof phones.$inferInsert;

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
    attention: text('attention'),
    address1: text('address_1'),
    address2: text('address_2'),
    city: text('city'),
    region: text('region'),
    stateProvince: text('state_province'),
    postalCode: text('postal_code'),
    country: text('country').default('US'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_addresses_location').on(table.locationId),
    index('idx_addresses_city').on(table.city),
    index('idx_addresses_postal').on(table.postalCode),
  ]
);

export type AddressRow = typeof addresses.$inferSelect;
export type NewAddressRow = typeof addresses.$inferInsert;

export const schedules = pgTable(
  'schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'cascade' }),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    dtstart: text('dtstart'),
    until: text('until'),
    wkst: text('wkst'),
    days: text('days').array(),
    opensAt: time('opens_at'),
    closesAt: time('closes_at'),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_schedules_service').on(table.serviceId),
    index('idx_schedules_location').on(table.locationId),
  ]
);

export type ScheduleRow = typeof schedules.$inferSelect;
export type NewScheduleRow = typeof schedules.$inferInsert;

export const taxonomyTerms = pgTable(
  'taxonomy_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    term: text('term').notNull(),
    description: text('description'),
    parentId: uuid('parent_id'),
    taxonomy: text('taxonomy').default('custom'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_taxonomy_parent').on(table.parentId),
  ]
);

export type TaxonomyTermRow = typeof taxonomyTerms.$inferSelect;
export type NewTaxonomyTermRow = typeof taxonomyTerms.$inferInsert;

export const serviceTaxonomy = pgTable(
  'service_taxonomy',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    taxonomyTermId: uuid('taxonomy_term_id').notNull().references(() => taxonomyTerms.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    uniqueIndex('idx_service_taxonomy_unique').on(table.serviceId, table.taxonomyTermId),
    index('idx_service_taxonomy_service').on(table.serviceId),
    index('idx_service_taxonomy_term').on(table.taxonomyTermId),
  ]
);

export type ServiceTaxonomyRow = typeof serviceTaxonomy.$inferSelect;
export type NewServiceTaxonomyRow = typeof serviceTaxonomy.$inferInsert;

export const confidenceScores = pgTable(
  'confidence_scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    score: numeric('score', { precision: 5, scale: 2 }).notNull().default('0'),
    verificationConfidence: numeric('verification_confidence', { precision: 5, scale: 2 }).notNull().default('0'),
    eligibilityMatch: numeric('eligibility_match', { precision: 5, scale: 2 }).notNull().default('0'),
    constraintFit: numeric('constraint_fit', { precision: 5, scale: 2 }).notNull().default('0'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_confidence_service_unique').on(table.serviceId),
    index('idx_confidence_score').on(table.score),
  ]
);

export type ConfidenceScoreRow = typeof confidenceScores.$inferSelect;
export type NewConfidenceScoreRow = typeof confidenceScores.$inferInsert;

export const verificationQueue = pgTable(
  'verification_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    submittedByUserId: text('submitted_by_user_id').notNull(),
    assignedToUserId: text('assigned_to_user_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_vq_service').on(table.serviceId),
    index('idx_vq_status').on(table.status),
    index('idx_vq_assigned').on(table.assignedToUserId),
  ]
);

export type VerificationQueueRow = typeof verificationQueue.$inferSelect;
export type NewVerificationQueueRow = typeof verificationQueue.$inferInsert;

export const seekerFeedback = pgTable(
  'seeker_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').notNull(),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    contactSuccess: boolean('contact_success'),
    triageCategory: text('triage_category'),
    triageResult: jsonb('triage_result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_feedback_service').on(table.serviceId),
    index('idx_feedback_session').on(table.sessionId),
  ]
);

export type SeekerFeedbackRow = typeof seekerFeedback.$inferSelect;
export type NewSeekerFeedbackRow = typeof seekerFeedback.$inferInsert;

export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    intentSummary: text('intent_summary'),
    serviceIdsShown: uuid('service_ids_shown').array(),
    messageCount: integer('message_count').notNull().default(0),
  },
  (table) => [
    index('idx_chat_sessions_user').on(table.userId),
  ]
);

export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type NewChatSessionRow = typeof chatSessions.$inferInsert;

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    enabled: boolean('enabled').notNull().default(false),
    rolloutPct: integer('rollout_pct').notNull().default(0),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
);

export type FeatureFlagRow = typeof featureFlags.$inferSelect;
export type NewFeatureFlagRow = typeof featureFlags.$inferInsert;

// ---- HSDS Extended (migrations 0009–0013) ----

export const eligibility = pgTable(
  'eligibility',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    minimumAge: integer('minimum_age'),
    maximumAge: integer('maximum_age'),
    eligibleValues: text('eligible_values').array(),
    householdSizeMin: integer('household_size_min'),
    householdSizeMax: integer('household_size_max'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_eligibility_service').on(table.serviceId),
  ]
);

export type EligibilityRow = typeof eligibility.$inferSelect;
export type NewEligibilityRow = typeof eligibility.$inferInsert;

export const requiredDocuments = pgTable(
  'required_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    document: text('document').notNull(),
    type: text('type'),
    uri: text('uri'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_required_documents_service').on(table.serviceId),
  ]
);

export type RequiredDocumentRow = typeof requiredDocuments.$inferSelect;
export type NewRequiredDocumentRow = typeof requiredDocuments.$inferInsert;

export const serviceAreas = pgTable(
  'service_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    name: text('name'),
    description: text('description'),
    extent: geometryPolygon('extent'),
    extentType: text('extent_type').default('other'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_service_areas_service').on(table.serviceId),
    index('idx_service_areas_type').on(table.extentType),
  ]
);

export type ServiceAreaRow = typeof serviceAreas.$inferSelect;
export type NewServiceAreaRow = typeof serviceAreas.$inferInsert;

export const languagesTable = pgTable(
  'languages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'cascade' }),
    language: text('language').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_languages_service').on(table.serviceId),
    index('idx_languages_location').on(table.locationId),
    index('idx_languages_language').on(table.language),
  ]
);

export type LanguageRow = typeof languagesTable.$inferSelect;
export type NewLanguageRow = typeof languagesTable.$inferInsert;

export const accessibilityForDisabilities = pgTable(
  'accessibility_for_disabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    locationId: uuid('location_id').notNull().references(() => locations.id, { onDelete: 'cascade' }),
    accessibility: text('accessibility').notNull(),
    details: text('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_accessibility_location').on(table.locationId),
    index('idx_accessibility_feature').on(table.accessibility),
  ]
);

export type AccessibilityForDisabilitiesRow = typeof accessibilityForDisabilities.$inferSelect;
export type NewAccessibilityForDisabilitiesRow = typeof accessibilityForDisabilities.$inferInsert;

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'cascade' }),
    name: text('name'),
    title: text('title'),
    department: text('department'),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_contacts_organization').on(table.organizationId),
    index('idx_contacts_service').on(table.serviceId),
    index('idx_contacts_location').on(table.locationId),
  ]
);

export type ContactRow = typeof contacts.$inferSelect;
export type NewContactRow = typeof contacts.$inferInsert;

export const savedServices = pgTable(
  'saved_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    notes: text('notes'),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_saved_services_unique').on(table.userId, table.serviceId),
    index('idx_saved_services_user').on(table.userId),
    index('idx_saved_services_service').on(table.serviceId),
  ]
);

export type SavedServiceRow = typeof savedServices.$inferSelect;
export type NewSavedServiceRow = typeof savedServices.$inferInsert;

export const savedCollections = pgTable(
  'saved_collections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_saved_collections_user_name').on(table.userId, table.name),
    index('idx_saved_collections_user').on(table.userId),
  ]
);

export type SavedCollectionRow = typeof savedCollections.$inferSelect;
export type NewSavedCollectionRow = typeof savedCollections.$inferInsert;

export const savedCollectionServices = pgTable(
  'saved_collection_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectionId: uuid('collection_id').notNull().references(() => savedCollections.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('idx_saved_collection_services_unique').on(table.collectionId, table.serviceId),
    index('idx_saved_collection_services_collection').on(table.collectionId),
    index('idx_saved_collection_services_service').on(table.serviceId),
  ]
);

export type SavedCollectionServiceRow = typeof savedCollectionServices.$inferSelect;
export type NewSavedCollectionServiceRow = typeof savedCollectionServices.$inferInsert;

export const verificationEvidence = pgTable(
  'verification_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queueEntryId: uuid('queue_entry_id').notNull().references(() => verificationQueue.id, { onDelete: 'cascade' }),
    evidenceType: text('evidence_type').notNull(),
    description: text('description'),
    fileUrl: text('file_url'),
    fileName: text('file_name'),
    fileSizeBytes: integer('file_size_bytes'),
    submittedByUserId: text('submitted_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_evidence_queue_entry').on(table.queueEntryId),
    index('idx_evidence_type').on(table.evidenceType),
  ]
);

export type VerificationEvidenceRow = typeof verificationEvidence.$inferSelect;
export type NewVerificationEvidenceRow = typeof verificationEvidence.$inferInsert;

export const serviceAttributes = pgTable(
  'service_attributes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    taxonomy: text('taxonomy').notNull(),
    tag: text('tag').notNull(),
    details: text('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    uniqueIndex('idx_service_attributes_unique').on(table.serviceId, table.taxonomy, table.tag),
    index('idx_service_attributes_taxonomy_tag').on(table.taxonomy, table.tag),
    index('idx_service_attributes_service').on(table.serviceId),
    index('idx_service_attributes_tag').on(table.tag),
  ]
);

export type ServiceAttributeRow = typeof serviceAttributes.$inferSelect;
export type NewServiceAttributeRow = typeof serviceAttributes.$inferInsert;

export const serviceAdaptations = pgTable(
  'service_adaptations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    adaptationType: text('adaptation_type').notNull(),
    adaptationTag: text('adaptation_tag').notNull(),
    details: text('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    uniqueIndex('idx_service_adaptations_unique').on(table.serviceId, table.adaptationType, table.adaptationTag),
    index('idx_service_adaptations_service').on(table.serviceId),
    index('idx_service_adaptations_type_tag').on(table.adaptationType, table.adaptationTag),
    index('idx_service_adaptations_tag').on(table.adaptationTag),
  ]
);

export type ServiceAdaptationRow = typeof serviceAdaptations.$inferSelect;
export type NewServiceAdaptationRow = typeof serviceAdaptations.$inferInsert;

export const dietaryOptions = pgTable(
  'dietary_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    serviceId: uuid('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
    dietaryType: text('dietary_type').notNull(),
    availability: text('availability').default('always'),
    details: text('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    uniqueIndex('idx_dietary_options_unique').on(table.serviceId, table.dietaryType),
    index('idx_dietary_options_service').on(table.serviceId),
    index('idx_dietary_options_type').on(table.dietaryType),
  ]
);

export type DietaryOptionRow = typeof dietaryOptions.$inferSelect;
export type NewDietaryOptionRow = typeof dietaryOptions.$inferInsert;

// ---- Import / Staging (migration 0003) ----

export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchKey: text('batch_key').notNull().unique(),
    importedByUserId: text('imported_by_user_id'),
    source: text('source').notNull().default('csv'),
    status: text('status').notNull().default('validated'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_import_batches_status').on(table.status),
  ]
);

export type ImportBatchRow = typeof importBatches.$inferSelect;
export type NewImportBatchRow = typeof importBatches.$inferInsert;

export const stagingOrganizations = pgTable(
  'staging_organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
    organizationId: uuid('organization_id'),
    importStatus: text('import_status').notNull().default('pending'),
    importDiff: jsonb('import_diff'),
    name: text('name').notNull(),
    description: text('description'),
    url: text('url'),
    email: text('email'),
    taxStatus: text('tax_status'),
    taxId: text('tax_id'),
    yearIncorporated: integer('year_incorporated'),
    legalStatus: text('legal_status'),
    logoUrl: text('logo_url'),
    uri: text('uri'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_stg_org_batch').on(table.importBatchId),
  ]
);

export type StagingOrganizationRow = typeof stagingOrganizations.$inferSelect;
export type NewStagingOrganizationRow = typeof stagingOrganizations.$inferInsert;

export const stagingLocations = pgTable(
  'staging_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
    locationId: uuid('location_id'),
    organizationId: uuid('organization_id'),
    importStatus: text('import_status').notNull().default('pending'),
    importDiff: jsonb('import_diff'),
    name: text('name'),
    alternateName: text('alternate_name'),
    description: text('description'),
    transportation: text('transportation'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_stg_loc_batch').on(table.importBatchId),
  ]
);

export type StagingLocationRow = typeof stagingLocations.$inferSelect;
export type NewStagingLocationRow = typeof stagingLocations.$inferInsert;

export const stagingServices = pgTable(
  'staging_services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    importBatchId: uuid('import_batch_id').notNull().references(() => importBatches.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id'),
    organizationId: uuid('organization_id'),
    programId: uuid('program_id'),
    importStatus: text('import_status').notNull().default('pending'),
    importDiff: jsonb('import_diff'),
    name: text('name').notNull(),
    alternateName: text('alternate_name'),
    description: text('description'),
    url: text('url'),
    email: text('email'),
    status: text('status').notNull().default('active'),
    interpretationServices: text('interpretation_services'),
    applicationProcess: text('application_process'),
    waitTime: text('wait_time'),
    fees: text('fees'),
    accreditations: text('accreditations'),
    licenses: text('licenses'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_stg_svc_batch').on(table.importBatchId),
  ]
);

export type StagingServiceRow = typeof stagingServices.$inferSelect;
export type NewStagingServiceRow = typeof stagingServices.$inferInsert;

// ---- Governance / Extension (migrations 0004–0006) ----

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    requestId: text('request_id'),
    ipDigest: text('ip_digest'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_audit_logs_actor').on(table.actorUserId),
    index('idx_audit_logs_action').on(table.action),
    index('idx_audit_logs_resource').on(table.resourceType, table.resourceId),
    index('idx_audit_logs_created').on(table.createdAt),
  ]
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;

export const coverageZones = pgTable(
  'coverage_zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    geometry: geometryPolygon('geometry'),
    assignedUserId: text('assigned_user_id'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_coverage_zones_status').on(table.status),
    index('idx_coverage_zones_assigned').on(table.assignedUserId),
  ]
);

export type CoverageZoneRow = typeof coverageZones.$inferSelect;
export type NewCoverageZoneRow = typeof coverageZones.$inferInsert;

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    role: text('role').notNull().default('host_member'),
    status: text('status').notNull().default('invited'),
    invitedByUserId: text('invited_by_user_id'),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    uniqueIndex('idx_org_members_unique').on(table.organizationId, table.userId),
    index('idx_org_members_organization').on(table.organizationId),
    index('idx_org_members_user').on(table.userId),
  ]
);

export type OrganizationMemberRow = typeof organizationMembers.$inferSelect;
export type NewOrganizationMemberRow = typeof organizationMembers.$inferInsert;

export const userProfiles = pgTable(
  'user_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().unique(),
    displayName: text('display_name'),
    username: text('username'),
    preferredLocale: text('preferred_locale').default('en'),
    approximateCity: text('approximate_city'),
    role: text('role').notNull().default('seeker'),
    email: text('email'),
    passwordHash: text('password_hash'),
    phone: text('phone'),
    authProvider: text('auth_provider').notNull().default('azure-ad'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
  },
  (table) => [
    index('idx_user_profiles_role').on(table.role),
    index('idx_user_profiles_username').on(table.username),
  ]
);

export type UserProfileRow = typeof userProfiles.$inferSelect;
export type NewUserProfileRow = typeof userProfiles.$inferInsert;

export const formTemplates = pgTable(
  'form_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category').notNull().default('general'),
    audienceScope: text('audience_scope').notNull(),
    storageScope: text('storage_scope').notNull().default('platform'),
    defaultTargetRole: text('default_target_role'),
    schemaJson: jsonb('schema_json').notNull().default({}),
    uiSchemaJson: jsonb('ui_schema_json').notNull().default({}),
    instructionsMarkdown: text('instructions_markdown'),
    version: integer('version').notNull().default(1),
    isPublished: boolean('is_published').notNull().default(false),
    blobStoragePrefix: text('blob_storage_prefix'),
    createdByUserId: text('created_by_user_id'),
    updatedByUserId: text('updated_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_form_templates_audience').on(table.audienceScope),
    index('idx_form_templates_storage_scope').on(table.storageScope),
    index('idx_form_templates_published').on(table.isPublished),
  ]
);

export type FormTemplateRow = typeof formTemplates.$inferSelect;
export type NewFormTemplateRow = typeof formTemplates.$inferInsert;

export const formInstances = pgTable(
  'form_instances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submissionId: uuid('submission_id').notNull().unique().references(() => submissions.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').notNull().references(() => formTemplates.id, { onDelete: 'restrict' }),
    templateVersion: integer('template_version').notNull(),
    storageScope: text('storage_scope').notNull(),
    ownerOrganizationId: uuid('owner_organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    coverageZoneId: uuid('coverage_zone_id').references(() => coverageZones.id, { onDelete: 'set null' }),
    recipientRole: text('recipient_role'),
    recipientUserId: text('recipient_user_id'),
    recipientOrganizationId: uuid('recipient_organization_id').references(() => organizations.id, { onDelete: 'set null' }),
    blobStoragePrefix: text('blob_storage_prefix'),
    formData: jsonb('form_data').notNull().default({}),
    attachmentManifest: jsonb('attachment_manifest').notNull().default([]),
    lastSavedAt: timestamp('last_saved_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_form_instances_template').on(table.templateId),
    index('idx_form_instances_owner_org').on(table.ownerOrganizationId),
    index('idx_form_instances_recipient_role').on(table.recipientRole),
    index('idx_form_instances_recipient_org').on(table.recipientOrganizationId),
    index('idx_form_instances_coverage_zone').on(table.coverageZoneId),
    index('idx_form_instances_last_saved').on(table.lastSavedAt),
  ]
);

export type FormInstanceRow = typeof formInstances.$inferSelect;
export type NewFormInstanceRow = typeof formInstances.$inferInsert;

// ============================================================
// RELATIONS (Zone C Live Tables)
// ============================================================

export const organizationsRelations = relations(organizations, ({ many }) => ({
  locations: many(locations),
  services: many(services),
  phones: many(phones),
  contacts: many(contacts),
  programs: many(programs),
  organizationMembers: many(organizationMembers),
  ownedFormInstances: many(formInstances),
  recipientFormInstances: many(formInstances),
}));

export const formTemplatesRelations = relations(formTemplates, ({ many }) => ({
  instances: many(formInstances),
}));

export const formInstancesRelations = relations(formInstances, ({ one }) => ({
  template: one(formTemplates, {
    fields: [formInstances.templateId],
    references: [formTemplates.id],
  }),
  submission: one(submissions, {
    fields: [formInstances.submissionId],
    references: [submissions.id],
  }),
  ownerOrganization: one(organizations, {
    fields: [formInstances.ownerOrganizationId],
    references: [organizations.id],
    relationName: 'form_instance_owner_org',
  }),
  recipientOrganization: one(organizations, {
    fields: [formInstances.recipientOrganizationId],
    references: [organizations.id],
    relationName: 'form_instance_recipient_org',
  }),
  coverageZone: one(coverageZones, {
    fields: [formInstances.coverageZoneId],
    references: [coverageZones.id],
  }),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [locations.organizationId],
    references: [organizations.id],
  }),
  phones: many(phones),
  addresses: many(addresses),
  schedules: many(schedules),
  serviceAtLocation: many(serviceAtLocation),
  languagesAtLocation: many(languagesTable),
  accessibilityForDisabilities: many(accessibilityForDisabilities),
  contacts: many(contacts),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [services.organizationId],
    references: [organizations.id],
  }),
  phones: many(phones),
  serviceAtLocation: many(serviceAtLocation),
  serviceTaxonomy: many(serviceTaxonomy),
  confidenceScores: many(confidenceScores),
  verificationQueue: many(verificationQueue),
  seekerFeedback: many(seekerFeedback),
  eligibility: many(eligibility),
  requiredDocuments: many(requiredDocuments),
  serviceAreas: many(serviceAreas),
  languagesAtService: many(languagesTable),
  contacts: many(contacts),
  savedServices: many(savedServices),
  serviceAttributes: many(serviceAttributes),
  serviceAdaptations: many(serviceAdaptations),
  dietaryOptions: many(dietaryOptions),
  schedules: many(schedules),
}));

export const programsRelations = relations(programs, ({ one }) => ({
  organization: one(organizations, {
    fields: [programs.organizationId],
    references: [organizations.id],
  }),
}));

export const serviceAtLocationRelations = relations(serviceAtLocation, ({ one }) => ({
  service: one(services, {
    fields: [serviceAtLocation.serviceId],
    references: [services.id],
  }),
  location: one(locations, {
    fields: [serviceAtLocation.locationId],
    references: [locations.id],
  }),
}));

export const phonesRelations = relations(phones, ({ one }) => ({
  location: one(locations, {
    fields: [phones.locationId],
    references: [locations.id],
  }),
  service: one(services, {
    fields: [phones.serviceId],
    references: [services.id],
  }),
  organization: one(organizations, {
    fields: [phones.organizationId],
    references: [organizations.id],
  }),
}));

export const addressesRelations = relations(addresses, ({ one }) => ({
  location: one(locations, {
    fields: [addresses.locationId],
    references: [locations.id],
  }),
}));

export const schedulesRelations = relations(schedules, ({ one }) => ({
  service: one(services, {
    fields: [schedules.serviceId],
    references: [services.id],
  }),
  location: one(locations, {
    fields: [schedules.locationId],
    references: [locations.id],
  }),
}));

export const taxonomyTermsRelations = relations(taxonomyTerms, ({ one, many }) => ({
  parent: one(taxonomyTerms, {
    fields: [taxonomyTerms.parentId],
    references: [taxonomyTerms.id],
    relationName: 'taxonomy_parent_child',
  }),
  children: many(taxonomyTerms, {
    relationName: 'taxonomy_parent_child',
  }),
  serviceTaxonomy: many(serviceTaxonomy),
}));

export const serviceTaxonomyRelations = relations(serviceTaxonomy, ({ one }) => ({
  service: one(services, {
    fields: [serviceTaxonomy.serviceId],
    references: [services.id],
  }),
  taxonomyTerm: one(taxonomyTerms, {
    fields: [serviceTaxonomy.taxonomyTermId],
    references: [taxonomyTerms.id],
  }),
}));

export const confidenceScoresRelations = relations(confidenceScores, ({ one }) => ({
  service: one(services, {
    fields: [confidenceScores.serviceId],
    references: [services.id],
  }),
}));

export const verificationQueueRelations = relations(verificationQueue, ({ one, many }) => ({
  service: one(services, {
    fields: [verificationQueue.serviceId],
    references: [services.id],
  }),
  evidence: many(verificationEvidence),
}));

export const seekerFeedbackRelations = relations(seekerFeedback, ({ one }) => ({
  service: one(services, {
    fields: [seekerFeedback.serviceId],
    references: [services.id],
  }),
}));

export const eligibilityRelations = relations(eligibility, ({ one }) => ({
  service: one(services, {
    fields: [eligibility.serviceId],
    references: [services.id],
  }),
}));

export const requiredDocumentsRelations = relations(requiredDocuments, ({ one }) => ({
  service: one(services, {
    fields: [requiredDocuments.serviceId],
    references: [services.id],
  }),
}));

export const serviceAreasRelations = relations(serviceAreas, ({ one }) => ({
  service: one(services, {
    fields: [serviceAreas.serviceId],
    references: [services.id],
  }),
}));

export const languagesTableRelations = relations(languagesTable, ({ one }) => ({
  service: one(services, {
    fields: [languagesTable.serviceId],
    references: [services.id],
  }),
  location: one(locations, {
    fields: [languagesTable.locationId],
    references: [locations.id],
  }),
}));

export const accessibilityForDisabilitiesRelations = relations(accessibilityForDisabilities, ({ one }) => ({
  location: one(locations, {
    fields: [accessibilityForDisabilities.locationId],
    references: [locations.id],
  }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  organization: one(organizations, {
    fields: [contacts.organizationId],
    references: [organizations.id],
  }),
  service: one(services, {
    fields: [contacts.serviceId],
    references: [services.id],
  }),
  location: one(locations, {
    fields: [contacts.locationId],
    references: [locations.id],
  }),
}));

export const savedServicesRelations = relations(savedServices, ({ one }) => ({
  service: one(services, {
    fields: [savedServices.serviceId],
    references: [services.id],
  }),
}));

export const verificationEvidenceRelations = relations(verificationEvidence, ({ one }) => ({
  queueEntry: one(verificationQueue, {
    fields: [verificationEvidence.queueEntryId],
    references: [verificationQueue.id],
  }),
}));

export const serviceAttributesRelations = relations(serviceAttributes, ({ one }) => ({
  service: one(services, {
    fields: [serviceAttributes.serviceId],
    references: [services.id],
  }),
}));

export const serviceAdaptationsRelations = relations(serviceAdaptations, ({ one }) => ({
  service: one(services, {
    fields: [serviceAdaptations.serviceId],
    references: [services.id],
  }),
}));

export const dietaryOptionsRelations = relations(dietaryOptions, ({ one }) => ({
  service: one(services, {
    fields: [dietaryOptions.serviceId],
    references: [services.id],
  }),
}));

export const importBatchesRelations = relations(importBatches, ({ many }) => ({
  stagingOrganizations: many(stagingOrganizations),
  stagingLocations: many(stagingLocations),
  stagingServices: many(stagingServices),
}));

export const stagingOrganizationsRelations = relations(stagingOrganizations, ({ one }) => ({
  importBatch: one(importBatches, {
    fields: [stagingOrganizations.importBatchId],
    references: [importBatches.id],
  }),
}));

export const stagingLocationsRelations = relations(stagingLocations, ({ one }) => ({
  importBatch: one(importBatches, {
    fields: [stagingLocations.importBatchId],
    references: [importBatches.id],
  }),
}));

export const stagingServicesRelations = relations(stagingServices, ({ one }) => ({
  importBatch: one(importBatches, {
    fields: [stagingServices.importBatchId],
    references: [importBatches.id],
  }),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
}));
