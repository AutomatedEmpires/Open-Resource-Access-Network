/**
 * Publish Readiness Contracts
 *
 * Deterministic checks for whether a candidate is ready to be published
 * to the live database for seekers to see.
 *
 * Publish threshold: All required fields + critical tags confirmed + green/yellow tier.
 *
 * @module agents/ingestion/publish
 */

import { z } from 'zod';
import type { ConfidenceTier } from '@/domain/confidence';
import { getConfidenceTier } from '@/domain/confidence';
import { TagConfirmation, hasBlockingPendingTags } from './confirmations';

// ============================================================
// PUBLISH READINESS STATE
// ============================================================

/**
 * All the criteria that must be met to publish.
 */
export const PublishReadinessSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),

  // Required fields status
  hasOrgName: z.boolean().default(false),
  hasServiceName: z.boolean().default(false),
  hasDescription: z.boolean().default(false),
  hasContactMethod: z.boolean().default(false), // phone OR email OR website
  hasLocationOrVirtual: z.boolean().default(false),

  // Tag requirements
  hasCategoryTag: z.boolean().default(false),
  hasGeographicTag: z.boolean().default(false),

  // Confirmation status
  criticalTagsConfirmed: z.boolean().default(false),
  noRedTagsPending: z.boolean().default(false),

  // Verification
  passedDomainCheck: z.boolean().default(false),
  noCriticalFailures: z.boolean().default(false),

  // Overall score
  confidenceScore: z.number().int().min(0).max(100).default(0),

  // Computed
  computedAt: z.date(),

  // Manual override
  approvedByUserId: z.string().nullable(),
  approvedAt: z.date().nullable(),

  updatedAt: z.date(),
});

export type PublishReadiness = z.infer<typeof PublishReadinessSchema>;

/**
 * Get the confidence tier for a readiness record.
 */
export function getReadinessTier(readiness: PublishReadiness): ConfidenceTier {
  return getConfidenceTier(readiness.confidenceScore);
}

/**
 * Check if candidate is ready for publish (all criteria met).
 */
export function isReadyForPublish(
  readiness: PublishReadiness,
  options?: { adminApprovalCount?: number; minAdminApprovals?: number }
): boolean {
  const minApprovals = options?.minAdminApprovals ?? 0;
  const approvalCount = options?.adminApprovalCount ?? 0;

  return (
    readiness.hasOrgName &&
    readiness.hasServiceName &&
    readiness.hasDescription &&
    readiness.hasContactMethod &&
    readiness.hasLocationOrVirtual &&
    readiness.hasCategoryTag &&
    readiness.hasGeographicTag &&
    readiness.criticalTagsConfirmed &&
    readiness.noRedTagsPending &&
    readiness.passedDomainCheck &&
    readiness.noCriticalFailures &&
    readiness.confidenceScore >= 60 && // At least yellow tier
    approvalCount >= minApprovals // Require admin review when configured
  );
}

// ============================================================
// READINESS COMPUTATION
// ============================================================

/**
 * Input for computing readiness.
 */
export interface ReadinessInput {
  // Candidate fields
  organizationName: string | null;
  serviceName: string | null;
  description: string | null;
  phones: unknown[] | null;
  emails: unknown[] | null;
  websiteUrl: string | null;
  address: unknown | null;
  isRemoteService: boolean;

  // Confidence
  confidenceScore: number;

  // Tags (confirmed or from resource_tags)
  confirmedCategoryTags: string[];
  confirmedGeographicTags: string[];

  // Pending tags
  pendingTags: TagConfirmation[];

  // Verification results
  domainCheckPassed: boolean;
  criticalChecksFailed: boolean;
}

/**
 * Compute publish readiness from candidate data.
 */
export function computeReadiness(
  candidateId: string,
  input: ReadinessInput
): Omit<PublishReadiness, 'id' | 'updatedAt'> {
  const hasContactMethod =
    (input.phones && input.phones.length > 0) ||
    (input.emails && input.emails.length > 0) ||
    (input.websiteUrl !== null && input.websiteUrl !== '');

  const hasLocationOrVirtual = input.isRemoteService || input.address !== null;

  // Check critical tags
  const pendingCriticalTags = input.pendingTags.filter(
    (t) =>
      t.status === 'pending' &&
      ['category', 'geographic', 'audience'].includes(t.tagType) &&
      t.agentConfidence >= 80
  );
  const criticalTagsConfirmed = pendingCriticalTags.length === 0;

  // Check for blocking red tags
  const noRedTagsPending = !hasBlockingPendingTags(input.pendingTags);

  return {
    candidateId,
    hasOrgName: !!input.organizationName,
    hasServiceName: !!input.serviceName,
    hasDescription: !!input.description,
    hasContactMethod,
    hasLocationOrVirtual,
    hasCategoryTag: input.confirmedCategoryTags.length > 0,
    hasGeographicTag: input.confirmedGeographicTags.length > 0,
    criticalTagsConfirmed,
    noRedTagsPending,
    passedDomainCheck: input.domainCheckPassed,
    noCriticalFailures: !input.criticalChecksFailed,
    confidenceScore: input.confidenceScore,
    computedAt: new Date(),
    approvedByUserId: null,
    approvedAt: null,
  };
}

