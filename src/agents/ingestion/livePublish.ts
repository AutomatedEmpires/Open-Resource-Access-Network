import crypto from 'node:crypto';

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

import type { ExtractedCandidate } from './contracts';
import type { IngestionStores } from './stores';
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
      publicationSourceKind: 'candidate_allowlisted',
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

  const serviceAttributes = buildServiceAttributes(publishable);
  const publicationWindow = buildPublicationLifecycleWindow(confidenceScore);
  let organizationId = '';
  let serviceId = '';
  let locationId: string | undefined;

  await withTransaction(async (client) => {
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

    const overwriteDecision = matchedServiceId
      ? await decidePublicationOverwrite(client, serviceId, 'candidate_allowlisted')
      : null;
    const shouldOverwriteExisting = overwriteDecision?.shouldOverwrite ?? true;

    if (matchedOrganizationId && shouldOverwriteExisting) {
      await client.query(
        `UPDATE organizations
            SET name = COALESCE(NULLIF($2, ''), name),
                description = COALESCE(NULLIF($3, ''), description),
                url = COALESCE(NULLIF($4, ''), url),
                phone = COALESCE(NULLIF($5, ''), phone),
                updated_at = NOW()
          WHERE id = $1`,
        [
          organizationId,
          publishable.organizationName,
          publishable.description,
          publishable.websiteUrl ?? null,
          publishable.phone ?? null,
        ],
      );
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
      await client.query(
        `UPDATE services
            SET organization_id = $2,
                name = COALESCE(NULLIF($3, ''), name),
                description = COALESCE(NULLIF($4, ''), description),
                url = COALESCE(NULLIF($5, ''), url),
                status = 'active',
                application_process = COALESCE(NULLIF($6, ''), application_process),
                fees = COALESCE(NULLIF($7, ''), fees),
                updated_at = NOW()
          WHERE id = $1`,
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

    await client.query(
      `UPDATE extracted_candidates
       SET review_status = 'published',
           published_service_id = $2,
           published_at = NOW(),
           published_by_user_id = $3,
           last_verified_at = $4::timestamptz,
           reverify_at = $5::timestamptz,
           updated_at = NOW()
       WHERE candidate_id = $1`,
      [
        options.candidateId,
        serviceId,
        options.publishedByUserId,
        publicationWindow.lastVerifiedAt,
        publicationWindow.reverifyAt,
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
        incomingAuthority: 'candidate_allowlisted',
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
