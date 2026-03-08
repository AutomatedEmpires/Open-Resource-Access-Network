import type { ExtractedCandidate, ReviewStatus, VerificationCheckResult } from './contracts';
import type { DetailedPipelineExecution, PipelineCandidateArtifact } from './pipeline/types';
import type { IngestionStores, VerifiedServiceLink } from './stores';
import { createTagConfirmation } from './tagConfirmations';
import {
  buildVerificationMissingTags,
  createGeographicTag,
  deriveSourceQualityTag,
} from './tags';
import type { ResourceTag, ResourceTagType } from './tags';

const REVIEW_BY_HOURS = {
  green: 72,
  yellow: 48,
  orange: 24,
  red: 12,
} as const;

const REVERIFY_BY_DAYS = {
  green: 90,
  yellow: 45,
  orange: 14,
  red: 7,
} as const;

const AUTO_APPROVE_TAG_CONFIDENCE = 80;

export interface MaterializePipelineArtifactsOptions {
  jobId?: string;
  correlationId: string;
}

export interface MaterializePipelineArtifactsResult {
  candidateId?: string;
  evidenceId?: string;
  deduped: boolean;
  assignedToRole?: 'community_admin' | 'oran_admin';
  reviewStatus?: ReviewStatus;
}

function addHours(isoDate: string, hours: number): string {
  return new Date(Date.parse(isoDate) + hours * 60 * 60 * 1000).toISOString();
}

function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(isoDate) + days * 24 * 60 * 60 * 1000).toISOString();
}

function buildEvidenceProvenance(evidenceId?: string): ExtractedCandidate['provenance'] {
  if (!evidenceId) {
    return {};
  }

  return {
    organizationName: { evidenceId, confidenceHint: 'high' },
    serviceName: { evidenceId, confidenceHint: 'high' },
    description: { evidenceId, confidenceHint: 'medium' },
    websiteUrl: { evidenceId, confidenceHint: 'high' },
    phone: { evidenceId, confidenceHint: 'medium' },
    address: { evidenceId, confidenceHint: 'medium' },
  };
}

function hasCriticalFailure(checks: PipelineCandidateArtifact['verificationChecks']): boolean {
  return checks.some((check) => check.severity === 'critical' && check.status === 'fail');
}

function hasDomainFailure(checks: PipelineCandidateArtifact['verificationChecks']): boolean {
  return checks.some(
    (check) => check.checkType === 'domain_allowlist' && check.status === 'fail',
  );
}

function determineReviewRole(
  candidate: PipelineCandidateArtifact,
): 'community_admin' | 'oran_admin' {
  if (candidate.sourceTrustLevel === 'quarantine') {
    return 'oran_admin';
  }
  if (hasCriticalFailure(candidate.verificationChecks)) {
    return 'oran_admin';
  }
  if (candidate.score.overall < 60 || candidate.score.tier === 'red') {
    return 'oran_admin';
  }
  return 'community_admin';
}

function determineReviewStatus(
  candidate: PipelineCandidateArtifact,
  assignedToRole: 'community_admin' | 'oran_admin',
  existingStatus?: ReviewStatus,
): ReviewStatus {
  if (existingStatus === 'published' || existingStatus === 'verified') {
    return existingStatus;
  }
  if (assignedToRole === 'oran_admin') {
    return 'escalated';
  }
  return 'pending';
}

function buildReviewTimers(
  candidate: PipelineCandidateArtifact,
  reviewStatus: ReviewStatus,
): NonNullable<ExtractedCandidate['review']>['timers'] {
  const baseTier = candidate.sourceTrustLevel === 'quarantine' ? 'orange' : candidate.score.tier;
  const reviewBy = reviewStatus === 'published'
    ? undefined
    : addHours(candidate.extractedAt, REVIEW_BY_HOURS[baseTier]);

  const reverifyTier = candidate.sourceTrustLevel === 'quarantine' ? 'orange' : candidate.score.tier;

  return {
    reviewBy,
    lastVerifiedAt: candidate.extractedAt,
    reverifyAt: addDays(candidate.extractedAt, REVERIFY_BY_DAYS[reverifyTier]),
  };
}

function buildJurisdiction(candidate: PipelineCandidateArtifact): ExtractedCandidate['review']['jurisdiction'] {
  if (candidate.isRemoteService) {
    return {
      country: candidate.address?.country ?? 'US',
      stateProvince: candidate.address?.region,
      city: candidate.address?.city,
      kind: 'virtual',
    };
  }

  if (!candidate.address) {
    return undefined;
  }

  return {
    country: candidate.address.country,
    stateProvince: candidate.address.region,
    city: candidate.address.city,
    kind: 'local',
  };
}

