import crypto from 'node:crypto';
import type { PoolClient } from 'pg';

import type { GeocodingResult } from '@/services/geocoding/azureMaps';
import { withTransaction } from '@/services/db/postgres';
import {
  appendLifecycleEvent,
  buildPublicationLifecycleWindow,
  replaceCurrentSnapshot,
  upsertConfidenceScore,
} from '@/services/publication/livePublication';
import { decidePublicationOverwrite } from '@/services/publication/liveAuthority';
import {
  acquireLivePublicationAdvisoryLock,
  resolveExistingLiveLocationId,
  resolveExistingLiveOrganizationId,
  resolveExistingLiveServiceId,
} from '@/services/publication/liveEntityMerge';
import {
  acquireFreshnessSensitiveAuthoritativeMutationGates,
  assertAuthoritativeEntitiesMutable,
} from '@/services/publication/protectedAuthoritativeMutation';

import type { ExtractedCandidate } from './contracts';
import type { IngestionStores } from './stores';
import { evaluateStandaloneResourceUse } from './sourcePurpose';
import {
  SourceSystemTrustTierSchema,
} from './sourceRegistry';
import type { ResourceTag } from './tags';

type AcceptedSuggestionMap = Map<string, string>;

export interface PublishCandidateToLiveOptions {
  stores: IngestionStores;
  candidateId: string;
  publishedByUserId: string;
  geocode?: (address: string) => Promise<GeocodingResult[]>;
}

export interface PublishCandidateToLiveResult {
  serviceId: string;
  organizationId: string;
  locationId?: string;
}

interface PublishableCandidate {
  organizationName: string;
  serviceName: string;
  description: string;
  websiteUrl?: string;
  phone?: string;
  address?: ExtractedCandidate['fields']['address'];
  isRemoteService: boolean;
  acceptedValues: AcceptedSuggestionMap;
}

interface LockedPublicationCandidateRow {
  candidate_id: string;
  extraction_id: string;
  extract_key_sha256: string;
  lineage_root_candidate_id: string;
  revision_number: number;
  review_status: string;
  published_service_id: string | null;
  confidence_score: number;
  organization_name: string;
  service_name: string;
  description: string | null;
  website_url: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_city: string | null;
  address_region: string | null;
  address_postal_code: string | null;
  address_country: string | null;
  is_remote_service: boolean | null;
  investigation_pack: unknown;
  updated_at: string | Date;
  is_ready: boolean;
  has_required_fields: boolean;
  has_required_tags: boolean;
  tags_confirmed: boolean;
  meets_score_threshold: boolean;
  has_admin_approval: boolean;
  pending_tag_count: number;
  admin_approval_count: number;
  blockers: unknown;
  has_newer_revision: boolean;
}

interface LockedAcceptedSuggestionRow {
  field: string;
  suggested_value: string;
  original_value: string | null;
  reviewed_by: string | null;
  reviewed_at: string | Date | null;
}

interface LockedCandidateTagRow {
  id: string;
  tag_type: string;
  tag_value: string;
  confidence: number | null;
  source: string;
  added_by: string | null;
}

interface LockedTagConfirmationRow {
  resource_tag_id: string;
  tag_type: string;
  tag_value: string;
  original_confidence: number;
  status: string;
  modified_tag_value: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | Date | null;
}

interface LockedCandidateApprovalRow {
  assignment_id: string;
  reviewer_user_id: string;
}

interface LockedPublicationSourceRow {
  id: string;
  trust_tier: string;
  resource_purpose: string | null;
  domain_rules: unknown;
  is_active: boolean;
}

function sourceRulesAllowUrl(url: string, rawRules: unknown): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  if (!Array.isArray(rawRules)) return false;
  return rawRules.some((rawRule) => {
    if (!rawRule || typeof rawRule !== 'object') return false;
    const rule = rawRule as { type?: unknown; value?: unknown };
    if (typeof rule.value !== 'string') return false;
    const value = rule.value.trim().toLowerCase().replace(/^www\./, '').replace(/^\./, '');
    if (!value) return false;
    if (rule.type === 'exact_host') return host === value;
    if (rule.type === 'suffix') return host === value || host.endsWith(`.${value}`);
    return false;
  });
}

