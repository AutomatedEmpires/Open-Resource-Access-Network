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

import type { IngestionStores } from './stores';
import type {
  CanonicalOrganizationRow,
  CanonicalServiceRow,
  CanonicalLocationRow,
} from '@/db/schema';

const HSDS_PROFILE_URI = 'https://openreferral.org/imls/hsds/';

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

  // 4. Determine INSERT vs UPDATE
  const isUpdate = Boolean(canonicalService.publishedServiceId);
  const organizationId =
    canonicalOrg.publishedOrganizationId ?? crypto.randomUUID();
  const serviceId = canonicalService.publishedServiceId ?? crypto.randomUUID();

  // Resolve live location IDs (re-use existing if previously promoted)
  const liveLocations = canonicalLocations.map((loc) => ({
    liveId: loc.publishedLocationId ?? crypto.randomUUID(),
    canonical: loc,
  }));

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
      `[promoteToLive] Non-numeric confidence score for service ${serviceId}: ${String(rawScore)}`,
    );
  }
  const confidenceScore = Number.isFinite(numericRaw)
    ? Math.min(Math.max(numericRaw, 0), 100)
    : 0;

  const hsdsPayload = buildHsdsPayloadFromCanonical({
    organizationId,
    serviceId,
    org: canonicalOrg,
    svc: canonicalService,
    locations: liveLocations,
    confidenceSummary,
  });

  // 6. Atomic transaction: write to live tables
  await withTransaction(async (client) => {
    // ── Organization ────────────────────────────────────────
    if (isUpdate && canonicalOrg.publishedOrganizationId) {
      await client.query(
        `UPDATE organizations
         SET name = $2, description = $3, url = $4, email = $5,
             tax_status = $6, tax_id = $7, year_incorporated = $8,
             legal_status = $9, phone = $10, updated_at = NOW()
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
    } else {
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
    if (isUpdate && canonicalService.publishedServiceId) {
      await client.query(
        `UPDATE services
         SET organization_id = $2, name = $3, description = $4, url = $5,
             email = $6, status = $7, interpretation_services = $8,
             application_process = $9, wait_time = $10, fees = $11,
             accreditations = $12, licenses = $13, updated_at = NOW()
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
    } else {
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
    for (const { liveId, canonical } of liveLocations) {
      const locationExists = Boolean(canonical.publishedLocationId);
      if (locationExists) {
        await client.query(
          `UPDATE locations
           SET organization_id = $2, name = $3, latitude = $4, longitude = $5,
               description = $6, transportation = $7, updated_at = NOW()
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
    if (isUpdate) {
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
    for (const num of phoneNumbers) {
      await client.query(
        `INSERT INTO phones
           (service_id, organization_id, number, type)
         VALUES ($1, $2, $3, 'voice')`,
        [serviceId, organizationId, num],
      );
    }

    // ── Confidence score ────────────────────────────────────
    await client.query(
      `INSERT INTO confidence_scores
         (service_id, score, verification_confidence, eligibility_match,
          constraint_fit, computed_at)
       VALUES ($1, $2, $2, 0, 0, NOW())
       ON CONFLICT (service_id) DO UPDATE
         SET score = EXCLUDED.score,
             verification_confidence = EXCLUDED.verification_confidence,
             computed_at = NOW()`,
      [serviceId, confidenceScore],
    );

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

    // ── HSDS export snapshot ────────────────────────────────
    // Withdraw previous snapshots for this entity
    if (isUpdate) {
      await client.query(
        `UPDATE hsds_export_snapshots
         SET status = 'superseded', withdrawn_at = NOW()
         WHERE entity_type = 'service' AND entity_id = $1 AND status = 'current'`,
        [serviceId],
      );
    }

    // Determine next snapshot version
    const versionResult = await client.query(
      `SELECT COALESCE(MAX(snapshot_version), 0) + 1 AS next_version
       FROM hsds_export_snapshots
       WHERE entity_type = 'service' AND entity_id = $1`,
      [serviceId],
    );
    const nextVersion = versionResult.rows[0]?.next_version ?? 1;

    await client.query(
      `INSERT INTO hsds_export_snapshots
         (entity_type, entity_id, snapshot_version, hsds_payload,
          profile_uri, status, generated_at, created_at)
       VALUES ('service', $1, $2, $3::jsonb, $4, 'current', NOW(), NOW())`,
      [
        serviceId,
        nextVersion,
        JSON.stringify(hsdsPayload),
        HSDS_PROFILE_URI,
      ],
    );

    // ── Lifecycle event ─────────────────────────────────────
    await client.query(
      `INSERT INTO lifecycle_events
         (entity_type, entity_id, event_type, from_status, to_status,
          actor_type, actor_id, metadata, identifiers_affected,
          snapshots_invalidated, created_at)
       VALUES ('service', $1, $2, $3, 'published', 'system', $4, $5::jsonb,
               1, $6, NOW())`,
      [
        serviceId,
        isUpdate ? 'republished' : 'promoted',
        isUpdate ? 'published' : 'canonical',
        actorId,
        JSON.stringify({
          canonicalServiceId,
          canonicalOrganizationId: canonicalOrg.id,
          locationCount: liveLocations.length,
        }),
        isUpdate ? 1 : 0,
      ],
    );
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
