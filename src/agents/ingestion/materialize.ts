import { CONFIDENCE_THRESHOLDS } from '@/domain/confidence';
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

const AUTO_APPROVE_TAG_CONFIDENCE = 80;
const IMMUTABLE_REVIEW_STATUSES = new Set<ReviewStatus>([
  'in_review',
  'escalated',
  'verified',
  'rejected',
  'published',
  'archived',
]);

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
  revisionOfCandidateId?: string;
  lineageRootCandidateId?: string;
  revisionNumber?: number;
}

function addHours(isoDate: string, hours: number): string {
  return new Date(Date.parse(isoDate) + hours * 60 * 60 * 1000).toISOString();
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
  if (hasDomainFailure(candidate.verificationChecks)) {
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
  // LB12: Demote published/verified services when re-extract score drops below publish threshold
  if (existingStatus === 'published' || existingStatus === 'verified') {
    if (candidate.score.overall < CONFIDENCE_THRESHOLDS.YELLOW) {
      return 'escalated';
    }
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

  return {
    reviewBy,
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
    extractionId?: string;
    revisionOfCandidateId?: string;
    lineageRootCandidateId?: string;
    revisionNumber?: number;
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
    extractionId: options.extractionId ?? candidate.extractionId,
    candidateId: options.candidateId,
    extractKeySha256: candidate.extractKeySha256,
    extractedAt: candidate.extractedAt,
    revisionOfCandidateId: options.revisionOfCandidateId,
    lineageRootCandidateId: options.lineageRootCandidateId ?? options.candidateId,
    revisionNumber: options.revisionNumber ?? 1,
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

function buildCategoryTags(
  candidateId: string,
  candidate: PipelineCandidateArtifact,
  evidenceId?: string,
): ResourceTag[] {
  return candidate.categoryTags.map((tag) => ({
    id: crypto.randomUUID(),
    candidateId,
    tagType: 'category',
    tagValue: tag.tagValue,
    tagConfidence: tag.confidence,
    assignedBy: 'agent',
    evidenceRefs: evidenceId ? [evidenceId] : [],
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
    id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
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
    id: crypto.randomUUID(),
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
        id: crypto.randomUUID(),
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
): Promise<ResourceTag[]> {
  return stores.tags.replaceByType(candidateId, 'candidate', tagType, tags);
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

async function persistEvidenceArtifact(
  stores: IngestionStores,
  execution: DetailedPipelineExecution,
  options: MaterializePipelineArtifactsOptions,
): Promise<void> {
  const { evidence } = execution.artifacts;
  if (!evidence) return;

  const existingEvidence = await stores.evidence.getById(evidence.evidenceId);
  if (existingEvidence) return;

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

async function materializePipelineArtifactsInTransaction(
  stores: IngestionStores,
  execution: DetailedPipelineExecution,
  options: MaterializePipelineArtifactsOptions,
): Promise<MaterializePipelineArtifactsResult> {
  const { evidence, candidate } = execution.artifacts;

  if (!candidate) {
    await persistEvidenceArtifact(stores, execution, options);
    return {
      evidenceId: evidence?.evidenceId,
      deduped: false,
    };
  }

  const hasLockedLineageLookup = typeof stores.candidates.lockMaterializationTarget === 'function';
  const lockedTarget = hasLockedLineageLookup
    ? await stores.candidates.lockMaterializationTarget({
        extractKey: candidate.extractKeySha256,
        orgName: candidate.organizationName,
        serviceName: candidate.serviceName,
        canonicalUrl: evidence?.canonicalUrl ?? candidate.websiteUrl,
        address: candidate.address,
      })
    : null;
  const existingCandidate = lockedTarget?.candidate
    ?? await stores.candidates.getByExtractKey(candidate.extractKeySha256);
  const exactExtractKeyMatch = lockedTarget?.exactExtractKey ?? Boolean(existingCandidate);

  // LB6: Cross-path dedup — if no exact extractKey match, try normalized name match
  // to catch duplicates from different intake paths (web scrape vs HSDS API vs CSV).
  const crossPathMatch = existingCandidate || hasLockedLineageLookup
    ? null
    : await stores.candidates.findByNormalizedName(
        candidate.organizationName,
        candidate.serviceName,
      );

  const deduplicatedCandidate = existingCandidate ?? crossPathMatch;
  // An exact key can belong to an older revision. Once the lineage lookup has
  // locked a newer head, replaying that historical payload is stale input, not
  // a mutation of the head. Return the current head without persisting the old
  // fields, extraction identity, evidence, checks, tags, or provenance.
  if (
    (lockedTarget?.historicalExtractReplay || exactExtractKeyMatch)
    && deduplicatedCandidate
    && (
      lockedTarget?.historicalExtractReplay
      || IMMUTABLE_REVIEW_STATUSES.has(deduplicatedCandidate.review.status)
    )
  ) {
    return {
      candidateId: deduplicatedCandidate.candidateId,
      evidenceId: evidence?.evidenceId,
      deduped: true,
      assignedToRole: deduplicatedCandidate.review.assignedToRole,
      reviewStatus: deduplicatedCandidate.review.status,
      ...(lockedTarget?.lineageAvailable === false
        ? {}
        : {
            revisionOfCandidateId: deduplicatedCandidate.revisionOfCandidateId,
            lineageRootCandidateId:
              deduplicatedCandidate.lineageRootCandidateId ?? deduplicatedCandidate.candidateId,
            revisionNumber: deduplicatedCandidate.revisionNumber ?? 1,
          }),
    };
  }

  const createsRevision = Boolean(
    deduplicatedCandidate
      && IMMUTABLE_REVIEW_STATUSES.has(deduplicatedCandidate.review.status),
  );
  if (createsRevision && lockedTarget?.lineageAvailable === false) {
    throw new Error('Candidate revision lineage is not provisioned yet');
  }
  // A terminal candidate is durable authorization evidence. Re-extraction
  // appends a child revision with fresh identities and never edits that row.
  const candidateId = createsRevision ? crypto.randomUUID() : deduplicatedCandidate?.candidateId ?? candidate.candidateId;
  const existingConfirmations = await stores.tagConfirmations.listForCandidate(candidateId);
  if (
    deduplicatedCandidate
    && !createsRevision
    && existingConfirmations.some(
      (confirmation) => confirmation.confirmationStatus !== 'pending',
    )
  ) {
    throw new Error(
      'Candidate has reviewed tag evidence; re-extraction requires a new revision',
    );
  }

  await persistEvidenceArtifact(stores, execution, options);
  // The pipeline already minted this execution's extraction identity. Keep it
  // so verification checks and provenance remain attached to the child.
  const extractionId = candidate.extractionId;
  const assignedToRole = determineReviewRole(candidate);
  const reviewStatus = determineReviewStatus(
    candidate,
    assignedToRole,
    createsRevision ? undefined : deduplicatedCandidate?.review.status,
  );
  // Candidate inserts must always begin as pending. Escalation is a distinct,
  // database-owned transition so callers cannot manufacture reviewed evidence
  // in the same INSERT that creates the candidate identity.
  const persistedReviewStatus = reviewStatus === 'escalated' ? 'pending' : reviewStatus;
  const revisionOfCandidateId = createsRevision
    ? deduplicatedCandidate?.candidateId
    : deduplicatedCandidate?.revisionOfCandidateId;
  const revisionNumber = createsRevision
    ? (deduplicatedCandidate?.revisionNumber ?? 1) + 1
    : deduplicatedCandidate?.revisionNumber ?? 1;
  const lineageRootCandidateId = createsRevision
    ? deduplicatedCandidate?.lineageRootCandidateId ?? deduplicatedCandidate?.candidateId
    : deduplicatedCandidate?.lineageRootCandidateId ?? candidateId;

  const candidateRecord = buildCandidateRecord(candidate, {
    candidateId,
    evidenceId: evidence?.evidenceId,
    canonicalUrl: evidence?.canonicalUrl,
    jobId: options.jobId,
    correlationId: options.correlationId,
    assignedToRole,
    reviewStatus: persistedReviewStatus,
    extractionId,
    revisionOfCandidateId,
    lineageRootCandidateId,
    revisionNumber,
  });

  if (deduplicatedCandidate && !createsRevision) {
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

  const categoryTags = buildCategoryTags(candidateId, candidate, evidence?.evidenceId);
  const geographicTags = buildGeographicTags(candidateId, candidate);
  const sourceQualityTags = buildSourceQualityTags(candidateId, candidate, evidence?.canonicalUrl);
  const verificationTags = buildVerificationTags(candidateId, candidate, reviewStatus);

  const persistedCategoryTags = await replaceTagType(
    stores,
    candidateId,
    'category',
    categoryTags,
  );
  const persistedGeographicTags = await replaceTagType(
    stores,
    candidateId,
    'geographic',
    geographicTags,
  );
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

  const newConfirmations = persistedCategoryTags
    .filter((tag) => tag.tagConfidence < AUTO_APPROVE_TAG_CONFIDENCE)
    .map((tag) =>
      createTagConfirmation(candidateId, 'category', tag.tagValue, tag.tagConfidence, {
        resourceTagId: tag.id,
        evidenceRefs: tag.evidenceRefs,
      }),
    );

  await stores.tagConfirmations.replacePendingForCandidate(
    candidateId,
    'category',
    newConfirmations,
  );

  const pendingTagCount =
    existingConfirmations.filter(
      (confirmation) => confirmation.tagType !== 'category'
        && confirmation.confirmationStatus === 'pending',
    ).length + newConfirmations.length;

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
      categoryTags: persistedCategoryTags,
      geographicTags: persistedGeographicTags,
      pendingTagCount,
    }),
  );

  // Production routing is database-owned so concurrent candidates cannot
  // over-allocate a reviewer and a candidate never self-asserts approval.
  let routedReviewerCount: number | null = null;
  if (stores.assignments?.routeForReview) {
    routedReviewerCount = await stores.assignments.routeForReview(candidateId, 5);
  }
  const reviewerCapacityExhausted =
    routedReviewerCount !== null && routedReviewerCount < 2;
  const shouldEscalate = reviewStatus === 'escalated' || reviewerCapacityExhausted;
  if (shouldEscalate) {
    await stores.candidates.escalateForReview(candidateId);
  }
  const effectiveReviewStatus = shouldEscalate ? 'escalated' : reviewStatus;
  const effectiveAssignedToRole = shouldEscalate ? 'oran_admin' : assignedToRole;

  return {
    candidateId,
    evidenceId: evidence?.evidenceId,
    deduped: Boolean(deduplicatedCandidate),
    assignedToRole: effectiveAssignedToRole,
    reviewStatus: effectiveReviewStatus,
    ...(createsRevision
      ? { revisionOfCandidateId, lineageRootCandidateId, revisionNumber }
      : {}),
  };
}

export async function materializePipelineArtifacts(
  stores: IngestionStores,
  execution: DetailedPipelineExecution,
  options: MaterializePipelineArtifactsOptions,
): Promise<MaterializePipelineArtifactsResult> {
  if (stores.runAtomically) {
    return stores.runAtomically((transactionStores) => (
      materializePipelineArtifactsInTransaction(transactionStores, execution, options)
    ));
  }
  return materializePipelineArtifactsInTransaction(stores, execution, options);
}