// ============================================================
// READINESS BREAKDOWN (for UI)
// ============================================================

/**
 * Individual requirement with pass/fail status.
 */
export interface ReadinessRequirement {
  key: string;
  label: string;
  met: boolean;
  required: boolean;
  weight: number; // 0-100, for priority display
}

/**
 * Get a detailed breakdown of readiness requirements.
 */
export function getReadinessBreakdown(
  readiness: PublishReadiness
): ReadinessRequirement[] {
  return [
    {
      key: 'org_name',
      label: 'Organization name',
      met: readiness.hasOrgName,
      required: true,
      weight: 100,
    },
    {
      key: 'service_name',
      label: 'Service name',
      met: readiness.hasServiceName,
      required: true,
      weight: 100,
    },
    {
      key: 'description',
      label: 'Description',
      met: readiness.hasDescription,
      required: true,
      weight: 90,
    },
    {
      key: 'contact',
      label: 'Contact method (phone, email, or website)',
      met: readiness.hasContactMethod,
      required: true,
      weight: 95,
    },
    {
      key: 'location',
      label: 'Location or marked as virtual/remote',
      met: readiness.hasLocationOrVirtual,
      required: true,
      weight: 85,
    },
    {
      key: 'category_tag',
      label: 'Category tag confirmed',
      met: readiness.hasCategoryTag,
      required: true,
      weight: 80,
    },
    {
      key: 'geographic_tag',
      label: 'Geographic tag confirmed',
      met: readiness.hasGeographicTag,
      required: true,
      weight: 80,
    },
    {
      key: 'critical_tags',
      label: 'All critical tags confirmed',
      met: readiness.criticalTagsConfirmed,
      required: true,
      weight: 75,
    },
    {
      key: 'no_red_tags',
      label: 'No low-confidence (red) tags pending',
      met: readiness.noRedTagsPending,
      required: true,
      weight: 70,
    },
    {
      key: 'domain_check',
      label: 'Domain verification passed',
      met: readiness.passedDomainCheck,
      required: true,
      weight: 60,
    },
    {
      key: 'no_critical_failures',
      label: 'No critical verification failures',
      met: readiness.noCriticalFailures,
      required: true,
      weight: 100,
    },
    {
      key: 'confidence_score',
      label: `Confidence score ≥60 (current: ${readiness.confidenceScore})`,
      met: readiness.confidenceScore >= 60,
      required: true,
      weight: 50,
    },
  ];
}

/**
 * Get what's blocking publish (unmet requirements).
 */
export function getBlockingRequirements(
  readiness: PublishReadiness
): ReadinessRequirement[] {
  return getReadinessBreakdown(readiness)
    .filter((r) => r.required && !r.met)
    .sort((a, b) => b.weight - a.weight);
}

/**
 * Get a summary suitable for display.
 */
export function getReadinessSummary(readiness: PublishReadiness): {
  isReady: boolean;
  tier: ConfidenceTier;
  metCount: number;
  totalRequired: number;
  blockers: string[];
} {
  const breakdown = getReadinessBreakdown(readiness);
  const required = breakdown.filter((r) => r.required);
  const met = required.filter((r) => r.met);
  const blockers = getBlockingRequirements(readiness).map((r) => r.label);

  return {
    isReady: isReadyForPublish(readiness),
    tier: getReadinessTier(readiness),
    metCount: met.length,
    totalRequired: required.length,
    blockers,
  };
}

// ============================================================
// PUBLISH WORKFLOW
// ============================================================

export const PublishAction = z.enum([
  'publish', // Move to live DB
  'manual_approve', // Override and publish
  'reject', // Reject from pipeline
  'return_for_review', // Send back for more work
]);
export type PublishAction = z.infer<typeof PublishAction>;

/**
 * Publish decision with justification.
 */
export const PublishDecisionSchema = z.object({
  candidateId: z.string().uuid(),
  action: PublishAction,
  decidedByUserId: z.string(),
  decidedAt: z.date(),
  reason: z.string().nullable(),
  wasAutomatic: z.boolean().default(false),
});

export type PublishDecision = z.infer<typeof PublishDecisionSchema>;

/**
 * Create a publish decision.
 */
export function createPublishDecision(
  candidateId: string,
  action: PublishAction,
  userId: string,
  reason?: string,
  wasAutomatic = false
): PublishDecision {
  return {
    candidateId,
    action,
    decidedByUserId: userId,
    decidedAt: new Date(),
    reason: reason ?? null,
    wasAutomatic,
  };
}

