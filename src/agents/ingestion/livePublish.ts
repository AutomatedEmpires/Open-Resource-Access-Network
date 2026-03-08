import crypto from 'node:crypto';

import type { GeocodingResult } from '@/services/geocoding/azureMaps';
import { withTransaction } from '@/services/db/postgres';

import type { ExtractedCandidate } from './contracts';
import type { IngestionStores } from './stores';
import type { ResourceTag } from './tags';

const HSDS_PROFILE_URI = 'https://openreferral.org/imls/hsds/';

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

async function buildServiceTags(
  stores: IngestionStores,
  candidateId: string,
): Promise<ResourceTag[]> {
  const candidateTags = await stores.tags.listFor(candidateId, 'candidate');
  const confirmedTags = await stores.tagConfirmations.listConfirmed(candidateId);

  const confirmedByType = new Map<string, ResourceTag[]>();
  for (const confirmation of confirmedTags) {
    const value = confirmation.confirmedValue ?? confirmation.suggestedValue;
    const isHumanConfirmed =
      confirmation.confirmationStatus === 'confirmed' ||
      confirmation.confirmationStatus === 'modified';
      const current = confirmedByType.get(confirmation.tagType) ?? [];
    current.push({
        tagType: confirmation.tagType,
        tagValue: value,
        tagConfidence:
          confirmation.confirmedConfidence ?? confirmation.suggestedConfidence,
        assignedBy: isHumanConfirmed ? 'human' : 'agent',
        assignedByUserId: confirmation.reviewedByUserId,
        evidenceRefs: confirmation.evidenceRefs ?? [],
      });
    confirmedByType.set(confirmation.tagType, current);
  }

  const passthrough = candidateTags
    .filter((tag) => !confirmedByType.has(tag.tagType))
    .map((tag) => ({
      tagType: tag.tagType,
      tagValue: tag.tagValue,
      tagConfidence: tag.tagConfidence,
      assignedBy: tag.assignedBy,
      assignedByUserId: tag.assignedByUserId,
      evidenceRefs: tag.evidenceRefs ?? [],
    }));

  return dedupeTags([
    ...passthrough,
    ...Array.from(confirmedByType.values()).flat(),
  ]);
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
  geocodeResult?: GeocodingResult;
}): Record<string, unknown> {
  return {
    meta: {
      generatedBy: 'oran-ingestion-publish',
      generatedAt: new Date().toISOString(),
      sourceCandidateId: input.candidateId,
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
  const candidate = await options.stores.candidates.getById(options.candidateId);
  if (!candidate) {
    throw new Error(`Candidate ${options.candidateId} not found`);
  }

  const readiness = await options.stores.publishReadiness.getReadiness(options.candidateId);
  const acceptedValues = await options.stores.llmSuggestions.getAcceptedValues(options.candidateId);
  const resourceTags = await buildServiceTags(options.stores, options.candidateId);

  const publishable = applyAcceptedSuggestions(candidate, acceptedValues);
  const confidenceScore = readiness?.confidenceScore ?? 0;

  let geocodeResult: GeocodingResult | undefined;
  if (options.geocode && publishable.address?.line1) {
    try {
      geocodeResult = (await options.geocode(buildAddressString(publishable.address)))[0];
    } catch (error) {
      console.warn(
        '[publish] Geocoding failed (non-fatal):',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  const organizationId = crypto.randomUUID();
  const serviceId = crypto.randomUUID();
  const locationId = publishable.address || geocodeResult ? crypto.randomUUID() : undefined;
  const mergedServiceTags = resourceTags.map((tag) => ({
    ...tag,
    serviceId,
    candidateId: undefined,
  }));
  const serviceAttributes = buildServiceAttributes(publishable);
  const hsdsPayload = buildHsdsPayload({
    candidateId: options.candidateId,
    organizationId,
    serviceId,
    locationId,
    candidate: publishable,
    resourceTags: mergedServiceTags,
    confidenceScore,
    geocodeResult,
  });
  const snapshotVersion = 1;

  await withTransaction(async (client) => {
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

    if (locationId) {
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

      await client.query(
        `INSERT INTO service_at_location (service_id, location_id, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (service_id, location_id) DO NOTHING`,
        [serviceId, locationId],
      );

      if (publishable.address) {
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
    }

    if (publishable.phone) {
      await client.query(
        `INSERT INTO phones
           (service_id, organization_id, location_id, number, type)
         VALUES ($1, $2, $3, $4, 'voice')`,
        [serviceId, organizationId, locationId ?? null, publishable.phone],
      );
    }

    await client.query(
      `INSERT INTO confidence_scores
         (service_id, score, verification_confidence, eligibility_match, constraint_fit, computed_at)
       VALUES ($1, $2, $2, 0, 0, NOW())`,
      [serviceId, confidenceScore],
    );

    if (mergedServiceTags.length > 0) {
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

    if (serviceAttributes.length > 0) {
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
    if (categoryTags.length > 0) {
      await client.query(
        `INSERT INTO service_taxonomy (service_id, taxonomy_term_id)
         SELECT $1, tt.id
         FROM taxonomy_terms tt
         WHERE LOWER(tt.term) = ANY($2::text[])
         ON CONFLICT (service_id, taxonomy_term_id) DO NOTHING`,
        [serviceId, categoryTags],
      );
    }

    await client.query(
      `UPDATE extracted_candidates
       SET review_status = 'published',
           published_service_id = $2,
           published_at = NOW(),
           published_by_user_id = $3,
           updated_at = NOW()
       WHERE candidate_id = $1`,
      [options.candidateId, serviceId, options.publishedByUserId],
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
       SET status = 'withdrawn',
           updated_at = NOW()
       WHERE candidate_id = $1
         AND status IN ('pending', 'accepted')`,
      [options.candidateId],
    );

    await client.query(
      `INSERT INTO entity_identifiers
         (entity_type, entity_id, identifier_scheme, identifier_value, is_primary, confidence, status, status_changed_at, created_at, updated_at)
       VALUES ('service', $1, 'oran_service_id', $2, true, 100, 'active', NOW(), NOW(), NOW())
       ON CONFLICT (entity_type, entity_id, identifier_scheme, identifier_value) DO NOTHING`,
      [serviceId, serviceId],
    );

    await client.query(
      `INSERT INTO hsds_export_snapshots
         (entity_type, entity_id, snapshot_version, hsds_payload, profile_uri, status, generated_at, created_at)
       VALUES ('service', $1, $2, $3::jsonb, $4, 'current', NOW(), NOW())`,
      [serviceId, snapshotVersion, JSON.stringify(hsdsPayload), HSDS_PROFILE_URI],
    );

    await client.query(
      `INSERT INTO lifecycle_events
         (entity_type, entity_id, event_type, from_status, to_status, actor_type, actor_id, metadata, identifiers_affected, snapshots_invalidated, created_at)
       VALUES ('service', $1, 'published', 'candidate', 'published', 'human', $2, $3::jsonb, 1, 0, NOW())`,
      [
        serviceId,
        options.publishedByUserId,
        JSON.stringify({
          candidateId: options.candidateId,
          organizationId,
          locationId,
        }),
      ],
    );

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
