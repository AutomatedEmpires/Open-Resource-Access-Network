import { z } from 'zod';

export const SourceKindSchema = z.enum(['allowlisted_scrape', 'partner_feed', 'manual', 'curated_list']);
export type SourceKind = z.infer<typeof SourceKindSchema>;

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

export const ExtractedCandidateSchema = z.object({
  extractionId: z.string().min(1),
  candidateId: z.string().min(1),
  extractKeySha256: z.string().regex(/^[a-f0-9]{64}$/i),
  extractedAt: z.string().datetime(),
  fields: z.object({
    organizationName: z.string().min(1),
    serviceName: z.string().min(1),
    description: z.string().min(1),
    websiteUrl: z.string().url().optional(),
    phone: z.string().min(1).optional(),
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
