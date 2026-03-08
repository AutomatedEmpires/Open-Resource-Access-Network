import { z } from 'zod';

import { buildDefaultChecklist, VerificationChecklistSchema } from './checklist';

export const SourceKindSchema = z.enum([
  'allowlisted_scrape',
  'partner_feed',
  'manual',
  'curated_list',
  'hsds_api',
  'hsds_tabular',
  'partner_api',
  'partner_export',
  'government_open_data',
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/**
 * Source system family — mirrors the source_systems.family CHECK constraint.
 * Used for the unified source registry.
 */
export const SourceSystemFamilySchema = z.enum([
  'hsds_api',
  'hsds_tabular',
  'partner_api',
  'partner_export',
  'government_open_data',
  'allowlisted_scrape',
  'manual',
]);
export type SourceSystemFamily = z.infer<typeof SourceSystemFamilySchema>;

/**
 * Trust tiers — determines pipeline speed for inbound data.
 * verified_publisher: auto-tag, auto-approve unless anomaly
 * trusted_partner: auto-tag, light human review
 * community: full review pipeline
 * quarantine: full review + domain validation
 * blocked: not ingested
 */
export const TrustTierSchema = z.enum([
  'verified_publisher',
  'trusted_partner',
  'community',
  'quarantine',
  'blocked',
]);
export type TrustTier = z.infer<typeof TrustTierSchema>;

export const CandidateLocatorSchema = z.object({
  kind: SourceKindSchema,
  sourceUrl: z.string().url(),
  canonicalUrl: z.string().url().optional(),
  discoveredAt: z.string().datetime(),
  discoveredBy: z.enum(['system', 'human']),
});
export type CandidateLocator = z.infer<typeof CandidateLocatorSchema>;

export const EvidenceSnapshotSchema = z.object({
  evidenceId: z.string().min(1),
  canonicalUrl: z.string().url(),
  fetchedAt: z.string().datetime(),
  httpStatus: z.number().int().min(100).max(599),
  contentType: z.string().min(1).optional(),
  contentHashSha256: z.string().regex(/^[a-f0-9]{64}$/i),
  blobUri: z.string().url().optional(),
});
export type EvidenceSnapshot = z.infer<typeof EvidenceSnapshotSchema>;

/**
 * Jurisdiction hint derived from explicit evidence.
 * This is used for routing to the appropriate admin reviewers.
 */
export const JurisdictionHintSchema = z
  .object({
    country: z.string().min(2).max(2).default('US'),
    stateProvince: z.string().min(1).optional(),
    countyOrRegion: z.string().min(1).optional(),
    city: z.string().min(1).optional(),
    postalCode: z.string().min(1).optional(),
    kind: z.enum(['local', 'regional', 'statewide', 'national', 'virtual']).default('local'),
  })
  .strict();
export type JurisdictionHint = z.infer<typeof JurisdictionHintSchema>;

export const ReviewStatusSchema = z.enum(['pending', 'in_review', 'verified', 'rejected', 'escalated', 'published', 'archived']);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const ReviewTimersSchema = z
  .object({
    reviewBy: z.string().datetime().optional(),
    lastVerifiedAt: z.string().datetime().optional(),
    reverifyAt: z.string().datetime().optional(),
  })
  .strict();
export type ReviewTimers = z.infer<typeof ReviewTimersSchema>;

export const DiscoveredLinkSchema = z
  .object({
    url: z.string().url(),
    type: z.enum(['home', 'contact', 'apply', 'eligibility', 'intake_form', 'hours', 'pdf', 'privacy', 'other']),
    label: z.string().min(1).optional(),
    evidenceId: z.string().min(1),
  })
  .strict();
export type DiscoveredLink = z.infer<typeof DiscoveredLinkSchema>;

export const InvestigationPackSchema = z
  .object({
    canonicalUrl: z.string().url(),
    discoveredLinks: z.array(DiscoveredLinkSchema).default([]),
    importantArtifacts: z.array(z.string().min(1)).default([]),
  })
  .strict();
export type InvestigationPack = z.infer<typeof InvestigationPackSchema>;

export const ExtractedCandidateSchema = z.object({
  extractionId: z.string().min(1),
  candidateId: z.string().min(1),
  extractKeySha256: z.string().regex(/^[a-f0-9]{64}$/i),
  extractedAt: z.string().datetime(),
  review: z
    .object({
      status: ReviewStatusSchema.default('pending'),
      jurisdiction: JurisdictionHintSchema.optional(),
      timers: ReviewTimersSchema.default({}),
      assignedToRole: z.enum(['community_admin', 'oran_admin']).optional(),
      assignedToKey: z.string().min(1).optional(),
      tags: z.array(z.string().min(1)).default([]),
      checklist: VerificationChecklistSchema.default(() => buildDefaultChecklist()),
    })
    .default(() => ({
      status: 'pending' as const,
      timers: {},
      tags: [] as string[],
      checklist: buildDefaultChecklist(),
    })),
  fields: z.object({
    organizationName: z.string().min(1),
    serviceName: z.string().min(1),
    /** Nullable in DB; default to empty string on readback to avoid Zod crash. */
    description: z.string().default(''),
    websiteUrl: z.string().url().optional(),
    phone: z.string().min(1).optional(),
    phones: z
      .array(
        z.object({
          number: z.string().min(1),
          type: z.enum(['voice', 'fax', 'tty', 'hotline', 'sms']).optional(),
          context: z.string().min(1).optional(),
        })
      )
      .optional(),
    address: z
      .object({
        line1: z.string().min(1),
        line2: z.string().min(1).optional(),
        city: z.string().min(1),
        region: z.string().min(1),
        postalCode: z.string().min(1),
        country: z.string().min(2).max(2).default('US'),
      })
      .optional(),
    isRemoteService: z.boolean().default(false),
  }),
  investigation: InvestigationPackSchema.optional(),
  provenance: z
    .record(
      z.string(),
      z.object({
        evidenceId: z.string().min(1),
        selectorOrHint: z.string().min(1).optional(),
        confidenceHint: z.enum(['high', 'medium', 'low']).optional(),
      })
    )
    .default({}),
});
export type ExtractedCandidate = z.infer<typeof ExtractedCandidateSchema>;

export const VerificationSeveritySchema = z.enum(['critical', 'warning', 'info']);
export type VerificationSeverity = z.infer<typeof VerificationSeveritySchema>;

export const VerificationCheckResultSchema = z.object({
  checkId: z.string().min(1),
  extractionId: z.string().min(1),
  checkType: z.enum([
    'domain_allowlist',
    'contact_validity',
    'cross_source_agreement',
    'hours_stability',
    'location_plausibility',
    'policy_constraints',
  ]),
  severity: VerificationSeveritySchema,
  status: z.enum(['pass', 'fail', 'unknown']),
  ranAt: z.string().datetime(),
  details: z.record(z.string(), z.unknown()).default({}),
  evidenceRefs: z.array(z.string().min(1)).default([]),
});
export type VerificationCheckResult = z.infer<typeof VerificationCheckResultSchema>;

export const AuditEventSchema = z.object({
  eventId: z.string().min(1),
  correlationId: z.string().min(1),
  eventType: z.enum([
    'candidate.located',
    'evidence.fetched',
    'extract.completed',
    'verify.completed',
    'review.assigned',
    'review.status_changed',
    'publish.approved',
    'publish.rejected',
    'reverify.completed',
  ]),
  actorType: z.enum(['system', 'service_principal', 'human']),
  actorId: z.string().min(1),
  targetType: z.enum(['candidate', 'evidence', 'extraction', 'service']),
  targetId: z.string().min(1),
  timestamp: z.string().datetime(),
  inputs: z.record(z.string(), z.unknown()).default({}),
  outputs: z.record(z.string(), z.unknown()).default({}),
  evidenceRefs: z.array(z.string().min(1)).default([]),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;
