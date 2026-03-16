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

import type { IngestionStores } from './stores';
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
  const { stores, canonicalServiceId, actorId } = options;

  // 1. Load canonical service
  const canonicalService = await stores.canonicalServices.getById(canonicalServiceId);
  if (!canonicalService) {
    throw new Error(`Canonical service ${canonicalServiceId} not found`);
  }
  if (canonicalService.lifecycleStatus !== 'active') {
    throw new Error(
      `Canonical service ${canonicalServiceId} lifecycle is '${canonicalService.lifecycleStatus}', expected 'active'`,
    );
  }

  // 2. Load canonical organization
  const canonicalOrg = await stores.canonicalOrganizations.getById(
    canonicalService.canonicalOrganizationId,
  );
  if (!canonicalOrg) {
    throw new Error(
      `Canonical organization ${canonicalService.canonicalOrganizationId} not found`,
    );
  }

  // 3. Load canonical service–location links & locations (batch)
  const serviceLocLinks = await stores.canonicalServiceLocations.listByService(
    canonicalServiceId,
  );
  const locationIds = serviceLocLinks.map((l) => l.canonicalLocationId);
  const canonicalLocations: CanonicalLocationRow[] =
    locationIds.length > 0
      ? await stores.canonicalLocations.getByIds(locationIds)
      : [];

  const confidenceSummary =
    (canonicalService.sourceConfidenceSummary as Record<string, unknown>) ?? {};

  // 5. Derive a usable confidence score for the live table
  const rawScore =
    typeof confidenceSummary['overall'] === 'number'
      ? confidenceSummary['overall']
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

  let organizationId = canonicalOrg.publishedOrganizationId ?? '';
  let serviceId = canonicalService.publishedServiceId ?? '';
  let liveLocations: Array<{ liveId: string; canonical: CanonicalLocationRow; existed: boolean }> = [];
  let organizationExists = Boolean(canonicalOrg.publishedOrganizationId);
  let serviceExists = Boolean(canonicalService.publishedServiceId);
  let isUpdate = serviceExists;

  // 6. Atomic transaction: write to live tables
  await withTransaction(async (client) => {
    await acquireLivePublicationAdvisoryLock(client, {
      ownerOrganizationId: canonicalOrg.publishedOrganizationId,
      existingServiceId: canonicalService.publishedServiceId,
      organizationName: canonicalOrg.name,
      organizationUrl: canonicalOrg.url,
      serviceName: canonicalService.name,
      serviceUrl: canonicalService.url,
    });

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

    liveLocations = await Promise.all(
      canonicalLocations.map(async (loc) => {
        if (loc.publishedLocationId) {
          return { liveId: loc.publishedLocationId, canonical: loc, existed: true };
        }

        const matchedLocationId = await resolveExistingLiveLocationId(client, serviceId, {
          name: loc.name,
          address1: loc.addressLine1,
          city: loc.addressCity,
          region: loc.addressRegion,
          postalCode: loc.addressPostalCode,
          country: loc.addressCountry,
        });

        return {
          liveId: matchedLocationId ?? crypto.randomUUID(),
          canonical: loc,
          existed: Boolean(matchedLocationId),
        };
      }),
    );

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
      await client.query(
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
         WHERE id = $1`,
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
      await client.query(
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
         WHERE id = $1`,
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
  });

  // 7. Update canonical entities with their live IDs and publication status
  if (!canonicalOrg.publishedOrganizationId) {
    await stores.canonicalOrganizations.update(canonicalOrg.id, {
      publishedOrganizationId: organizationId,
    });
  }
  await stores.canonicalOrganizations.updatePublicationStatus(
    canonicalOrg.id,
    'published',
  );

  if (!canonicalService.publishedServiceId) {
    await stores.canonicalServices.update(canonicalService.id, {
      publishedServiceId: serviceId,
    });
  }
  await stores.canonicalServices.updatePublicationStatus(
    canonicalService.id,
    'published',
  );

  for (const { liveId, canonical } of liveLocations) {
    if (!canonical.publishedLocationId) {
      await stores.canonicalLocations.update(canonical.id, {
        publishedLocationId: liveId,
      });
    }
    await stores.canonicalLocations.updatePublicationStatus(
      canonical.id,
      'published',
    );
  }

  return {
    organizationId,
    serviceId,
    locationIds: liveLocations.map((l) => l.liveId),
    isUpdate,
  };
}
