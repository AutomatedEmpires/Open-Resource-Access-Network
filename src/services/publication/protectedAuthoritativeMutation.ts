import type { PoolClient } from 'pg';

import { acquireLivePublicationGateShared } from './liveEntityMerge';

export type ProtectedAuthorityWorkflow = 'verified_hotline' | 'resource_quarantine';
export type ProtectedAuthorityEntityType =
  | 'organization'
  | 'service'
  | 'location'
  | 'source_system'
  | 'source_feed'
  | 'source_record'
  | 'canonical_organization'
  | 'canonical_service';

export interface ProtectedAuthorityMatch {
  workflow: ProtectedAuthorityWorkflow;
  entityType: ProtectedAuthorityEntityType;
  entityId: string;
}

export class ProtectedAuthoritativeMutationConflict extends Error {
  constructor(readonly match: ProtectedAuthorityMatch) {
    super(
      `The ${match.entityType} is controlled by an active ${match.workflow === 'verified_hotline'
        ? 'verified-hotline authority'
        : 'resource-quarantine workflow'} and cannot be changed through this publication path.`,
    );
    this.name = 'ProtectedAuthoritativeMutationConflict';
  }
}

/**
 * Shared maintenance locks for ordinary authoritative writers. The offline
 * maintenance routines and merge take the exclusive side of these exact keys.
 *
 * Lock precondition: the caller already holds the shared publication gate (and
 * the freshness gate first, on freshness paths). Do not call after locking an
 * organization or service row.
 */
export async function acquireProtectedMaintenanceGatesShared(
  client: PoolClient,
): Promise<void> {
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock_shared(
       pg_catalog.hashtextextended('oran:authority:verified-national-hotlines-2026-07-13', 0)
     )`,
  );
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock_shared(
       pg_catalog.hashtextextended('oran:quarantine:usda-fns-snap-retailer-2026-07', 0)
     )`,
  );
}

/** Publication -> hotline(shared) -> quarantine(shared), before entity rows. */
export async function acquireAuthoritativeMutationGatesShared(
  client: PoolClient,
): Promise<void> {
  await acquireLivePublicationGateShared(client);
  await acquireProtectedMaintenanceGatesShared(client);
}

/**
 * Publication -> freshness(exclusive) -> hotline(shared) -> quarantine(shared).
 * Use for live writes that can advance a freshness signal (service content,
 * schedules, or publication timestamps) before taking any entity row lock.
 */
