/**
 * hsdsExportPipeline.ts
 *
 * Generates HSDS-compliant JSON snapshots from canonical tables and
 * stores them in hsds_export_snapshots. Supports batch export for
 * all published services or targeted export for specific entities.
 *
 * Retrieval-first: only exports data already present in canonical tables.
 */

import type { IngestionStores } from './stores';
import type {
  CanonicalOrganizationRow,
  CanonicalServiceRow,
  CanonicalLocationRow,
} from '@/db/schema';

// ── Types ─────────────────────────────────────────────────────

export interface HsdsExportOptions {
  stores: IngestionStores;
  /** Optional list of canonical service IDs; if omitted exports all published */
  serviceIds?: string[];
  /** HSDS profile URI, e.g. 'https://specs.openreferral.org/hsds/3.0' */
  profileUri?: string;
  /** Max services to export when using the "all published" path (default: no limit). */
  limit?: number;
}

export interface ExportedEntity {
  entityType: 'service' | 'organization';
  entityId: string;
  snapshotId: string;
}

export interface HsdsExportResult {
  exported: ExportedEntity[];
  skipped: Array<{ entityId: string; reason: string }>;
  errors: Array<{ entityId: string; error: string }>;
}

// ── Payload builder ───────────────────────────────────────────

export function buildServicePayload(input: {
  svc: CanonicalServiceRow;
  org: CanonicalOrganizationRow | null;
  locations: CanonicalLocationRow[];
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: input.svc.id,
    name: input.svc.name,
    description: input.svc.description ?? null,
    url: input.svc.url ?? null,
    email: input.svc.email ?? null,
    status: input.svc.status,
  };

  if (input.org) {
    payload.organization = {
      id: input.org.id,
      name: input.org.name,
      description: input.org.description ?? null,
      url: input.org.url ?? null,
      email: input.org.email ?? null,
    };
  }

  if (input.locations.length > 0) {
    payload.service_at_locations = input.locations.map((loc) => ({
      location: {
        id: loc.id,
        name: loc.name ?? null,
        latitude: loc.latitude ?? null,
        longitude: loc.longitude ?? null,
        address_1: loc.addressLine1 ?? null,
        city: loc.addressCity ?? null,
        state_province: loc.addressRegion ?? null,
        postal_code: loc.addressPostalCode ?? null,
        country: loc.addressCountry ?? null,
      },
    }));
  }

  return payload;
}

export function buildOrganizationPayload(
  org: CanonicalOrganizationRow,
): Record<string, unknown> {
  return {
    id: org.id,
    name: org.name,
    description: org.description ?? null,
    url: org.url ?? null,
    email: org.email ?? null,
    phone: org.phone ?? null,
  };
}

// ── Main export function ──────────────────────────────────────

export async function runHsdsExport(
  options: HsdsExportOptions,
): Promise<HsdsExportResult> {
  const { stores, profileUri } = options;

  const result: HsdsExportResult = {
    exported: [],
    skipped: [],
    errors: [],
  };

  // Resolve which services to export
  let services: CanonicalServiceRow[];
  if (options.serviceIds && options.serviceIds.length > 0) {
    const loaded: CanonicalServiceRow[] = [];
    for (const sid of options.serviceIds) {
      const svc = await stores.canonicalServices.getById(sid);
      if (svc) loaded.push(svc);
      else result.skipped.push({ entityId: sid, reason: 'canonical service not found' });
    }
    services = loaded;
  } else {
    // Export all published services (with optional limit)
    services = await stores.canonicalServices.listByPublication('published', options.limit);
  }

  // Collect unique org IDs to export separately
  const orgIdSet = new Set<string>();

  for (const svc of services) {
    try {
      // Must be published for export
      if (svc.publicationStatus !== 'published') {
        result.skipped.push({
          entityId: svc.id,
          reason: `publication status is '${svc.publicationStatus}', not 'published'`,
        });
        continue;
      }

      // Load org
      let org: CanonicalOrganizationRow | null = null;
      if (svc.canonicalOrganizationId) {
        org = await stores.canonicalOrganizations.getById(svc.canonicalOrganizationId);
        if (org) orgIdSet.add(org.id);
      }

      // Load locations via service-location junctions (batch)
      const junctions = await stores.canonicalServiceLocations.listByService(svc.id);
      const locIds = junctions.map((jn) => jn.canonicalLocationId);
      const locations: CanonicalLocationRow[] =
        locIds.length > 0
          ? await stores.canonicalLocations.getByIds(locIds)
          : [];

      // Build payload
      const svcPayload = buildServicePayload({ svc, org, locations });

      // Withdraw previous snapshots for this service
      await stores.hsdsExportSnapshots.withdrawForEntity('service', svc.id);

      // Store new snapshot
      const snapshot = await stores.hsdsExportSnapshots.create({
        entityType: 'service',
        entityId: svc.id,
        hsdsPayload: svcPayload,
        profileUri: profileUri ?? null,
        status: 'current',
      });

      result.exported.push({
        entityType: 'service',
        entityId: svc.id,
        snapshotId: snapshot.id,
      });
    } catch (err) {
      result.errors.push({
        entityId: svc.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Export organization snapshots for orgs referenced by exported services
  for (const orgId of orgIdSet) {
    try {
      const org = await stores.canonicalOrganizations.getById(orgId);
      if (!org) {
        result.skipped.push({ entityId: orgId, reason: 'organization not found' });
        continue;
      }

      const orgPayload = buildOrganizationPayload(org);

      await stores.hsdsExportSnapshots.withdrawForEntity('organization', orgId);

      const snapshot = await stores.hsdsExportSnapshots.create({
        entityType: 'organization',
        entityId: orgId,
        hsdsPayload: orgPayload,
        profileUri: profileUri ?? null,
        status: 'current',
      });

      result.exported.push({
        entityType: 'organization',
        entityId: orgId,
        snapshotId: snapshot.id,
      });
    } catch (err) {
      result.errors.push({
        entityId: orgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