function buildCandidateRecord(
  candidate: PipelineCandidateArtifact,
  options: {
    candidateId: string;
    evidenceId?: string;
    canonicalUrl?: string;
    jobId?: string;
    correlationId: string;
    assignedToRole: 'community_admin' | 'oran_admin';
    reviewStatus: ReviewStatus;
  },
): ExtractedCandidate & {
  jobId?: string;
  correlationId: string;
  primaryEvidenceId?: string;
  jurisdictionState?: string;
  jurisdictionCounty?: string;
  jurisdictionCity?: string;
  jurisdictionKind?: string;
} {
  const jurisdiction = buildJurisdiction(candidate);

  return {
    extractionId: candidate.extractionId,
    candidateId: options.candidateId,
    extractKeySha256: candidate.extractKeySha256,
    extractedAt: candidate.extractedAt,
    review: {
      status: options.reviewStatus,
      jurisdiction,
      timers: buildReviewTimers(candidate, options.reviewStatus),
      assignedToRole: options.assignedToRole,
      tags: candidate.categoryTags.map((tag) => tag.tagValue),
      checklist: candidate.verificationChecklist,
    },
    fields: {
      organizationName: candidate.organizationName,
      serviceName: candidate.serviceName,
      description: candidate.description,
      websiteUrl: candidate.websiteUrl,
      phone: candidate.phone,
      address: candidate.address,
      isRemoteService: candidate.isRemoteService,
    },
    investigation: {
      canonicalUrl: options.canonicalUrl ?? candidate.websiteUrl ?? 'https://oran.invalid',
      discoveredLinks: candidate.discoveredLinks.map((link) => ({
        url: link.url,
        type: link.type,
        label: link.label,
        evidenceId: link.evidenceId,
      })),
      importantArtifacts: options.evidenceId ? [options.evidenceId] : [],
    },
    provenance: buildEvidenceProvenance(options.evidenceId),
    primaryEvidenceId: options.evidenceId,
    correlationId: options.correlationId,
    jobId: options.jobId,
    jurisdictionState: jurisdiction?.stateProvince,
    jurisdictionCounty: jurisdiction?.countyOrRegion,
    jurisdictionCity: jurisdiction?.city,
    jurisdictionKind:
      jurisdiction?.kind === 'virtual'
        ? 'virtual'
        : jurisdiction?.kind === 'statewide'
          ? 'state'
          : jurisdiction?.kind === 'national'
            ? 'federal'
            : jurisdiction?.kind === 'regional'
              ? 'county'
              : 'municipal',
  };
}

function buildCategoryTags(candidateId: string, candidate: PipelineCandidateArtifact): ResourceTag[] {
  return candidate.categoryTags.map((tag) => ({
    candidateId,
    tagType: 'category',
    tagValue: tag.tagValue,
    tagConfidence: tag.confidence,
    assignedBy: 'agent',
    evidenceRefs: [],
  }));
}

function buildGeographicTags(candidateId: string, candidate: PipelineCandidateArtifact): ResourceTag[] {
  const country = candidate.address?.country ?? 'US';
  const state = candidate.address?.region;
  const city = candidate.address?.city;

  const values = new Set<string>();
  values.add(createGeographicTag(undefined, undefined, undefined, country));

  if (state) {
    values.add(createGeographicTag(state, undefined, undefined, country));
  }
  if (state && city) {
    values.add(createGeographicTag(state, undefined, city, country));
  }

  return Array.from(values).map((tagValue) => ({
    candidateId,
    tagType: 'geographic',
    tagValue,
    tagConfidence: 100,
    assignedBy: 'system',
    evidenceRefs: [],
  }));
}

function buildSourceQualityTags(
  candidateId: string,
  candidate: PipelineCandidateArtifact,
  canonicalUrl?: string,
): ResourceTag[] {
  const sourceTagValue =
    candidate.sourceTrustLevel === 'quarantine'
      ? 'quarantine_source'
      : deriveSourceQualityTag(
          new URL(candidate.websiteUrl ?? canonicalUrl ?? 'https://oran.invalid').hostname,
        );

  return [
    {
      candidateId,
      tagType: 'source_quality',
      tagValue: sourceTagValue,
      tagConfidence: 100,
      assignedBy: 'system',
      evidenceRefs: [],
    },
  ];
}