function sourceRuleSpecificity(url: string, rawRules: unknown): number | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  if (!Array.isArray(rawRules)) return null;
  let best: number | null = null;
  for (const rawRule of rawRules) {
    if (!rawRule || typeof rawRule !== 'object') continue;
    const rule = rawRule as { type?: unknown; value?: unknown };
    if (typeof rule.value !== 'string') continue;
    const value = rule.value.trim().toLowerCase().replace(/^www\./, '').replace(/^\./, '');
    if (!value) continue;
    const matches = rule.type === 'exact_host'
      ? host === value
      : rule.type === 'suffix'
        ? host === value || host.endsWith(`.${value}`)
        : false;
    if (!matches) continue;
    const score = (rule.type === 'exact_host' ? 100_000 : 0) + value.length;
    best = best === null ? score : Math.max(best, score);
  }
  return best;
}

function readinessIsPublishable(row: LockedPublicationCandidateRow): boolean {
  return row.is_ready
    && row.has_required_fields
    && row.has_required_tags
    && row.tags_confirmed
    && row.meets_score_threshold
    && row.has_admin_approval
    && row.pending_tag_count === 0
    && Array.isArray(row.blockers)
    && row.blockers.length === 0;
}

function uniqueValues(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function applyAcceptedSuggestions(
  candidate: ExtractedCandidate,
  acceptedValues: AcceptedSuggestionMap,
): PublishableCandidate {
  return {
    organizationName: candidate.fields.organizationName,
    serviceName: acceptedValues.get('name') ?? candidate.fields.serviceName,
    description: acceptedValues.get('description') ?? candidate.fields.description,
    websiteUrl: acceptedValues.get('website') ?? candidate.fields.websiteUrl,
    phone: acceptedValues.get('phone') ?? candidate.fields.phone,
    address: candidate.fields.address,
    isRemoteService: candidate.fields.isRemoteService,
    acceptedValues,
  };
}

function dedupeTags(tags: ResourceTag[]): ResourceTag[] {
  const seen = new Set<string>();
  return tags.filter((tag) => {
    const key = `${tag.tagType}:${tag.tagValue}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function mapTagSource(source: string): ResourceTag['assignedBy'] {
  if (source === 'human' || source === 'admin') return 'human';
  if (source === 'agent' || source === 'llm') return 'agent';
  return 'system';
}

async function buildLockedServiceTags(
  client: PoolClient,
  candidateId: string,
): Promise<ResourceTag[]> {
  const candidateTags = await client.query<LockedCandidateTagRow>(
    `SELECT id, tag_type, tag_value, confidence, source, added_by
     FROM public.resource_tags
     WHERE target_id = $1
       AND target_type = 'candidate'
     ORDER BY tag_type, tag_value, id
     FOR SHARE`,
    [candidateId],
  );
  const confirmations = await client.query<LockedTagConfirmationRow>(
    `SELECT resource_tag_id, tag_type, tag_value, original_confidence, status,
            modified_tag_value, reviewed_by_user_id, reviewed_at
     FROM public.tag_confirmation_queue
     WHERE candidate_id = $1
     ORDER BY tag_type, tag_value, resource_tag_id
     FOR SHARE`,
    [candidateId],
  );

  if (confirmations.rows.some((confirmation) => confirmation.status === 'pending')) {
    throw new Error(`Candidate ${candidateId} has a pending tag confirmation`);
  }

  const confirmedByType = new Map<string, ResourceTag[]>();
  const reviewedTypes = new Set(confirmations.rows.map((confirmation) => confirmation.tag_type));
  for (const confirmation of confirmations.rows) {
    if (!['approved', 'modified'].includes(confirmation.status)) continue;
    if (!confirmation.reviewed_by_user_id || !confirmation.reviewed_at) {
      throw new Error(`Candidate ${candidateId} has unbound tag-review evidence`);
    }
    const value = confirmation.modified_tag_value ?? confirmation.tag_value;
    const current = confirmedByType.get(confirmation.tag_type) ?? [];
    current.push({
        candidateId,
        tagType: confirmation.tag_type as ResourceTag['tagType'],
        tagValue: value,
        tagConfidence: 100,
        assignedBy: 'human',
        assignedByUserId: confirmation.reviewed_by_user_id,
        evidenceRefs: [],
    });
    confirmedByType.set(confirmation.tag_type, current);
  }

  const passthrough = candidateTags.rows
    .filter((tag) => !reviewedTypes.has(tag.tag_type))
    .map((tag): ResourceTag => ({
      candidateId,
      tagType: tag.tag_type as ResourceTag['tagType'],
      tagValue: tag.tag_value,
      tagConfidence: tag.confidence ?? 100,
      assignedBy: mapTagSource(tag.source),
      assignedByUserId: tag.added_by ?? undefined,
      evidenceRefs: [],
    }));

  return dedupeTags([
    ...passthrough,
    ...Array.from(confirmedByType.values()).flat(),
  ]);
}

function rowToCandidate(row: LockedPublicationCandidateRow): ExtractedCandidate {
  const investigation = row.investigation_pack
    && typeof row.investigation_pack === 'object'
    && !Array.isArray(row.investigation_pack)
    ? row.investigation_pack as ExtractedCandidate['investigation']
    : undefined;
  return {
    extractionId: row.extraction_id,
    candidateId: row.candidate_id,
    extractKeySha256: row.extract_key_sha256,
    extractedAt: new Date(row.updated_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    lineageRootCandidateId: row.lineage_root_candidate_id,
    revisionNumber: row.revision_number,
    review: { status: row.review_status as ExtractedCandidate['review']['status'], timers: {}, tags: [], checklist: [] },
    fields: {
      organizationName: row.organization_name,
      serviceName: row.service_name,
      description: row.description ?? '',
      websiteUrl: row.website_url ?? undefined,
      phone: row.phone ?? undefined,
      address: row.address_line1
        ? {
            line1: row.address_line1,
            line2: row.address_line2 ?? undefined,
            city: row.address_city ?? '',
            region: row.address_region ?? '',
            postalCode: row.address_postal_code ?? '',
            country: row.address_country ?? 'US',
          }
        : undefined,
      isRemoteService: row.is_remote_service ?? false,
    },
    investigation,
    provenance: {},
  };
}

function buildServiceAttributes(candidate: PublishableCandidate): Array<{ taxonomy: string; tag: string }> {
  return uniqueValues([
    candidate.isRemoteService ? 'virtual' : undefined,
    candidate.address ? 'in_person' : undefined,
    candidate.phone ? 'phone' : undefined,
  ]).map((tag) => ({
    taxonomy: 'delivery',
    tag,
  }));
}

function buildHsdsPayload(input: {
  candidateId: string;
  organizationId: string;
  serviceId: string;
  locationId?: string;
  candidate: PublishableCandidate;
  resourceTags: ResourceTag[];
  confidenceScore: number;
  sourceSystemId: string;
  approvalReviewerIds: string[];
  geocodeResult?: GeocodingResult;
}): Record<string, unknown> {
  return {
    meta: {
      generatedBy: 'oran-ingestion-publish',
      generatedAt: new Date().toISOString(),
      sourceCandidateId: input.candidateId,
      sourceSystemId: input.sourceSystemId,
      publicationSourceKind: 'candidate_two_person_authoritative',
      approvalCount: input.approvalReviewerIds.length,
      oranTags: input.resourceTags.map((tag) => ({
        type: tag.tagType,
        value: tag.tagValue,
        confidence: tag.tagConfidence,
      })),
    },
    organization: {
      id: input.organizationId,
      name: input.candidate.organizationName,
      description: input.candidate.description,
      url: input.candidate.websiteUrl ?? null,
      phone: input.candidate.phone ?? null,
    },
    service: {
      id: input.serviceId,
      organizationId: input.organizationId,
      name: input.candidate.serviceName,
      description: input.candidate.description,
      url: input.candidate.websiteUrl ?? null,
      status: 'active',
      confidenceScore: input.confidenceScore,
    },
    location: input.locationId
      ? {
          id: input.locationId,
          address: input.candidate.address ?? null,
          latitude: input.geocodeResult?.lat ?? null,
          longitude: input.geocodeResult?.lon ?? null,
        }
      : null,
  };
}

function buildAddressString(address: NonNullable<ExtractedCandidate['fields']['address']>): string {
  return [
    address.line1,
    address.city,
    address.region,
    address.postalCode,
    address.country,
  ]
    .filter(Boolean)
    .join(', ');
}

export async function publishCandidateToLiveService(
  options: PublishCandidateToLiveOptions,
): Promise<PublishCandidateToLiveResult> {
  // The only pre-transaction read is a non-authoritative geocoding hint. The
  // candidate is re-read and version-bound under lock before any result is
  // accepted or any live row is touched.
  const geocodingHint = await options.stores.candidates.getById(options.candidateId);
  if (!geocodingHint) {
    throw new Error(`Candidate ${options.candidateId} not found`);
  }
  let confidenceScore = 0;

  let geocodeResult: GeocodingResult | undefined;
  const geocodingAddress = geocodingHint.fields.address?.line1
    ? buildAddressString(geocodingHint.fields.address)
    : null;
  if (options.geocode && geocodingAddress) {
    try {
      geocodeResult = (await options.geocode(geocodingAddress))[0];
    } catch (error) {
      console.warn(
        '[publish] Geocoding failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  let publicationWindow = buildPublicationLifecycleWindow(confidenceScore);
  let organizationId = '';
  let serviceId = '';
  let locationId: string | undefined;

  await withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await acquireFreshnessSensitiveAuthoritativeMutationGates(client);

    const lockedCandidate = await client.query<LockedPublicationCandidateRow>(
      `SELECT candidate.candidate_id,
              candidate.extraction_id,
              candidate.extract_key_sha256,
              candidate.lineage_root_candidate_id,
              candidate.revision_number,
              candidate.review_status,
              candidate.published_service_id,
              candidate.confidence_score,
              candidate.organization_name,
              candidate.service_name,
              candidate.description,
              candidate.website_url,
              candidate.phone,
              candidate.address_line1,
              candidate.address_line2,
              candidate.address_city,
              candidate.address_region,
              candidate.address_postal_code,
              candidate.address_country,
              candidate.is_remote_service,
              candidate.investigation_pack,
              candidate.updated_at,
              readiness.is_ready,
              readiness.has_required_fields,
              readiness.has_required_tags,
              readiness.tags_confirmed,
              readiness.meets_score_threshold,
              readiness.has_admin_approval,
              readiness.pending_tag_count,
              readiness.admin_approval_count,
              readiness.blockers,
              EXISTS (
                SELECT 1
                FROM extracted_candidates newer_revision
                WHERE newer_revision.lineage_root_candidate_id = candidate.lineage_root_candidate_id
                  AND newer_revision.revision_number > candidate.revision_number
              ) AS has_newer_revision
       FROM extracted_candidates candidate
       JOIN candidate_readiness readiness
         ON readiness.candidate_id = candidate.candidate_id
       WHERE candidate.candidate_id = $1
       FOR UPDATE OF candidate, readiness`,
      [options.candidateId],
    );
    const locked = lockedCandidate.rows[0];
    if (!locked) {
      throw new Error(`Candidate ${options.candidateId} has no locked readiness evidence`);
    }
    if (
      locked.review_status !== 'verified'
      || locked.published_service_id !== null
      || locked.has_newer_revision
    ) {
      throw new Error(`Candidate ${options.candidateId} is not the current unpublished verified revision`);
    }
    if (!readinessIsPublishable(locked)) {
      throw new Error(`Candidate ${options.candidateId} no longer meets publish readiness`);
    }
    confidenceScore = locked.confidence_score;
    publicationWindow = buildPublicationLifecycleWindow(confidenceScore);

    const publisher = await client.query<{ role: string; account_status: string | null }>(
      `SELECT role, account_status
       FROM public.user_profiles
       WHERE user_id = $1
       FOR SHARE`,
      [options.publishedByUserId],
    );
    if (
      publisher.rows[0]?.role !== 'oran_admin'
      || (publisher.rows[0]?.account_status ?? 'active') !== 'active'
    ) {
      throw new Error('Only an active ORAN administrator may publish a candidate');
    }

    const acceptedSuggestionRows = await client.query<LockedAcceptedSuggestionRow>(
      `SELECT field, suggested_value, original_value, reviewed_by, reviewed_at
       FROM public.llm_suggestions
       WHERE candidate_id = $1
         AND status = 'accepted'
       ORDER BY reviewed_at NULLS FIRST, created_at, id
       FOR SHARE`,
      [options.candidateId],
    );
    const acceptedValues: AcceptedSuggestionMap = new Map();
    for (const suggestion of acceptedSuggestionRows.rows) {
      if (!suggestion.reviewed_by || !suggestion.reviewed_at) {
        throw new Error(`Candidate ${options.candidateId} has unbound accepted LLM evidence`);
      }
      acceptedValues.set(suggestion.field, suggestion.original_value ?? suggestion.suggested_value);
    }

    const resourceTags = await buildLockedServiceTags(client, options.candidateId);

    const approvalRows = await client.query<LockedCandidateApprovalRow>(
      `SELECT approval.id AS assignment_id,
              approval.decision_reviewer_user_id AS reviewer_user_id
       FROM public.candidate_admin_assignments approval
       WHERE approval.candidate_id = $1
         AND approval.status = 'completed'
         AND approval.outcome = 'verified'
       ORDER BY approval.decision_reviewer_user_id, approval.id
       FOR SHARE OF approval`,
      [options.candidateId],
    );
    const approvalReviewerIds = uniqueValues(
      approvalRows.rows.map((approval) => approval.reviewer_user_id),
    ).sort();
    if (
      approvalReviewerIds.length < 2
      || locked.admin_approval_count !== approvalReviewerIds.length
    ) {
      throw new Error(`Candidate ${options.candidateId} lacks two version-bound independent approvals`);
    }

    const candidate = rowToCandidate(locked);
    const publishable = applyAcceptedSuggestions(candidate, acceptedValues);
    const currentAddress = publishable.address?.line1
      ? buildAddressString(publishable.address)
      : null;
    if (currentAddress !== geocodingAddress) {
      geocodeResult = undefined;
    }
    const serviceAttributes = buildServiceAttributes(publishable);

    const canonicalUrl = candidate.investigation?.canonicalUrl;
    if (!canonicalUrl) {
      throw new Error(`Candidate ${options.candidateId} has no canonical source URL`);
    }

    const lockedSources = await client.query<LockedPublicationSourceRow>(
      `SELECT id, trust_tier, resource_purpose, domain_rules, is_active
       FROM public.source_systems
       WHERE is_active IS TRUE
       ORDER BY id
       FOR SHARE`,
      [],
    );
    const currentSource = lockedSources.rows
      .map((source) => ({ source, specificity: sourceRuleSpecificity(canonicalUrl, source.domain_rules) }))
      .filter((match): match is { source: LockedPublicationSourceRow; specificity: number } => (
        match.specificity !== null
      ))
      .sort((left, right) => (
        right.specificity - left.specificity || left.source.id.localeCompare(right.source.id)
      ))[0]?.source;
    const parsedTrustTier = SourceSystemTrustTierSchema.safeParse(currentSource?.trust_tier);
    if (
      !currentSource
      || !currentSource.is_active
      || !parsedTrustTier.success
      || !['verified_publisher', 'trusted_partner', 'curated', 'community'].includes(parsedTrustTier.data)
      || !sourceRulesAllowUrl(canonicalUrl, currentSource.domain_rules)
    ) {
      throw new Error(`Candidate ${options.candidateId} has no active authoritative source match`);
    }
    const currentPurposeDecision = evaluateStandaloneResourceUse({
      resourcePurpose: currentSource.resource_purpose,
    });
    if (!currentPurposeDecision.allowed) {
      throw new Error(
        `Candidate ${options.candidateId} cannot be published: ${currentPurposeDecision.reason}`,
      );
    }
    const sourceId = currentSource.id;

    await acquireLivePublicationAdvisoryLock(client, {
      organizationName: publishable.organizationName,
      organizationUrl: publishable.websiteUrl,
      serviceName: publishable.serviceName,
      serviceUrl: publishable.websiteUrl,
    });

    const matchedOrganizationId = await resolveExistingLiveOrganizationId(client, {
      organizationName: publishable.organizationName,
      organizationUrl: publishable.websiteUrl,
    });
    organizationId = matchedOrganizationId ?? crypto.randomUUID();

    const matchedServiceId = await resolveExistingLiveServiceId(client, organizationId, {
      serviceName: publishable.serviceName,
      serviceUrl: publishable.websiteUrl,
    });
    serviceId = matchedServiceId ?? crypto.randomUUID();

    await assertAuthoritativeEntitiesMutable(client, {
      organizationIds: [matchedOrganizationId],
      serviceIds: [matchedServiceId],
      sourceSystemIds: [sourceId],
    });

    const overwriteDecision = matchedServiceId
      ? await decidePublicationOverwrite(client, serviceId, 'candidate_two_person_authoritative')
      : null;
    const shouldOverwriteExisting = overwriteDecision?.shouldOverwrite ?? true;

    if (matchedOrganizationId && shouldOverwriteExisting) {
      const updatedOrganization = await client.query<{ id: string }>(
        `UPDATE organizations
            SET name = COALESCE(NULLIF($2, ''), name),
                description = COALESCE(NULLIF($3, ''), description),
                url = COALESCE(NULLIF($4, ''), url),
                phone = COALESCE(NULLIF($5, ''), phone),
                updated_at = NOW()
          WHERE id = $1
            AND status = 'active'
        RETURNING id`,
        [
          organizationId,
          publishable.organizationName,
          publishable.description,
          publishable.websiteUrl ?? null,
          publishable.phone ?? null,
        ],
      );
      if (!updatedOrganization.rows[0]) {
        throw new Error('Matched organization was retired during publication');
      }
    } else if (!matchedOrganizationId) {
      await client.query(
        `INSERT INTO organizations
           (id, name, description, url, phone, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [
          organizationId,
          publishable.organizationName,
          publishable.description,
          publishable.websiteUrl ?? null,
          publishable.phone ?? null,
        ],
      );
    }

    const mergedServiceTags = resourceTags.map((tag) => ({
      ...tag,
      serviceId,
      candidateId: undefined,
    }));

    if (matchedServiceId && shouldOverwriteExisting) {
      const updatedService = await client.query<{ id: string }>(
        `UPDATE services
            SET organization_id = $2,
                name = COALESCE(NULLIF($3, ''), name),
                description = COALESCE(NULLIF($4, ''), description),
                url = COALESCE(NULLIF($5, ''), url),
                status = 'active',
                application_process = COALESCE(NULLIF($6, ''), application_process),
                fees = COALESCE(NULLIF($7, ''), fees),
                updated_at = NOW()
          WHERE id = $1
            AND status = 'active'
            AND organization_id = $2
        RETURNING id`,
        [
          serviceId,
          organizationId,
          publishable.serviceName,
          publishable.description,
          publishable.websiteUrl ?? null,
          publishable.acceptedValues.get('intake_process') ?? null,
          publishable.acceptedValues.get('fees') ?? null,
        ],
      );
      if (!updatedService.rows[0]) {
        throw new Error('Matched service was retired during publication');
      }
    } else if (!matchedServiceId) {
      await client.query(
        `INSERT INTO services
           (id, organization_id, name, description, url, status, application_process, fees, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, NOW(), NOW())`,
        [
          serviceId,
          organizationId,
          publishable.serviceName,
          publishable.description,
          publishable.websiteUrl ?? null,
          publishable.acceptedValues.get('intake_process') ?? null,
          publishable.acceptedValues.get('fees') ?? null,
        ],
      );
    }

    const hsdsPayload = buildHsdsPayload({
      candidateId: options.candidateId,
      organizationId,
      serviceId,
      locationId: undefined,
      candidate: publishable,
      resourceTags: mergedServiceTags,
      confidenceScore,
      sourceSystemId: sourceId,
      approvalReviewerIds,
      geocodeResult,
    });

    if (shouldOverwriteExisting && (publishable.address || geocodeResult)) {
      const matchedLocationId = await resolveExistingLiveLocationId(client, serviceId, {
        name: publishable.serviceName,
        address1: publishable.address?.line1,
        city: publishable.address?.city,
        region: publishable.address?.region,
        postalCode: publishable.address?.postalCode,
        country: publishable.address?.country,
      });
      locationId = matchedLocationId ?? crypto.randomUUID();

      if (matchedLocationId) {
        await assertAuthoritativeEntitiesMutable(client, {
          locationIds: [matchedLocationId],
        });
        await client.query(
          `UPDATE locations
              SET organization_id = $2,
                  name = COALESCE(NULLIF($3, ''), name),
                  latitude = COALESCE($4, latitude),
                  longitude = COALESCE($5, longitude),
                  updated_at = NOW()
            WHERE id = $1`,
          [
            locationId,
            organizationId,
            publishable.serviceName,
            geocodeResult?.lat ?? null,
            geocodeResult?.lon ?? null,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO locations
             (id, organization_id, name, latitude, longitude, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
          [
            locationId,
            organizationId,
            publishable.serviceName,
            geocodeResult?.lat ?? null,
            geocodeResult?.lon ?? null,
          ],
        );
      }

      await client.query(
        `INSERT INTO service_at_location (service_id, location_id, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (service_id, location_id) DO NOTHING`,
        [serviceId, locationId],
      );

      if (publishable.address) {
        await client.query(`DELETE FROM addresses WHERE location_id = $1`, [locationId]);
        await client.query(
          `INSERT INTO addresses
             (location_id, address_1, address_2, city, region, state_province, postal_code, country)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $7)`,
          [
            locationId,
            publishable.address.line1,
            publishable.address.line2 ?? null,
            publishable.address.city,
            publishable.address.region,
            publishable.address.postalCode,
            publishable.address.country,
          ],
        );
      }

      Object.assign(hsdsPayload, {
        location: {
          id: locationId,
          address: publishable.address ?? null,
          latitude: geocodeResult?.lat ?? null,
          longitude: geocodeResult?.lon ?? null,
        },
      });
    }

    if (shouldOverwriteExisting && publishable.phone) {
      await client.query(
        `DELETE FROM phones
          WHERE service_id = $1
            AND regexp_replace(number, '\\D', '', 'g') = regexp_replace($2, '\\D', '', 'g')`,
        [serviceId, publishable.phone],
      );
      await client.query(
        `INSERT INTO phones
           (service_id, organization_id, location_id, number, type)
         VALUES ($1, $2, $3, $4, 'voice')`,
        [serviceId, organizationId, locationId ?? null, publishable.phone],
      );
    }

    if (shouldOverwriteExisting) {
      await upsertConfidenceScore(client, {
        serviceId,
        score: confidenceScore,
      });
    }

    if (shouldOverwriteExisting && mergedServiceTags.length > 0) {
      const tagValuesSql: string[] = [];
      const tagParams: unknown[] = [];
      mergedServiceTags.forEach((tag, index) => {
        const offset = index * 6;
        tagValuesSql.push(
          `($${offset + 1}, 'service', $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`,
        );
        tagParams.push(
          serviceId,
          tag.tagType,
          tag.tagValue,
          tag.tagConfidence ?? 100,
          tag.assignedBy ?? 'system',
          tag.assignedByUserId ?? null,
        );
      });

      await client.query(
        `INSERT INTO resource_tags
           (target_id, target_type, tag_type, tag_value, confidence, source, added_by)
         VALUES ${tagValuesSql.join(', ')}
         ON CONFLICT (target_id, target_type, tag_type, tag_value) DO NOTHING`,
        tagParams,
      );
    }

    if (shouldOverwriteExisting && serviceAttributes.length > 0) {
      const attributeValuesSql: string[] = [];
      const attributeParams: unknown[] = [];
      serviceAttributes.forEach((attribute, index) => {
        const offset = index * 3;
        attributeValuesSql.push(`($${offset + 1}, $${offset + 2}, $${offset + 3})`);
        attributeParams.push(serviceId, attribute.taxonomy, attribute.tag);
      });

      await client.query(
        `INSERT INTO service_attributes (service_id, taxonomy, tag)
         VALUES ${attributeValuesSql.join(', ')}
         ON CONFLICT (service_id, taxonomy, tag) DO NOTHING`,
        attributeParams,
      );
    }

    const categoryTags = uniqueValues(
      mergedServiceTags
        .filter((tag) => tag.tagType === 'category')
        .map((tag) => tag.tagValue),
    );
    if (shouldOverwriteExisting && categoryTags.length > 0) {
      await client.query(
        `INSERT INTO service_taxonomy (service_id, taxonomy_term_id)
         SELECT $1, tt.id
         FROM taxonomy_terms tt
         WHERE LOWER(tt.term) = ANY($2::text[])
         ON CONFLICT (service_id, taxonomy_term_id) DO NOTHING`,
        [serviceId, categoryTags],
      );
    }

    const publishedCandidate = await client.query<{ candidate_id: string }>(
      `UPDATE extracted_candidates publication_candidate
       SET review_status = 'published',
           published_service_id = $2,
           published_at = NOW(),
           published_by_user_id = $3,
           last_verified_at = $4::timestamptz,
           reverify_at = $5::timestamptz,
           updated_at = NOW()
       WHERE candidate_id = $1
         AND review_status = 'verified'
         AND published_service_id IS NULL
         AND updated_at = $6::timestamptz
         AND extraction_id = $7
         AND extract_key_sha256 = $8
         AND lineage_root_candidate_id = $9
         AND revision_number = $10
         AND NOT EXISTS (
           SELECT 1
           FROM extracted_candidates newer_revision
           WHERE newer_revision.lineage_root_candidate_id = publication_candidate.lineage_root_candidate_id
             AND newer_revision.revision_number > publication_candidate.revision_number
         )
       RETURNING candidate_id`,
      [
        options.candidateId,
        serviceId,
        options.publishedByUserId,
        publicationWindow.lastVerifiedAt,
        publicationWindow.reverifyAt,
        new Date(locked.updated_at).toISOString(),
        locked.extraction_id,
        locked.extract_key_sha256,
        locked.lineage_root_candidate_id,
        locked.revision_number,
      ],
    );
    if (!publishedCandidate.rows[0]) {
      throw new Error(`Candidate ${options.candidateId} publication claim was lost`);
    }

    await client.query(
      `INSERT INTO ingestion_audit_events
         (candidate_id, event_type, actor_type, actor_id, details)
       VALUES ($1, 'publish.approved', 'human', $2, $3::jsonb)`,
      [
        options.candidateId,
        options.publishedByUserId,
        JSON.stringify({
          eventId: crypto.randomUUID(),
          correlationId: crypto.randomUUID(),
          targetType: 'candidate',
          inputs: {
            extractionId: locked.extraction_id,
            lineageRootCandidateId: locked.lineage_root_candidate_id,
            revisionNumber: locked.revision_number,
            sourceSystemId: sourceId,
            approvalReviewerIds,
          },
          outputs: { serviceId, organizationId, locationId },
          evidenceRefs: [],
          timestamp: new Date().toISOString(),
        }),
      ],
    );

    await client.query(
      `UPDATE verified_service_links
       SET service_id = $2,
           updated_at = NOW()
       WHERE candidate_id = $1`,
      [options.candidateId, serviceId],
    );

    await client.query(
      `UPDATE candidate_admin_assignments
       SET status = 'reassigned',
           updated_at = NOW()
       WHERE candidate_id = $1
         AND status IN ('pending', 'claimed')`,
      [options.candidateId],
    );

    await client.query(
      `INSERT INTO entity_identifiers
         (entity_type, entity_id, identifier_scheme, identifier_value, is_primary, confidence, status, status_changed_at, created_at, updated_at)
       VALUES ('service', $1, 'oran_service_id', $2, true, 100, 'active', NOW(), NOW(), NOW())
       ON CONFLICT (entity_type, entity_id, identifier_scheme, identifier_value) DO NOTHING`,
      [serviceId, serviceId],
    );

    if (shouldOverwriteExisting) {
      await replaceCurrentSnapshot(client, {
        entityType: 'service',
        entityId: serviceId,
        hsdsPayload,
        replaceCurrent: Boolean(matchedServiceId),
      });
    }

    await appendLifecycleEvent(client, {
      entityType: 'service',
      entityId: serviceId,
      eventType: shouldOverwriteExisting
        ? matchedServiceId ? 'republished' : 'published'
        : 'linked_existing',
      fromStatus: shouldOverwriteExisting
        ? matchedServiceId ? 'published' : 'candidate'
        : 'published',
      toStatus: 'published',
      actorType: 'human',
      actorId: options.publishedByUserId,
      metadata: {
        candidateId: options.candidateId,
        organizationId,
        locationId,
        confidenceScore: publicationWindow.confidenceScore,
        confidenceTier: publicationWindow.confidenceTier,
        reverifyAt: publicationWindow.reverifyAt,
        overwriteSuppressed: !shouldOverwriteExisting,
        authorityReason: overwriteDecision?.reason ?? null,
        currentAuthority: overwriteDecision?.current?.sourceKind ?? null,
        incomingAuthority: 'candidate_two_person_authoritative',
      },
      identifiersAffected: 1,
      snapshotsInvalidated: shouldOverwriteExisting && matchedServiceId ? 1 : 0,
    });

    if (geocodeResult) {
      await client.query(
        `UPDATE extracted_candidates
         SET investigation_pack = investigation_pack || $2::jsonb
         WHERE candidate_id = $1`,
        [
          options.candidateId,
          JSON.stringify({
            geocodedLat: geocodeResult.lat,
            geocodedLon: geocodeResult.lon,
            geocodedAddress: geocodeResult.formattedAddress,
            geocodedConfidence: geocodeResult.confidence,
          }),
        ],
      );
    }
  });

  return {
    serviceId,
    organizationId,
    locationId,
  };
}
