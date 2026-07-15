/**
 * promoteToLive — Canonical → Live table promotion.
 *
 * Reads from canonical_organizations / canonical_services / canonical_locations
 * (Zone B) and writes to the seeker-visible live tables (Zone C):
 *   organizations, services, locations, service_at_location, addresses, phones,
 *   confidence_scores, entity_identifiers, hsds_export_snapshots, lifecycle_events.
 *
 * Supports both initial publish (INSERT) and re-promote (UPDATE) flows.
 * The canonical entity's publicationStatus is updated to 'published' on success.
 */

import crypto from 'node:crypto';

import { withTransaction } from '@/services/db/postgres';
import {
  appendLifecycleEvent,
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

import type { IngestionStores } from './stores';
import { evaluateStandaloneResourceUse } from './sourcePurpose';
import type {
  CanonicalOrganizationRow,
  CanonicalServiceRow,
  CanonicalLocationRow,
} from '@/db/schema';

// ── Public types ──────────────────────────────────────────────

export interface PromoteToLiveOptions {
  stores: IngestionStores;
  /** The canonical *service* to promote (its org + locations travel with it). */
  canonicalServiceId: string;
  /** User or system actor performing the promote. */
  actorId: string;
}

export interface PromoteToLiveResult {
  organizationId: string;
  serviceId: string;
  locationIds: string[];
  isUpdate: boolean;
}

// ── Helpers ───────────────────────────────────────────────────

function buildHsdsPayloadFromCanonical(input: {
  organizationId: string;
  serviceId: string;
  org: CanonicalOrganizationRow;
  svc: CanonicalServiceRow;
  locations: Array<{ liveId: string; canonical: CanonicalLocationRow }>;
  confidenceSummary: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    meta: {
      generatedBy: 'oran-promote-to-live',
      generatedAt: new Date().toISOString(),
      canonicalServiceId: input.svc.id,
      canonicalOrganizationId: input.org.id,
      publicationSourceKind: 'canonical_feed',
    },
    organization: {
      id: input.organizationId,
      name: input.org.name,
      description: input.org.description ?? null,
      url: input.org.url ?? null,
      email: input.org.email ?? null,
      phone: input.org.phone ?? null,
    },
    service: {
      id: input.serviceId,
      organizationId: input.organizationId,
      name: input.svc.name,
      description: input.svc.description ?? null,
      url: input.svc.url ?? null,
      status: input.svc.status,
    },
    locations: input.locations.map((loc) => ({
      id: loc.liveId,
      name: loc.canonical.name ?? null,
      latitude: loc.canonical.latitude ?? null,
      longitude: loc.canonical.longitude ?? null,
      address: loc.canonical.addressLine1 ?? null,
      city: loc.canonical.addressCity ?? null,
      region: loc.canonical.addressRegion ?? null,
      postalCode: loc.canonical.addressPostalCode ?? null,
      country: loc.canonical.addressCountry ?? null,
    })),
    confidenceSummary: input.confidenceSummary,
  };
}

// ── Main function ─────────────────────────────────────────────

export async function promoteToLive(
  options: PromoteToLiveOptions,
): Promise<PromoteToLiveResult> {
  const { canonicalServiceId, actorId } = options;

  let organizationId = '';
  let serviceId = '';
  let liveLocations: Array<{ liveId: string; canonical: CanonicalLocationRow; existed: boolean }> = [];
  let organizationExists = false;
  let serviceExists = false;
  let isUpdate = false;

  // Every canonical input, source assertion, live identity, pointer, and audit
  // write participates in this serializable transaction. Callers cannot hand
  // us a stale store object that becomes seeker-visible after its authority
  // changed.
  await withTransaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await acquireFreshnessSensitiveAuthoritativeMutationGates(client);

    const canonicalServiceRows = await client.query<CanonicalServiceRow>(
      `SELECT id,
              canonical_organization_id AS "canonicalOrganizationId",
              name,
              alternate_name AS "alternateName",
              description,
              url,
              email,
              status,
              interpretation_services AS "interpretationServices",
              application_process AS "applicationProcess",
              wait_time AS "waitTime",
              fees,
              accreditations,
              licenses,
              lifecycle_status AS "lifecycleStatus",
              publication_status AS "publicationStatus",
              winning_source_system_id AS "winningSourceSystemId",
              source_count AS "sourceCount",
              source_confidence_summary AS "sourceConfidenceSummary",
              published_service_id AS "publishedServiceId",
              first_seen_at AS "firstSeenAt",
              last_refreshed_at AS "lastRefreshedAt",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM public.canonical_services
       WHERE id = $1
       FOR UPDATE`,
      [canonicalServiceId],
    );
    const canonicalService = canonicalServiceRows.rows[0];
    if (!canonicalService) {
      throw new Error(`Canonical service ${canonicalServiceId} not found`);
    }
    if (canonicalService.lifecycleStatus !== 'active') {
      throw new Error(
        `Canonical service ${canonicalServiceId} lifecycle is '${canonicalService.lifecycleStatus}', expected 'active'`,
      );
    }

    const canonicalOrgRows = await client.query<CanonicalOrganizationRow>(
      `SELECT id,
              name,
              alternate_name AS "alternateName",
              description,
              url,
              email,
              phone,
              tax_status AS "taxStatus",
              tax_id AS "taxId",
              year_incorporated AS "yearIncorporated",
              legal_status AS "legalStatus",
              lifecycle_status AS "lifecycleStatus",
              publication_status AS "publicationStatus",
              winning_source_system_id AS "winningSourceSystemId",
              source_count AS "sourceCount",
              source_confidence_summary AS "sourceConfidenceSummary",
              published_organization_id AS "publishedOrganizationId",
              first_seen_at AS "firstSeenAt",
              last_refreshed_at AS "lastRefreshedAt",
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM public.canonical_organizations
       WHERE id = $1
       FOR UPDATE`,
      [canonicalService.canonicalOrganizationId],
    );
    const canonicalOrg = canonicalOrgRows.rows[0];
    if (!canonicalOrg) {
      throw new Error(
        `Canonical organization ${canonicalService.canonicalOrganizationId} not found`,
      );
    }
    if (canonicalOrg.lifecycleStatus !== 'active') {
      throw new Error(
        `Canonical organization ${canonicalOrg.id} lifecycle is '${canonicalOrg.lifecycleStatus}', expected 'active'`,
      );
    }

    const serviceLocationLinks = await client.query<{ canonicalLocationId: string }>(
      `SELECT canonical_location_id AS "canonicalLocationId"
       FROM public.canonical_service_locations
       WHERE canonical_service_id = $1
       ORDER BY canonical_location_id
       FOR SHARE`,
      [canonicalServiceId],
    );
    const canonicalLocationIds = serviceLocationLinks.rows.map((row) => row.canonicalLocationId);
    const canonicalLocationRows = canonicalLocationIds.length > 0
      ? await client.query<CanonicalLocationRow>(
          `SELECT id,
                  canonical_organization_id AS "canonicalOrganizationId",
                  name,
                  alternate_name AS "alternateName",
                  description,
                  transportation,
                  latitude,
                  longitude,
                  geom,
                  address_line1 AS "addressLine1",
                  address_line2 AS "addressLine2",
                  address_city AS "addressCity",
                  address_region AS "addressRegion",
                  address_postal_code AS "addressPostalCode",
                  address_country AS "addressCountry",
                  lifecycle_status AS "lifecycleStatus",
                  publication_status AS "publicationStatus",
                  winning_source_system_id AS "winningSourceSystemId",
                  source_count AS "sourceCount",
                  source_confidence_summary AS "sourceConfidenceSummary",
                  published_location_id AS "publishedLocationId",
                  first_seen_at AS "firstSeenAt",
                  last_refreshed_at AS "lastRefreshedAt",
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"
           FROM public.canonical_locations
           WHERE id = ANY($1::uuid[])
           ORDER BY id
           FOR UPDATE`,
          [canonicalLocationIds],
        )
      : { rows: [] as CanonicalLocationRow[] };
    const canonicalLocations = canonicalLocationRows.rows;
    if (
      canonicalLocations.length !== canonicalLocationIds.length
      || canonicalLocations.some((location) => (
        location.canonicalOrganizationId !== canonicalOrg.id
        || location.lifecycleStatus !== 'active'
      ))
    ) {
      throw new Error(`Canonical service ${canonicalServiceId} has invalid or stale location links`);
    }

    const sourceRows = canonicalService.winningSourceSystemId
      ? await client.query<{
          id: string;
          family: string;
          trust_tier: string;
          resource_purpose: string | null;
          is_active: boolean;
        }>(
          `SELECT id, family, trust_tier, resource_purpose, is_active
           FROM public.source_systems
           WHERE id = $1
           FOR SHARE`,
          [canonicalService.winningSourceSystemId],
        )
      : { rows: [] as Array<{
          id: string;
          family: string;
          trust_tier: string;
          resource_purpose: string | null;
          is_active: boolean;
        }> };
    const sourceSystem = sourceRows.rows[0];
    if (
      !sourceSystem
      || !sourceSystem.is_active
      || sourceSystem.family === 'manual'
      || !['verified_publisher', 'trusted_partner', 'curated', 'community'].includes(sourceSystem.trust_tier)
    ) {
      throw new Error(
        `Canonical service ${canonicalServiceId} has no active non-manual winning source authority`,
      );
    }
    const purposeDecision = evaluateStandaloneResourceUse({
      resourcePurpose: sourceSystem.resource_purpose,
    });
    if (!purposeDecision.allowed) {
      throw new Error(
        `Canonical service ${canonicalServiceId} cannot be published: ${purposeDecision.reason}`,
      );
    }

    const confidenceSummary =
      (canonicalService.sourceConfidenceSummary as Record<string, unknown>) ?? {};
    const rawScore = typeof confidenceSummary.overall === 'number'
      ? confidenceSummary.overall
      : canonicalService.sourceCount ?? 1;
    const numericRaw = Number(rawScore);
    if (!Number.isFinite(numericRaw)) {
      console.warn(
        `[promoteToLive] Non-numeric confidence score for canonical service ${canonicalServiceId}: ${String(rawScore)}`,
      );
    }
    const confidenceScore = Number.isFinite(numericRaw)
      ? Math.min(Math.max(numericRaw, 0), 100)
      : 0;

    organizationId = canonicalOrg.publishedOrganizationId ?? '';
    serviceId = canonicalService.publishedServiceId ?? '';
    organizationExists = Boolean(organizationId);
    serviceExists = Boolean(serviceId);
    isUpdate = serviceExists;

    await acquireLivePublicationAdvisoryLock(client, {
      ownerOrganizationId: canonicalOrg.publishedOrganizationId,
      existingServiceId: canonicalService.publishedServiceId,
      organizationName: canonicalOrg.name,
      organizationUrl: canonicalOrg.url,
      serviceName: canonicalService.name,
      serviceUrl: canonicalService.url,
    });

    if (organizationId) {
      const existingOrganization = await client.query<{ id: string; status: string }>(
        `SELECT id, status
         FROM public.organizations
         WHERE id = $1
         FOR UPDATE`,
        [organizationId],
      );
      if (existingOrganization.rows[0]?.status !== 'active') {
        throw new Error('Canonical organization points to a missing or retired live organization');
      }
    }
    if (serviceId) {
      const existingService = await client.query<{
        id: string;
        organization_id: string;
        status: string;
      }>(
        `SELECT id, organization_id, status
         FROM public.services
         WHERE id = $1
         FOR UPDATE`,
        [serviceId],
      );
      if (
        existingService.rows[0]?.status !== 'active'
        || existingService.rows[0]?.organization_id !== organizationId
      ) {
        throw new Error('Canonical service points to a missing, retired, or differently owned live service');
      }
    }

    const acceptedProvenance = await client.query<{ source_record_id: string }>(
      `SELECT source_record_id
       FROM public.canonical_provenance
       WHERE canonical_entity_type = 'service'
         AND canonical_entity_id = $1
         AND decision_status = 'accepted'
         AND source_record_id IS NOT NULL
       ORDER BY id
       FOR SHARE`,
      [canonicalServiceId],
    );
    const acceptedProvenanceIds = [...new Set(
      acceptedProvenance.rows.map((row) => row.source_record_id),
    )].sort();
    const acceptedAssertions = acceptedProvenanceIds.length > 0
      ? await client.query<{ id: string; source_feed_id: string }>(
          `SELECT publication_record.id, publication_record.source_feed_id
           FROM public.source_records publication_record
           JOIN public.source_feeds publication_feed
             ON publication_feed.id = publication_record.source_feed_id
           WHERE publication_record.id = ANY($1::uuid[])
             AND publication_record.processing_status IN ('normalized', 'published')
             AND publication_feed.source_system_id = $2
             AND publication_feed.is_active IS TRUE
           ORDER BY publication_record.id
           FOR UPDATE OF publication_record
           FOR SHARE OF publication_feed`,
          [acceptedProvenanceIds, canonicalService.winningSourceSystemId],
        )
      : { rows: [] as Array<{ id: string; source_feed_id: string }> };
    if (acceptedAssertions.rows.length === 0) {
      throw new Error(
        `Canonical service ${canonicalServiceId} has no accepted normalized assertion from its active winning source`,
      );
    }

    await assertAuthoritativeEntitiesMutable(client, {
      organizationIds: [canonicalOrg.publishedOrganizationId],
      serviceIds: [canonicalService.publishedServiceId],
      locationIds: canonicalLocations.map((location) => location.publishedLocationId),
      sourceSystemIds: [canonicalService.winningSourceSystemId],
      sourceFeedIds: acceptedAssertions.rows.map((row) => row.source_feed_id),
      sourceRecordIds: acceptedAssertions.rows.map((row) => row.id),
      canonicalOrganizationIds: [canonicalOrg.id],
      canonicalServiceIds: [canonicalService.id],
    });

    const acceptedSourceRecordIds = acceptedAssertions.rows.map((row) => row.id);
    const publishedAssertions = await client.query<{ id: string }>(
      `UPDATE public.source_records publication_record
          SET processing_status = 'published',
              processing_error = NULL,
              processed_at = NOW()
         FROM public.source_feeds publication_feed
         JOIN public.source_systems publication_system
           ON publication_system.id = publication_feed.source_system_id
          AND publication_system.is_active IS TRUE
          AND publication_system.family <> 'manual'
          AND publication_system.trust_tier IN (
            'verified_publisher',
            'trusted_partner',
            'curated',
            'community'
          )
          AND publication_system.resource_purpose IN (
            'service_catalog',
            'program_navigation'
          )
        WHERE publication_record.source_feed_id = publication_feed.id
          AND publication_feed.is_active IS TRUE
          AND publication_system.id = $1
          AND publication_record.processing_status IN ('normalized', 'published')
          AND publication_record.id = ANY($2::uuid[])
      RETURNING publication_record.id`,
      [
        canonicalService.winningSourceSystemId,
        acceptedSourceRecordIds,
      ],
    );
    if (
      (publishedAssertions.rowCount ?? publishedAssertions.rows.length)
      !== acceptedSourceRecordIds.length
    ) {
      throw new Error(
        `Canonical service ${canonicalServiceId} has no accepted normalized assertion from its active winning source`,
      );
    }

    if (!organizationId) {
      const matchedOrganizationId = await resolveExistingLiveOrganizationId(client, {
        organizationName: canonicalOrg.name,
        organizationUrl: canonicalOrg.url,
      });
      organizationId = matchedOrganizationId ?? crypto.randomUUID();
      organizationExists = Boolean(matchedOrganizationId);
    }

    if (!serviceId) {
      const matchedServiceId = await resolveExistingLiveServiceId(client, organizationId, {
        serviceName: canonicalService.name,
        serviceUrl: canonicalService.url,
      });
      serviceId = matchedServiceId ?? crypto.randomUUID();
      serviceExists = Boolean(matchedServiceId);
      isUpdate = serviceExists;
    }

    const overwriteDecision = serviceExists
      ? await decidePublicationOverwrite(client, serviceId, 'canonical_feed')
      : null;
    const shouldOverwriteExisting = overwriteDecision?.shouldOverwrite ?? true;

    liveLocations = [];
    for (const loc of canonicalLocations) {
      if (loc.publishedLocationId) {
        const existingLocation = await client.query<{ id: string; status: string }>(
          `SELECT id, status
           FROM public.locations
           WHERE id = $1
           FOR UPDATE`,
          [loc.publishedLocationId],
        );
        if (existingLocation.rows[0]?.status !== 'active') {
          throw new Error('Canonical location points to a missing or retired live location');
        }
        liveLocations.push({
          liveId: loc.publishedLocationId,
          canonical: loc,
          existed: true,
        });
        continue;
      }

      const matchedLocationId = await resolveExistingLiveLocationId(client, serviceId, {
        name: loc.name,
        address1: loc.addressLine1,
        city: loc.addressCity,
        region: loc.addressRegion,
        postalCode: loc.addressPostalCode,
        country: loc.addressCountry,
      });
      liveLocations.push({
        liveId: matchedLocationId ?? crypto.randomUUID(),
        canonical: loc,
        existed: Boolean(matchedLocationId),
      });
    }

    await assertAuthoritativeEntitiesMutable(client, {
      organizationIds: organizationExists ? [organizationId] : [],
      serviceIds: serviceExists ? [serviceId] : [],
      locationIds: liveLocations
        .filter((location) => location.existed)
        .map((location) => location.liveId),
    });

    const hsdsPayload = buildHsdsPayloadFromCanonical({
      organizationId,
      serviceId,
      org: canonicalOrg,
      svc: canonicalService,
      locations: liveLocations,
      confidenceSummary,
    });

    // ── Organization ────────────────────────────────────────
    if (organizationExists && shouldOverwriteExisting) {
      const updatedOrganization = await client.query<{ id: string }>(
        `UPDATE organizations
         SET name = COALESCE(NULLIF($2, ''), name),
             description = COALESCE(NULLIF($3, ''), description),
             url = COALESCE(NULLIF($4, ''), url),
             email = COALESCE(NULLIF($5, ''), email),
             tax_status = COALESCE(NULLIF($6, ''), tax_status),
             tax_id = COALESCE(NULLIF($7, ''), tax_id),
             year_incorporated = COALESCE($8, year_incorporated),
             legal_status = COALESCE(NULLIF($9, ''), legal_status),
             phone = COALESCE(NULLIF($10, ''), phone),
             updated_at = NOW()
         WHERE id = $1
           AND status = 'active'
       RETURNING id`,
        [
          organizationId,
          canonicalOrg.name,
          canonicalOrg.description ?? null,
          canonicalOrg.url ?? null,
          canonicalOrg.email ?? null,
          canonicalOrg.taxStatus ?? null,
          canonicalOrg.taxId ?? null,
          canonicalOrg.yearIncorporated ?? null,
          canonicalOrg.legalStatus ?? null,
          canonicalOrg.phone ?? null,
        ],
      );
      if (!updatedOrganization.rows[0]) {
        throw new Error('Matched organization was retired during publication');
      }
    } else if (!organizationExists) {
      await client.query(
        `INSERT INTO organizations
           (id, name, description, url, email, tax_status, tax_id,
            year_incorporated, legal_status, phone, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
        [
          organizationId,
          canonicalOrg.name,
          canonicalOrg.description ?? null,
          canonicalOrg.url ?? null,
          canonicalOrg.email ?? null,
          canonicalOrg.taxStatus ?? null,
          canonicalOrg.taxId ?? null,
          canonicalOrg.yearIncorporated ?? null,
          canonicalOrg.legalStatus ?? null,
          canonicalOrg.phone ?? null,
        ],
      );
    }

    // ── Service ─────────────────────────────────────────────
    if (serviceExists && shouldOverwriteExisting) {
      const updatedService = await client.query<{ id: string }>(
        `UPDATE services
         SET organization_id = $2,
             name = COALESCE(NULLIF($3, ''), name),
             description = COALESCE(NULLIF($4, ''), description),
             url = COALESCE(NULLIF($5, ''), url),
             email = COALESCE(NULLIF($6, ''), email),
             status = $7,
             interpretation_services = COALESCE(NULLIF($8, ''), interpretation_services),
             application_process = COALESCE(NULLIF($9, ''), application_process),
             wait_time = COALESCE(NULLIF($10, ''), wait_time),
             fees = COALESCE(NULLIF($11, ''), fees),
             accreditations = COALESCE(NULLIF($12, ''), accreditations),
             licenses = COALESCE(NULLIF($13, ''), licenses),
             updated_at = NOW()
         WHERE id = $1
           AND status = 'active'
           AND organization_id = $2
       RETURNING id`,
        [
          serviceId,
          organizationId,
          canonicalService.name,
          canonicalService.description ?? null,
          canonicalService.url ?? null,
          canonicalService.email ?? null,
          canonicalService.status,
          canonicalService.interpretationServices ?? null,
          canonicalService.applicationProcess ?? null,
          canonicalService.waitTime ?? null,
          canonicalService.fees ?? null,
          canonicalService.accreditations ?? null,
          canonicalService.licenses ?? null,
        ],
      );
      if (!updatedService.rows[0]) {
        throw new Error('Matched service was retired during publication');
      }
    } else if (!serviceExists) {
      await client.query(
        `INSERT INTO services
           (id, organization_id, name, description, url, email, status,
            interpretation_services, application_process, wait_time, fees,
            accreditations, licenses, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())`,
        [
          serviceId,
          organizationId,
          canonicalService.name,
          canonicalService.description ?? null,
          canonicalService.url ?? null,
          canonicalService.email ?? null,
          canonicalService.status,
          canonicalService.interpretationServices ?? null,
          canonicalService.applicationProcess ?? null,
          canonicalService.waitTime ?? null,
          canonicalService.fees ?? null,
          canonicalService.accreditations ?? null,
          canonicalService.licenses ?? null,
        ],
      );
    }

    // ── Locations + addresses ───────────────────────────────
    for (const { liveId, canonical, existed } of liveLocations) {
      if (!shouldOverwriteExisting && existed) {
        continue;
      }
      const locationExists = existed;
      if (locationExists) {
        await client.query(
          `UPDATE locations
           SET organization_id = $2,
               name = COALESCE(NULLIF($3, ''), name),
               latitude = COALESCE($4, latitude),
               longitude = COALESCE($5, longitude),
               description = COALESCE(NULLIF($6, ''), description),
               transportation = COALESCE(NULLIF($7, ''), transportation),
               updated_at = NOW()
           WHERE id = $1`,
          [
            liveId,
            organizationId,
            canonical.name ?? null,
            canonical.latitude ?? null,
            canonical.longitude ?? null,
            canonical.description ?? null,
            canonical.transportation ?? null,
          ],
        );
      } else {
        await client.query(
          `INSERT INTO locations
             (id, organization_id, name, latitude, longitude, description,
              transportation, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())`,
          [
            liveId,
            organizationId,
            canonical.name ?? null,
            canonical.latitude ?? null,
            canonical.longitude ?? null,
            canonical.description ?? null,
            canonical.transportation ?? null,
          ],
        );
      }

      // service_at_location junction
      await client.query(
        `INSERT INTO service_at_location (service_id, location_id, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (service_id, location_id) DO NOTHING`,
        [serviceId, liveId],
      );

      // Address — delete existing + re-insert (no unique constraint on addresses)
      if (canonical.addressLine1) {
        await client.query(
          `DELETE FROM addresses WHERE location_id = $1`,
          [liveId],
        );
        await client.query(
          `INSERT INTO addresses
             (location_id, address_1, city, state_province,
              postal_code, country)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            liveId,
            canonical.addressLine1,
            canonical.addressCity ?? null,
            canonical.addressRegion ?? null,
            canonical.addressPostalCode ?? null,
            canonical.addressCountry ?? null,
          ],
        );
      }
    }

    // ── Phone ───────────────────────────────────────────────
    // Delete existing phones for this service+org before re-inserting
    // to avoid unbounded accumulation on re-promote.
    if (shouldOverwriteExisting && isUpdate) {
      await client.query(
        `DELETE FROM phones WHERE service_id = $1 AND organization_id = $2`,
        [serviceId, organizationId],
      );
    }
    // Support multiple phones separated by ; or ,
    const rawPhone = canonicalOrg.phone ?? '';
    const phoneNumbers = rawPhone
      .split(/[;,]/)
      .map((p: string) => p.trim())
      .filter(Boolean);
    for (const num of shouldOverwriteExisting ? phoneNumbers : []) {
      await client.query(
        `INSERT INTO phones
           (service_id, organization_id, number, type)
         VALUES ($1, $2, $3, 'voice')`,
        [serviceId, organizationId, num],
      );
    }

    // ── Confidence score ────────────────────────────────────
    if (shouldOverwriteExisting) {
      await upsertConfidenceScore(client, {
        serviceId,
        score: confidenceScore,
      });
    }

    // ── Entity identifiers ──────────────────────────────────
    await client.query(
      `INSERT INTO entity_identifiers
         (entity_type, entity_id, identifier_scheme, identifier_value,
          is_primary, confidence, status, status_changed_at, created_at, updated_at)
       VALUES ('service', $1, 'oran_canonical_service_id', $2,
               true, 100, 'active', NOW(), NOW(), NOW())
       ON CONFLICT (entity_type, entity_id, identifier_scheme, identifier_value) DO NOTHING`,
      [serviceId, canonicalServiceId],
    );

    if (shouldOverwriteExisting) {
      await replaceCurrentSnapshot(client, {
        entityType: 'service',
        entityId: serviceId,
        hsdsPayload,
        replaceCurrent: serviceExists,
      });
    }

    await appendLifecycleEvent(client, {
      entityType: 'service',
      entityId: serviceId,
      eventType: shouldOverwriteExisting
        ? isUpdate ? 'republished' : 'promoted'
        : 'linked_existing',
      fromStatus: shouldOverwriteExisting
        ? isUpdate ? 'published' : 'canonical'
        : 'published',
      toStatus: 'published',
      actorType: 'system',
      actorId,
      metadata: {
        canonicalServiceId,
        canonicalOrganizationId: canonicalOrg.id,
        locationCount: liveLocations.length,
        overwriteSuppressed: !shouldOverwriteExisting,
        authorityReason: overwriteDecision?.reason ?? null,
        currentAuthority: overwriteDecision?.current?.sourceKind ?? null,
        incomingAuthority: 'canonical_feed',
      },
      identifiersAffected: 1,
      snapshotsInvalidated: shouldOverwriteExisting && isUpdate ? 1 : 0,
    });

    // Canonical-to-live pointers are part of the same publication boundary.
    // Writing them after this transaction would let a merge retire the live
    // identity in the gap and then leave a new pointer to the defunct source.
    const currentLinkRows = await client.query<{ canonicalLocationId: string }>(
      `SELECT canonical_location_id AS "canonicalLocationId"
       FROM public.canonical_service_locations
       WHERE canonical_service_id = $1
       ORDER BY canonical_location_id
       FOR SHARE`,
      [canonicalServiceId],
    );
    if (
      JSON.stringify(currentLinkRows.rows.map((row) => row.canonicalLocationId))
      !== JSON.stringify(canonicalLocationIds)
    ) {
      throw new Error('Canonical service location links changed during publication');
    }

    const canonicalOrganizationUpdate = await client.query<{ id: string }>(
      `UPDATE canonical_organizations
       SET published_organization_id = coalesce(published_organization_id, $2),
           publication_status = 'published',
           updated_at = NOW()
       WHERE id = $1
         AND (published_organization_id IS NULL OR published_organization_id = $2)
         AND updated_at = $3::timestamptz
         AND lifecycle_status = $4
         AND publication_status = $5
         AND published_organization_id IS NOT DISTINCT FROM $6::uuid
       RETURNING id`,
      [
        canonicalOrg.id,
        organizationId,
        canonicalOrg.updatedAt,
        canonicalOrg.lifecycleStatus,
        canonicalOrg.publicationStatus,
        canonicalOrg.publishedOrganizationId,
      ],
    );
    if (!canonicalOrganizationUpdate.rows[0]) {
      throw new Error('Canonical organization publication pointer changed concurrently');
    }

    const canonicalServiceUpdate = await client.query<{ id: string }>(
      `UPDATE canonical_services
       SET published_service_id = coalesce(published_service_id, $2),
           publication_status = 'published',
           updated_at = NOW()
       WHERE id = $1
         AND (published_service_id IS NULL OR published_service_id = $2)
         AND updated_at = $3::timestamptz
         AND lifecycle_status = $4
         AND publication_status = $5
         AND published_service_id IS NOT DISTINCT FROM $6::uuid
       RETURNING id`,
      [
        canonicalService.id,
        serviceId,
        canonicalService.updatedAt,
        canonicalService.lifecycleStatus,
        canonicalService.publicationStatus,
        canonicalService.publishedServiceId,
      ],
    );
    if (!canonicalServiceUpdate.rows[0]) {
      throw new Error('Canonical service publication pointer changed concurrently');
    }

    for (const { liveId, canonical } of liveLocations) {
      const canonicalLocationUpdate = await client.query<{ id: string }>(
        `UPDATE canonical_locations
         SET published_location_id = coalesce(published_location_id, $2),
             publication_status = 'published',
             updated_at = NOW()
         WHERE id = $1
           AND (published_location_id IS NULL OR published_location_id = $2)
           AND updated_at = $3::timestamptz
           AND lifecycle_status = $4
           AND publication_status = $5
           AND published_location_id IS NOT DISTINCT FROM $6::uuid
         RETURNING id`,
        [
          canonical.id,
          liveId,
          canonical.updatedAt,
          canonical.lifecycleStatus,
          canonical.publicationStatus,
          canonical.publishedLocationId,
        ],
      );
      if (!canonicalLocationUpdate.rows[0]) {
        throw new Error('Canonical location publication pointer changed concurrently');
      }
    }
  });

  return {
    organizationId,
    serviceId,
    locationIds: liveLocations.map((l) => l.liveId),
    isUpdate,
  };
}