function buildVerificationTags(
  candidateId: string,
  candidate: PipelineCandidateArtifact,
  reviewStatus: ReviewStatus,
): Record<'verification_missing' | 'verification_status', ResourceTag[]> {
  const missing = buildVerificationMissingTags(candidate.verificationChecklist).map((tagValue) => ({
    candidateId,
    tagType: 'verification_missing' as const,
    tagValue,
    tagConfidence: 100,
    assignedBy: 'system' as const,
    evidenceRefs: [],
  }));

  const statusValue: string =
    reviewStatus === 'published'
      ? 'verified'
      : reviewStatus === 'escalated'
        ? 'escalated'
        : 'pending';

  return {
    verification_missing: missing,
    verification_status: [
      {
        candidateId,
        tagType: 'verification_status',
        tagValue: statusValue,
        tagConfidence: 100,
        assignedBy: 'system',
        evidenceRefs: [],
      },
    ],
  };
}

function buildLinkRows(candidateId: string, candidate: PipelineCandidateArtifact): VerifiedServiceLink[] {
  return candidate.discoveredLinks.map((link) => ({
    candidateId,
    url: link.url,
    label: link.label ?? link.url,
    linkType:
      link.type === 'home'
        ? 'service_page'
        : link.type === 'other'
          ? 'other'
          : link.type,
    isVerified: false,
    evidenceId: link.evidenceId,
    discoveredAt: candidate.extractedAt,
  }));
}

function buildReadinessSnapshot(input: {
  candidateId: string;
  candidate: PipelineCandidateArtifact;
  categoryTags: ResourceTag[];
  geographicTags: ResourceTag[];
  pendingTagCount: number;
}): {
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
} {
  const hasRequiredFields = Boolean(
    input.candidate.organizationName &&
      input.candidate.serviceName &&
      input.candidate.description &&
      (input.candidate.phone || input.candidate.websiteUrl) &&
      (input.candidate.isRemoteService || input.candidate.address),
  );
  const hasRequiredTags =
    input.categoryTags.length > 0 && input.geographicTags.length > 0;
  const tagsConfirmed = input.pendingTagCount === 0;
  const meetsScoreThreshold = input.candidate.score.overall >= 60;
  const blockers: string[] = [];

  if (!hasRequiredFields) {
    blockers.push('missing_required_fields');
  }
  if (!hasRequiredTags) {
    blockers.push('missing_required_tags');
  }
  if (!tagsConfirmed) {
    blockers.push('pending_tag_confirmation');
  }
  if (!meetsScoreThreshold) {
    blockers.push('confidence_below_publish_threshold');
  }
  if (input.candidate.sourceTrustLevel === 'quarantine') {
    blockers.push('quarantine_source');
  }
  if (hasCriticalFailure(input.candidate.verificationChecks)) {
    blockers.push('critical_verification_failure');
  }
  if (hasDomainFailure(input.candidate.verificationChecks)) {
    blockers.push('domain_allowlist_failed');
  }

  return {
    candidateId: input.candidateId,
    isReady: blockers.length === 0,
    hasRequiredFields,
    hasRequiredTags,
    tagsConfirmed,
    meetsScoreThreshold,
    hasAdminApproval: false,
    pendingTagCount: input.pendingTagCount,
    adminApprovalCount: 0,
    blockers,
  };
}

async function replaceTagType(
  stores: IngestionStores,
  candidateId: string,
  tagType: ResourceTagType,
  tags: ResourceTag[],
): Promise<void> {
  await stores.tags.replaceByType(candidateId, 'candidate', tagType, tags);
}

async function recordVerificationChecks(
  stores: IngestionStores,
  candidateId: string,
  verificationChecks: PipelineCandidateArtifact['verificationChecks'],
): Promise<void> {
  for (const check of verificationChecks) {
    const payload: VerificationCheckResult & { candidateId: string } = {
      checkId: `${candidateId}:${check.checkType}`,
      candidateId,
      extractionId: check.extractionId,
      checkType: check.checkType,
      severity: check.severity,
      status: check.status,
      ranAt: check.ranAt,
      details: check.details,
      evidenceRefs: check.evidenceRefs,
    };
    await stores.checks.record(payload);
  }
}

