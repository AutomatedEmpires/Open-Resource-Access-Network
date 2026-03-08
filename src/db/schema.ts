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
  ]
);

export type SourceFeedRow = typeof sourceFeeds.$inferSelect;
export type NewSourceFeedRow = typeof sourceFeeds.$inferInsert;

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
  records: many(sourceRecords),
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