export async function acquireFreshnessSensitiveAuthoritativeMutationGates(
  client: PoolClient,
): Promise<void> {
  await acquireLivePublicationGateShared(client);
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtextextended('oran:resource-freshness-scan', 0)
     )`,
  );
  await acquireProtectedMaintenanceGatesShared(client);
}

function uniqueIds(ids: readonly (string | null | undefined)[] | undefined): string[] {
  return [...new Set((ids ?? []).filter((id): id is string => Boolean(id)))].sort();
}

/**
 * Read protected membership while the shared maintenance gates are held.
 * This function intentionally does not acquire locks so callers can preserve
 * the global advisory-before-entity-row order.
 */
export async function findProtectedAuthoritativeEntities(
  client: PoolClient,
  input: {
    organizationIds?: readonly (string | null | undefined)[];
    serviceIds?: readonly (string | null | undefined)[];
    locationIds?: readonly (string | null | undefined)[];
    sourceSystemIds?: readonly (string | null | undefined)[];
    sourceFeedIds?: readonly (string | null | undefined)[];
    sourceRecordIds?: readonly (string | null | undefined)[];
    canonicalOrganizationIds?: readonly (string | null | undefined)[];
    canonicalServiceIds?: readonly (string | null | undefined)[];
  },
): Promise<ProtectedAuthorityMatch[]> {
  const organizationIds = uniqueIds(input.organizationIds);
  const serviceIds = uniqueIds(input.serviceIds);
  const locationIds = uniqueIds(input.locationIds);
  const sourceSystemIds = uniqueIds(input.sourceSystemIds);
  const sourceFeedIds = uniqueIds(input.sourceFeedIds);
  const sourceRecordIds = uniqueIds(input.sourceRecordIds);
  const canonicalOrganizationIds = uniqueIds(input.canonicalOrganizationIds);
  const canonicalServiceIds = uniqueIds(input.canonicalServiceIds);
  if (
    organizationIds.length === 0
    && serviceIds.length === 0
    && locationIds.length === 0
    && sourceSystemIds.length === 0
    && sourceFeedIds.length === 0
    && sourceRecordIds.length === 0
    && canonicalOrganizationIds.length === 0
    && canonicalServiceIds.length === 0
  ) return [];

  const result = await client.query<{
    workflow: ProtectedAuthorityWorkflow;
    entity_type: ProtectedAuthorityEntityType;
    entity_id: string;
  }>(
    `SELECT workflow, entity_type, entity_id
     FROM (
       SELECT 'verified_hotline'::text AS workflow,
              protected.entity_type,
              protected.entity_id
       FROM oran_internal.hotline_authority_members member
       JOIN oran_internal.hotline_authority_batches batch
         ON batch.id = member.batch_id
       CROSS JOIN LATERAL (
         VALUES
           ('organization'::text, member.organization_id),
           ('service'::text, member.service_id),
           ('source_system'::text, member.source_system_id),
           ('source_feed'::text, member.source_feed_id),
           ('source_record'::text, member.source_record_id),
           ('canonical_organization'::text, member.canonical_organization_id),
           ('canonical_service'::text, member.canonical_service_id)
       ) protected(entity_type, entity_id)
       WHERE batch.status IN ('staging', 'applied')
         AND (
           (protected.entity_type = 'organization' AND protected.entity_id = ANY($1::uuid[]))
           OR (protected.entity_type = 'service' AND protected.entity_id = ANY($2::uuid[]))
           OR (protected.entity_type = 'source_system' AND protected.entity_id = ANY($4::uuid[]))
           OR (protected.entity_type = 'source_feed' AND protected.entity_id = ANY($5::uuid[]))
           OR (protected.entity_type = 'source_record' AND protected.entity_id = ANY($6::uuid[]))
           OR (protected.entity_type = 'canonical_organization' AND protected.entity_id = ANY($7::uuid[]))
           OR (protected.entity_type = 'canonical_service' AND protected.entity_id = ANY($8::uuid[]))
         )

       UNION ALL

       SELECT 'resource_quarantine'::text AS workflow,
              protected.entity_type,
              protected.entity_id
       FROM oran_internal.resource_quarantine_members member
       JOIN oran_internal.resource_quarantine_batches batch
         ON batch.id = member.batch_id
       CROSS JOIN LATERAL (
         VALUES
           ('organization'::text, member.organization_id),
           ('service'::text, member.service_id),
           ('location'::text, member.location_id)
       ) protected(entity_type, entity_id)
       WHERE batch.status IN ('applying', 'applied', 'rolling_back')
         AND (
           (protected.entity_type = 'organization' AND protected.entity_id = ANY($1::uuid[]))
           OR (protected.entity_type = 'service' AND protected.entity_id = ANY($2::uuid[]))
           OR (protected.entity_type = 'location' AND protected.entity_id = ANY($3::uuid[]))
         )
     ) protected_authority
     ORDER BY workflow, entity_type, entity_id`,
    [
      organizationIds,
      serviceIds,
      locationIds,
      sourceSystemIds,
      sourceFeedIds,
      sourceRecordIds,
      canonicalOrganizationIds,
      canonicalServiceIds,
    ],
  );

  return result.rows.map((row) => ({
    workflow: row.workflow,
    entityType: row.entity_type,
    entityId: row.entity_id,
  }));
}

export async function assertAuthoritativeEntitiesMutable(
  client: PoolClient,
  input: {
    organizationIds?: readonly (string | null | undefined)[];
    serviceIds?: readonly (string | null | undefined)[];
    locationIds?: readonly (string | null | undefined)[];
    sourceSystemIds?: readonly (string | null | undefined)[];
    sourceFeedIds?: readonly (string | null | undefined)[];
    sourceRecordIds?: readonly (string | null | undefined)[];
    canonicalOrganizationIds?: readonly (string | null | undefined)[];
    canonicalServiceIds?: readonly (string | null | undefined)[];
  },
): Promise<void> {
  const match = (await findProtectedAuthoritativeEntities(client, input))[0];
  if (match) throw new ProtectedAuthoritativeMutationConflict(match);
}