export async function materializePipelineArtifacts(
  stores: IngestionStores,
  execution: DetailedPipelineExecution,
  options: MaterializePipelineArtifactsOptions,
): Promise<MaterializePipelineArtifactsResult> {
  const { evidence, candidate } = execution.artifacts;

  if (evidence) {
    const existingEvidence = await stores.evidence.getById(evidence.evidenceId);
    if (!existingEvidence) {
      await stores.evidence.create({
        evidenceId: evidence.evidenceId,
        canonicalUrl: evidence.canonicalUrl,
        fetchedAt: evidence.fetchedAt,
        httpStatus: evidence.httpStatus,
        contentHashSha256: evidence.contentHashSha256,
        contentType: evidence.contentType,
        blobUri: undefined,
        jobId: options.jobId,
        correlationId: options.correlationId,
        htmlRaw: evidence.htmlRaw,
        textExtracted: evidence.textExtracted,
        title: evidence.title,
        metaDescription: evidence.metaDescription,
        language: evidence.language,
        contentLength: evidence.contentLength,
      });
    }
  }

  if (!candidate) {
    return {
      evidenceId: evidence?.evidenceId,
      deduped: false,
    };
  }

  const existingCandidate = await stores.candidates.getByExtractKey(candidate.extractKeySha256);
  const candidateId = existingCandidate?.candidateId ?? candidate.candidateId;
  const assignedToRole = determineReviewRole(candidate);
  const reviewStatus = determineReviewStatus(candidate, assignedToRole, existingCandidate?.review.status);

  const candidateRecord = buildCandidateRecord(candidate, {
    candidateId,
    evidenceId: evidence?.evidenceId,
    canonicalUrl: evidence?.canonicalUrl,
    jobId: options.jobId,
    correlationId: options.correlationId,
    assignedToRole,
    reviewStatus,
  });

  if (existingCandidate) {
    await stores.candidates.update(candidateId, {
      fields: candidateRecord.fields,
      review: candidateRecord.review,
      investigation: candidateRecord.investigation,
      provenance: candidateRecord.provenance,
    });
  } else {
    await stores.candidates.create(candidateRecord);
  }

  await stores.candidates.updateConfidenceScore(candidateId, candidate.score.overall);
  await recordVerificationChecks(stores, candidateId, candidate.verificationChecks);

  const categoryTags = buildCategoryTags(candidateId, candidate);
  const geographicTags = buildGeographicTags(candidateId, candidate);
  const sourceQualityTags = buildSourceQualityTags(candidateId, candidate, evidence?.canonicalUrl);
  const verificationTags = buildVerificationTags(candidateId, candidate, reviewStatus);

  await replaceTagType(stores, candidateId, 'category', categoryTags);
  await replaceTagType(stores, candidateId, 'geographic', geographicTags);
  await replaceTagType(stores, candidateId, 'source_quality', sourceQualityTags);
  await replaceTagType(
    stores,
    candidateId,
    'verification_missing',
    verificationTags.verification_missing,
  );
  await replaceTagType(
    stores,
    candidateId,
    'verification_status',
    verificationTags.verification_status,
  );

  const existingConfirmations = await stores.tagConfirmations.listForCandidate(candidateId);
  const existingConfirmationKeys = new Set(
    existingConfirmations.map(
      (confirmation) => `${confirmation.tagType}:${confirmation.suggestedValue.toLowerCase()}`,
    ),
  );

  const newConfirmations = candidate.categoryTags
    .filter((tag) => tag.confidence < AUTO_APPROVE_TAG_CONFIDENCE)
    .filter((tag) => !existingConfirmationKeys.has(`category:${tag.tagValue.toLowerCase()}`))
    .map((tag) =>
      createTagConfirmation(candidateId, 'category', tag.tagValue, tag.confidence, {
        evidenceRefs: evidence?.evidenceId ? [evidence.evidenceId] : [],
      }),
    );

  if (newConfirmations.length > 0) {
    await stores.tagConfirmations.bulkCreate(newConfirmations);
  }

  const pendingTagCount =
    existingConfirmations.filter((confirmation) => confirmation.confirmationStatus === 'pending')
      .length +
    newConfirmations.filter((confirmation) => confirmation.confirmationStatus === 'pending').length;

  const existingLinks = new Set(
    (await stores.links.listForCandidate(candidateId)).map((link) => link.url),
  );
  const newLinks = buildLinkRows(candidateId, candidate).filter((link) => !existingLinks.has(link.url));
  if (newLinks.length > 0) {
    await stores.links.bulkAdd(newLinks);
  }

  await stores.publishReadiness.upsert(
    buildReadinessSnapshot({
      candidateId,
      candidate,
      categoryTags,
      geographicTags,
      pendingTagCount,
    }),
  );

  return {
    candidateId,
    evidenceId: evidence?.evidenceId,
    deduped: Boolean(existingCandidate),
    assignedToRole,
    reviewStatus,
  };
}