/**
 * Check if a candidate can be auto-published (no human intervention needed).
 *
 * Requirements for auto-publish:
 * - All requirements met
 * - Confidence ≥80 (green tier)
 * - Source is highly trusted (.gov, .edu)
 * - No manual edits were made
 */
export function canAutoPublish(
  readiness: PublishReadiness,
  sourceQuality: 'official' | 'vetted' | 'community' | 'unvetted'
): boolean {
  return (
    isReadyForPublish(readiness) &&
    readiness.confidenceScore >= 80 &&
    sourceQuality === 'official' // Only auto-publish from official sources
  );
}

// ============================================================
// STAGING TO LIVE TRANSFER
// ============================================================

/**
 * Fields transferred from staging candidate to live service record.
 */
export const LiveServiceFieldsSchema = z.object({
  // Identity
  organizationName: z.string(),
  serviceName: z.string(),
  description: z.string(),

  // Contact
  phones: z.array(z.unknown()).default([]),
  emails: z.array(z.unknown()).default([]),
  websiteUrl: z.string().nullable(),

  // Location
  address: z.unknown().nullable(),
  isRemoteService: z.boolean().default(false),
  serviceAreaDescription: z.string().nullable(),

  // Operational
  hoursOfOperation: z.unknown().nullable(),
  eligibilityDescription: z.string().nullable(),
  intakeProcess: z.string().nullable(),
  fees: z.string().nullable(),
  languages: z.array(z.string()).default([]),

  // Metadata
  lastUpdated: z.date(),
  sourceUrl: z.string().nullable(),
  verifiedAt: z.date().nullable(),
});

export type LiveServiceFields = z.infer<typeof LiveServiceFieldsSchema>;

/**
 * Result of publishing to live database.
 */
export interface PublishResult {
  success: boolean;
  liveServiceId: string | null;
  candidateId: string;
  publishedAt: Date | null;
  error: string | null;
}

// ============================================================
// REVIEW ACTIONS AUDIT
// ============================================================

export const ReviewActionType = z.enum([
  'tag_confirmed',
  'tag_rejected',
  'tag_modified',
  'field_accepted',
  'field_rejected',
  'field_edited',
  'assignment_claimed',
  'assignment_declined',
  'review_completed',
  'review_escalated',
  'publish_approved',
  'publish_rejected',
  'manual_override',
]);
export type ReviewActionType = z.infer<typeof ReviewActionType>;

export const ReviewTargetType = z.enum(['tag', 'field', 'assignment', 'candidate']);
export type ReviewTargetType = z.infer<typeof ReviewTargetType>;

/**
 * Audit record for a review action.
 */
export const ReviewActionSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  actorUserId: z.string(),
  actorRole: z.string(),
  actionType: ReviewActionType,
  targetType: ReviewTargetType,
  targetId: z.string().nullable(),
  oldValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  notes: z.string().nullable(),
  actedAt: z.date(),
});

export type ReviewAction = z.infer<typeof ReviewActionSchema>;

/**
 * Create a review action audit record.
 */
export function createReviewAction(
  candidateId: string,
  actorUserId: string,
  actorRole: string,
  actionType: ReviewActionType,
  targetType: ReviewTargetType,
  options: {
    targetId?: string;
    oldValue?: unknown;
    newValue?: unknown;
    notes?: string;
  } = {}
): Omit<ReviewAction, 'id'> {
  return {
    candidateId,
    actorUserId,
    actorRole,
    actionType,
    targetType,
    targetId: options.targetId ?? null,
    oldValue: options.oldValue ?? null,
    newValue: options.newValue ?? null,
    notes: options.notes ?? null,
    actedAt: new Date(),
  };
}

// ============================================================
// STORE INTERFACES
// ============================================================

/**
 * Store interface for publish readiness operations.
 */
export interface PublishReadinessStore {
  getByCandidate(candidateId: string): Promise<PublishReadiness | null>;
  upsert(readiness: Omit<PublishReadiness, 'id' | 'updatedAt'>): Promise<void>;
  getReadyToPublish(limit?: number): Promise<PublishReadiness[]>;
}

/**
 * Store interface for review action audit.
 */
export interface ReviewActionStore {
  create(action: Omit<ReviewAction, 'id'>): Promise<ReviewAction>;
  getByCandidate(candidateId: string): Promise<ReviewAction[]>;
  getByActor(userId: string, since?: Date): Promise<ReviewAction[]>;
}

/**
 * Complete store interface for publish workflow.
 */
export interface PublishWorkflowStore {
  readiness: PublishReadinessStore;
  reviewActions: ReviewActionStore;

  /**
   * Publish a candidate to the live database.
   * Returns the ID of the created live service record.
   */
  publish(
    candidateId: string,
    decision: PublishDecision
  ): Promise<PublishResult>;

  /**
   * Get candidates that are ready but not yet published.
   */
  getPendingPublish(): Promise<PublishReadiness[]>;
}
