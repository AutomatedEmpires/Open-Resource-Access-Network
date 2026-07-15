/**
 * Merge Duplicates Service
 *
 * Provides operations to merge duplicate organizations and services.
 * Merges reassign all child entities (services, submissions, members)
 * from the source to the target, then archive the source.
 *
 * All operations are transactional to prevent partial merges.
 */

import { withTransaction, executeQuery } from '@/services/db/postgres';
import { ROLE_LEVELS } from '@/services/auth/roles';
import { acquireLivePublicationMergeLock } from '@/services/publication/liveEntityMerge';
import type { OranRole } from '@/domain/types';
import type { PoolClient } from 'pg';

// ============================================================
// AUTHORIZATION
// ============================================================

/**
 * Verify that the actor has at least oran_admin role before allowing
 * a destructive merge operation. Throws on failure.
 */
async function assertMergeAuthorized(client: PoolClient, actorUserId: string): Promise<void> {
  const rows = await client.query<{ role: string; account_status: string | null }>(
    `SELECT role, account_status
     FROM user_profiles
     WHERE user_id = $1
     FOR SHARE`,
    [actorUserId],
  );
  if (rows.rows.length === 0) {
    throw new Error('Actor user not found');
  }
  if (rows.rows[0].account_status !== 'active') {
    throw new Error('Unauthorized: merge actor account is not active');
  }
  const actorRole = rows.rows[0].role as OranRole;
  if ((ROLE_LEVELS[actorRole] ?? 0) < ROLE_LEVELS.oran_admin) {
    throw new Error('Unauthorized: merge operations require oran_admin role');
  }
}

// ============================================================
// TYPES
// ============================================================

export interface MergeResult {
  success: boolean;
  targetId: string;
  sourceId: string;
  mergedCounts: {
    services?: number;
    submissions?: number;
    members?: number;
    locations?: number;
    phones?: number;
    confidenceScores?: number;
  };
  error?: string;
}

/**
 * Offline hotline/quarantine routines take these advisory locks before they
 * touch entity rows. Merge must use the same global order to avoid a
 * row-lock/advisory-lock inversion.
 */
async function acquireOfflineMaintenanceLocks(client: PoolClient): Promise<void> {
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtextextended('oran:authority:verified-national-hotlines-2026-07-13', 0)
     )`,
  );
  await client.query(
    `SELECT pg_catalog.pg_advisory_xact_lock(
       pg_catalog.hashtextextended('oran:quarantine:usda-fns-snap-retailer-2026-07', 0)
     )`,
  );
}

interface UniqueServiceChildPlan {
  table: string;
  serviceColumn: string;
  conflictColumns: readonly string[];
}

interface SimpleServiceChildPlan {
  table: string;
  serviceColumn: string;
}

interface OrganizationChildPlan {
  table: string;
  organizationColumn: string;
}

interface MergeReferenceRow {
  id: string;
  originalValue: string | null;
}

interface MergeReferenceSnapshot {
  table: string;
  column: string;
  rows: MergeReferenceRow[];
}

interface MergeSnapshotCollector {
  total: number;
  references: MergeReferenceSnapshot[];
}

const MERGE_CHILD_REFERENCE_LIMIT = 5_000;

// These are immutable provenance/security/delivery records. Their entity IDs
// intentionally continue to describe the source identity after a merge.
// Live identity surfaces are guarded separately and must be reconciled before
// an admin can merge.
const PRESERVED_NON_FK_ENTITY_HISTORY = [
  'concept_tag_derivations',
  'lifecycle_events',
  'resolution_decisions',
  'notification_events',
  'scope_audit_log',
  'verification_queue_archive',
  'hotline_quarantined_contacts',
  'hotline_authority_added_contacts',
] as const;

// Every identifier in these plans is a compile-time constant. Keeping the
// plans beside the merge implementation makes schema drift visible and lets
// the transaction fail closed before a newly-added live child is orphaned.
const UNIQUE_SERVICE_CHILDREN: readonly UniqueServiceChildPlan[] = [
  { table: 'dietary_options', serviceColumn: 'service_id', conflictColumns: ['dietary_type'] },
  { table: 'org_service_scope', serviceColumn: 'service_id', conflictColumns: ['user_id'] },
  { table: 'saved_collection_services', serviceColumn: 'service_id', conflictColumns: ['collection_id'] },
  { table: 'saved_services', serviceColumn: 'service_id', conflictColumns: ['user_id'] },
  { table: 'service_adaptations', serviceColumn: 'service_id', conflictColumns: ['adaptation_type', 'adaptation_tag'] },
  { table: 'service_at_location', serviceColumn: 'service_id', conflictColumns: ['location_id'] },
  { table: 'service_attributes', serviceColumn: 'service_id', conflictColumns: ['taxonomy', 'tag'] },
  { table: 'service_taxonomy', serviceColumn: 'service_id', conflictColumns: ['taxonomy_term_id'] },
] as const;

const SIMPLE_SERVICE_CHILDREN: readonly SimpleServiceChildPlan[] = [
  { table: 'canonical_services', serviceColumn: 'published_service_id' },
  { table: 'contacts', serviceColumn: 'service_id' },
  { table: 'eligibility', serviceColumn: 'service_id' },
  { table: 'extracted_candidates', serviceColumn: 'published_service_id' },
  { table: 'languages', serviceColumn: 'service_id' },
  { table: 'phones', serviceColumn: 'service_id' },
  { table: 'required_documents', serviceColumn: 'service_id' },
  { table: 'schedules', serviceColumn: 'service_id' },
  { table: 'seeker_feedback', serviceColumn: 'service_id' },
  { table: 'service_areas', serviceColumn: 'service_id' },
  { table: 'verified_service_links', serviceColumn: 'service_id' },
] as const;

const PRESERVED_SERVICE_CHILDREN = new Set([
  // Findings and the legacy queue are immutable operational history. An open
  // source finding is resolved explicitly before the source is deactivated.
  'oran_internal.resource_freshness_findings.service_id',
  'public.verification_queue_archive.service_id',
]);

const SIMPLE_ORGANIZATION_CHILDREN: readonly OrganizationChildPlan[] = [
  // canonical_organizations is a publication reference without a database FK.
  { table: 'canonical_organizations', organizationColumn: 'published_organization_id' },
  { table: 'contacts', organizationColumn: 'organization_id' },
  { table: 'form_instances', organizationColumn: 'owner_organization_id' },
  { table: 'form_instances', organizationColumn: 'recipient_organization_id' },
  { table: 'ingestion_sources', organizationColumn: 'owner_org_id' },
  { table: 'locations', organizationColumn: 'organization_id' },
  { table: 'org_service_scope', organizationColumn: 'organization_id' },
  { table: 'ownership_transfers', organizationColumn: 'organization_id' },
  { table: 'pending_scope_grants', organizationColumn: 'organization_id' },
  { table: 'phones', organizationColumn: 'organization_id' },
  { table: 'programs', organizationColumn: 'organization_id' },
  { table: 'services', organizationColumn: 'organization_id' },
] as const;

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_]+$/.test(identifier)) {
    throw new Error(`Unsafe merge-plan identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function qualifiedPublicTable(table: string): string {
  return `public.${quoteIdentifier(table)}`;
}

async function assertServiceMergePlanCurrent(client: PoolClient): Promise<void> {
  const known = new Set<string>([
    ...UNIQUE_SERVICE_CHILDREN.map((plan) => `public.${plan.table}.${plan.serviceColumn}`),
    ...SIMPLE_SERVICE_CHILDREN.map((plan) => `public.${plan.table}.${plan.serviceColumn}`),
    'public.confidence_scores.service_id',
    'public.ownership_transfers.service_id',
    'public.submissions.service_id',
    ...PRESERVED_SERVICE_CHILDREN,
  ]);
  const rows = await client.query<{
    schema_name: string;
    table_name: string;
    column_name: string;
  }>(
    `SELECT namespace.nspname AS schema_name,
            relation.relname AS table_name,
            attribute.attname AS column_name
     FROM pg_catalog.pg_constraint constraint_row
     JOIN pg_catalog.pg_class relation
       ON relation.oid = constraint_row.conrelid
     JOIN pg_catalog.pg_namespace namespace
       ON namespace.oid = relation.relnamespace
     JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
       WITH ORDINALITY AS local_key(attnum, ordinal) ON true
     JOIN LATERAL pg_catalog.unnest(constraint_row.confkey)
       WITH ORDINALITY AS remote_key(attnum, ordinal)
       ON remote_key.ordinal = local_key.ordinal
     JOIN pg_catalog.pg_attribute attribute
       ON attribute.attrelid = constraint_row.conrelid
      AND attribute.attnum = local_key.attnum
     JOIN pg_catalog.pg_attribute remote_attribute
       ON remote_attribute.attrelid = constraint_row.confrelid
      AND remote_attribute.attnum = remote_key.attnum
     WHERE constraint_row.contype = 'f'
       AND constraint_row.confrelid = 'public.services'::pg_catalog.regclass
       AND remote_attribute.attname = 'id'`,
  );
  const unsupported = rows.rows
    .map((row) => `${row.schema_name}.${row.table_name}.${row.column_name}`)
    .filter((reference) => !known.has(reference));
  if (unsupported.length > 0) {
    throw new Error(`Service merge blocked by unsupported child references: ${unsupported.join(', ')}`);
  }
}

async function assertNoUniqueServiceChildConflict(
  client: PoolClient,
  plan: UniqueServiceChildPlan,
  targetId: string,
  sourceId: string,
): Promise<void> {
  const table = qualifiedPublicTable(plan.table);
  const serviceColumn = quoteIdentifier(plan.serviceColumn);
  const conflict = plan.conflictColumns
    .map((column) => {
      const identifier = quoteIdentifier(column);
      return `target_row.${identifier} IS NOT DISTINCT FROM source_row.${identifier}`;
    })
    .join(' AND ');

  const conflictResult = await client.query<{ source_id: string; target_id: string }>(
    `SELECT source_row.id::text AS source_id,
            target_row.id::text AS target_id
     FROM ${table} source_row
     JOIN ${table} target_row
       ON target_row.${serviceColumn} = $1
      AND ${conflict}
     WHERE source_row.${serviceColumn} = $2
       AND target_row.${serviceColumn} = $1
     ORDER BY source_row.id, target_row.id
     LIMIT 1
     FOR UPDATE OF source_row, target_row`,
    [targetId, sourceId],
  );
  if (conflictResult.rows[0]) {
    throw new Error(`Service merge blocked by conflicting ${plan.table} rows`);
  }
}

async function moveUniqueServiceChildren(
  client: PoolClient,
  plan: UniqueServiceChildPlan,
  targetId: string,
  sourceId: string,
): Promise<number> {
  const table = qualifiedPublicTable(plan.table);
  const serviceColumn = quoteIdentifier(plan.serviceColumn);
  const moved = await client.query(
    `UPDATE ${table}
     SET ${serviceColumn} = $1
     WHERE ${serviceColumn} = $2`,
    [targetId, sourceId],
  );
  return moved.rowCount ?? 0;
}

async function collectReferenceSnapshot(
  client: PoolClient,
  collector: MergeSnapshotCollector,
  tableName: string,
  columnName: string,
  sourceId: string,
  additionalPredicate = '',
  additionalParams: readonly unknown[] = [],
): Promise<void> {
  const table = qualifiedPublicTable(tableName);
  const column = quoteIdentifier(columnName);
  const remaining = MERGE_CHILD_REFERENCE_LIMIT - collector.total;
  const limitParameter = additionalParams.length + 2;
  const result = await client.query<{ id: string; original_value: string | null }>(
    `SELECT source_row.id::text AS id,
            source_row.${column}::text AS original_value
     FROM ${table} source_row
     WHERE source_row.${column} = $1
       ${additionalPredicate}
     ORDER BY source_row.id
     LIMIT $${limitParameter}
     FOR UPDATE OF source_row`,
    [sourceId, ...additionalParams, remaining + 1],
  );
  if (result.rows.length > remaining) {
    throw new Error(
      `Merge exceeds the ${MERGE_CHILD_REFERENCE_LIMIT}-reference safety limit`,
    );
  }
  collector.total += result.rows.length;
  if (result.rows.length > 0) {
    collector.references.push({
      table: `public.${tableName}`,
      column: columnName,
      rows: result.rows.map((row) => ({
        id: row.id,
        originalValue: row.original_value,
      })),
    });
  }
}

async function moveSimpleServiceChildren(
  client: PoolClient,
  plan: SimpleServiceChildPlan,
  targetId: string,
  sourceId: string,
): Promise<number> {
  const table = qualifiedPublicTable(plan.table);
  const serviceColumn = quoteIdentifier(plan.serviceColumn);
  const moved = await client.query(
    `UPDATE ${table}
     SET ${serviceColumn} = $1
     WHERE ${serviceColumn} = $2`,
    [targetId, sourceId],
  );
  return moved.rowCount ?? 0;
}

async function moveOrganizationChildren(
  client: PoolClient,
  plan: OrganizationChildPlan,
  targetId: string,
  sourceId: string,
): Promise<number> {
  const table = qualifiedPublicTable(plan.table);
  const column = quoteIdentifier(plan.organizationColumn);
  const moved = await client.query(
    `UPDATE ${table}
     SET ${column} = $1
     WHERE ${column} = $2`,
    [targetId, sourceId],
  );
  return moved.rowCount ?? 0;
}

async function assertOrganizationMergePlanCurrent(client: PoolClient): Promise<void> {
  const known = new Set<string>([
    ...SIMPLE_ORGANIZATION_CHILDREN
      .filter((plan) => plan.table !== 'canonical_organizations')
      .map((plan) => `public.${plan.table}.${plan.organizationColumn}`),
    'public.organization_members.organization_id',
    'public.user_scope_grants.organization_id',
  ]);
  const rows = await client.query<{
    schema_name: string;
    table_name: string;
    column_name: string;
  }>(
    `SELECT namespace.nspname AS schema_name,
            relation.relname AS table_name,
            attribute.attname AS column_name
     FROM pg_catalog.pg_constraint constraint_row
     JOIN pg_catalog.pg_class relation
       ON relation.oid = constraint_row.conrelid
     JOIN pg_catalog.pg_namespace namespace
       ON namespace.oid = relation.relnamespace
     JOIN LATERAL pg_catalog.unnest(constraint_row.conkey)
       WITH ORDINALITY AS local_key(attnum, ordinal) ON true
     JOIN LATERAL pg_catalog.unnest(constraint_row.confkey)
       WITH ORDINALITY AS remote_key(attnum, ordinal)
       ON remote_key.ordinal = local_key.ordinal
     JOIN pg_catalog.pg_attribute attribute
       ON attribute.attrelid = constraint_row.conrelid
      AND attribute.attnum = local_key.attnum
     JOIN pg_catalog.pg_attribute remote_attribute
       ON remote_attribute.attrelid = constraint_row.confrelid
      AND remote_attribute.attnum = remote_key.attnum
     WHERE constraint_row.contype = 'f'
       AND constraint_row.confrelid = 'public.organizations'::pg_catalog.regclass
       AND remote_attribute.attname = 'id'`,
  );
  const unsupported = rows.rows
    .map((row) => `${row.schema_name}.${row.table_name}.${row.column_name}`)
    .filter((reference) => !known.has(reference));
  if (unsupported.length > 0) {
    throw new Error(`Organization merge blocked by unsupported child references: ${unsupported.join(', ')}`);
  }
}

async function assertNoOrganizationMergeConflicts(
  client: PoolClient,
  targetId: string,
  sourceId: string,
): Promise<void> {
  const memberConflict = await client.query<{ id: string }>(
    `SELECT source_member.id::text AS id
     FROM public.organization_members source_member
     JOIN public.organization_members target_member
       ON target_member.organization_id = $1
      AND target_member.user_id = source_member.user_id
     WHERE source_member.organization_id = $2
     ORDER BY source_member.id, target_member.id
     LIMIT 1
     FOR UPDATE OF source_member, target_member`,
    [targetId, sourceId],
  );
  if (memberConflict.rows[0]) {
    throw new Error('Organization merge blocked by conflicting organization member roles');
  }

  const scopeConflict = await client.query<{ id: string }>(
    `SELECT source_grant.id::text AS id
     FROM public.user_scope_grants source_grant
     JOIN public.user_scope_grants target_grant
       ON target_grant.organization_id = $1
      AND target_grant.user_id = source_grant.user_id
      AND target_grant.scope_id = source_grant.scope_id
     WHERE source_grant.organization_id = $2
     ORDER BY source_grant.id, target_grant.id
     LIMIT 1
     FOR UPDATE OF source_grant, target_grant`,
    [targetId, sourceId],
  );
  if (scopeConflict.rows[0]) {
    throw new Error('Organization merge blocked by conflicting user scope grants');
  }

  const tagConflict = await client.query<{ id: string }>(
    `SELECT source_tag.id::text AS id
     FROM public.resource_tags source_tag
     JOIN public.resource_tags target_tag
       ON target_tag.target_type = 'organization'
      AND target_tag.target_id = $1
      AND target_tag.tag_type = source_tag.tag_type
      AND target_tag.tag_value = source_tag.tag_value
     WHERE source_tag.target_type = 'organization'
       AND source_tag.target_id = $2
     ORDER BY source_tag.id, target_tag.id
     LIMIT 1
     FOR UPDATE OF source_tag, target_tag`,
    [targetId, sourceId],
  );
  if (tagConflict.rows[0]) {
    throw new Error('Organization merge blocked by conflicting resource tags');
  }
}

async function assertNoServiceMergeConflicts(
  client: PoolClient,
  targetId: string,
  sourceId: string,
): Promise<void> {
  for (const plan of UNIQUE_SERVICE_CHILDREN) {
    await assertNoUniqueServiceChildConflict(client, plan, targetId, sourceId);
  }

  const tagConflict = await client.query<{ id: string }>(
    `SELECT source_tag.id::text AS id
     FROM public.resource_tags source_tag
     JOIN public.resource_tags target_tag
       ON target_tag.target_type = 'service'
      AND target_tag.target_id = $1
      AND target_tag.tag_type = source_tag.tag_type
      AND target_tag.tag_value = source_tag.tag_value
     WHERE source_tag.target_type = 'service'
       AND source_tag.target_id = $2
     ORDER BY source_tag.id, target_tag.id
     LIMIT 1
     FOR UPDATE OF source_tag, target_tag`,
    [targetId, sourceId],
  );
  if (tagConflict.rows[0]) {
    throw new Error('Service merge blocked by conflicting resource tags');
  }

  const confidenceConflict = await client.query<{ id: string }>(
    `SELECT source_score.id::text AS id
     FROM public.confidence_scores source_score
     JOIN public.confidence_scores target_score
       ON target_score.service_id = $1
     WHERE source_score.service_id = $2
     ORDER BY source_score.id, target_score.id
     LIMIT 1
     FOR UPDATE OF source_score, target_score`,
    [targetId, sourceId],
  );
  if (confidenceConflict.rows[0]) {
    throw new Error('Service merge blocked by conflicting confidence scores');
  }
}

async function assertNoUnreconciledNonFkMergeState(
  client: PoolClient,
  entityType: 'service' | 'organization',
  sourceId: string,
  targetId: string,
): Promise<void> {
  const blockers = await client.query<{ blocker: string }>(
    `SELECT blocker
     FROM (
       SELECT 'entity identifiers'::text AS blocker
       WHERE EXISTS (
         SELECT 1
         FROM public.entity_identifiers identifier
         WHERE identifier.entity_type = $1
           AND identifier.entity_id = $2
       )
       UNION ALL
       SELECT 'current HSDS publication snapshot'
       WHERE EXISTS (
         SELECT 1
         FROM public.hsds_export_snapshots snapshot
         WHERE snapshot.entity_type = $1
           AND snapshot.entity_id = $2
           AND snapshot.status = 'current'
       )
       UNION ALL
       SELECT 'open confidence regression'
       WHERE EXISTS (
         SELECT 1
         FROM public.confidence_regressions regression
         WHERE regression.entity_type = $1
           AND regression.entity_id = $2
           AND regression.status IN ('open', 'acknowledged')
       )
       UNION ALL
       SELECT 'entity resolution cluster membership'
       WHERE EXISTS (
         SELECT 1
         FROM public.entity_cluster_members member
         WHERE member.entity_type = $1
           AND member.entity_id = $2
       )
       UNION ALL
       SELECT 'pending staging import mapping'
       WHERE (
         ($1 = 'service' AND EXISTS (
           SELECT 1 FROM public.staging_services staged_service
           WHERE staged_service.service_id = $2
             AND staged_service.import_status = 'pending'
         ))
         OR
         ($1 = 'organization' AND (
           EXISTS (
             SELECT 1 FROM public.staging_organizations staged_organization
             WHERE staged_organization.organization_id = $2
               AND staged_organization.import_status = 'pending'
           )
           OR EXISTS (
             SELECT 1 FROM public.staging_locations staged_location
             WHERE staged_location.organization_id = $2
               AND staged_location.import_status = 'pending'
           )
           OR EXISTS (
             SELECT 1 FROM public.staging_services staged_service
             WHERE staged_service.organization_id = $2
               AND staged_service.import_status = 'pending'
           )
         ))
       )
       UNION ALL
       SELECT 'active verified-hotline authority'
       WHERE EXISTS (
         SELECT 1
         FROM oran_internal.hotline_authority_members member
         JOIN oran_internal.hotline_authority_batches batch
           ON batch.id = member.batch_id
         WHERE batch.status IN ('staging', 'applied')
           AND (
             ($1 = 'service' AND member.service_id = $2)
             OR ($1 = 'organization' AND member.organization_id = $2)
           )
       )
       UNION ALL
       SELECT 'active resource quarantine workflow'
       WHERE EXISTS (
         SELECT 1
         FROM oran_internal.resource_quarantine_members member
         JOIN oran_internal.resource_quarantine_batches batch
           ON batch.id = member.batch_id
         WHERE batch.status IN ('applying', 'applied', 'rolling_back')
           AND (
             ($1 = 'service' AND member.service_id = $2)
             OR ($1 = 'organization' AND member.organization_id = $2)
           )
       )
     ) merge_blockers
     ORDER BY blocker
     LIMIT 1`,
    [entityType, sourceId],
  );
  if (blockers.rows[0]) {
    throw new Error(
      `${entityType === 'service' ? 'Service' : 'Organization'} merge blocked by ${blockers.rows[0].blocker}`,
    );
  }

  // A protected remediation identity also cannot be the merge destination.
  // The broad source checks above intentionally are not reused here because
  // ordinary target identities are expected to retain current publication
  // snapshots and other live metadata. Only hotline/quarantine membership is
  // destination-fatal: moving unrelated children into one of those identities
  // would bypass the batch manifest and exact-authority snapshot.
  const protectedTarget = await client.query<{ blocker: string }>(
    `SELECT blocker
     FROM (
       SELECT 'active verified-hotline authority'::text AS blocker
       WHERE EXISTS (
         SELECT 1
         FROM oran_internal.hotline_authority_members member
         JOIN oran_internal.hotline_authority_batches batch
           ON batch.id = member.batch_id
         WHERE batch.status IN ('staging', 'applied')
           AND (
             ($1 = 'service' AND member.service_id = $2)
             OR ($1 = 'organization' AND member.organization_id = $2)
           )
       )
       UNION ALL
       SELECT 'active resource quarantine workflow'
       WHERE EXISTS (
         SELECT 1
         FROM oran_internal.resource_quarantine_members member
         JOIN oran_internal.resource_quarantine_batches batch
           ON batch.id = member.batch_id
         WHERE batch.status IN ('applying', 'applied', 'rolling_back')
           AND (
             ($1 = 'service' AND member.service_id = $2)
             OR ($1 = 'organization' AND member.organization_id = $2)
           )
       )
     ) protected_target
     ORDER BY blocker
     LIMIT 1`,
    [entityType, targetId],
  );
  if (protectedTarget.rows[0]) {
    throw new Error(
      `Target ${entityType} merge blocked by ${protectedTarget.rows[0].blocker}; deactivate or roll back the protected batch and reverify the identity first`,
    );
  }
}

async function assertSourceHasNoManualPublicationAuthority(
  client: PoolClient,
  sourceId: string,
): Promise<void> {
  const authorityResult = await client.query<{ snapshot_id: string }>(
    `SELECT publication_snapshot.id::text AS snapshot_id
     FROM public.hsds_export_snapshots publication_snapshot
     JOIN public.submissions publication_submission
       ON publication_submission.id::text =
          (publication_snapshot.hsds_payload #>> '{meta,sourceSubmissionId}')
      AND publication_submission.service_id = publication_snapshot.entity_id
     JOIN public.source_records publication_record
       ON publication_record.id::text =
          (publication_submission.payload ->> 'projectionSourceRecordId')
      AND publication_record.source_record_id = publication_submission.id::text
      AND publication_record.parsed_payload #>> '{projection,serviceId}' =
          publication_snapshot.entity_id::text
     WHERE publication_snapshot.entity_type = 'service'
       AND publication_snapshot.entity_id = $1
       AND publication_snapshot.status = 'current'
     ORDER BY publication_snapshot.id
     LIMIT 1`,
    [sourceId],
  );
  if (authorityResult.rows[0]) {
    throw new Error(
      'Source service has manual publication authority; choose it as the merge target',
    );
  }
}

// ============================================================
// MERGE SNAPSHOT (LB11: undo capability)
// ============================================================

/**
 * Record a pre-merge snapshot into audit_logs so the merge can be
 * reversed by an oran_admin if needed. Records one bounded identifier +
 * original-FK mapping per mutated row; seeker notes and child payloads are
 * intentionally excluded from the audit log.
 */
async function recordMergeSnapshot(
  client: PoolClient,
  mergeType: 'organization' | 'service',
  targetId: string,
  sourceId: string,
  actorUserId: string,
): Promise<void> {
  const collector: MergeSnapshotCollector = { total: 0, references: [] };
  let sourceLifecycle: Record<string, unknown> | null = null;
  let freshnessLifecycle: Record<string, unknown> | null = null;

  if (mergeType === 'organization') {
    const sourceResult = await client.query<{ id: string; status: string }>(
      `SELECT id, status
       FROM public.organizations
       WHERE id = $1
       FOR UPDATE`,
      [sourceId],
    );
    sourceLifecycle = sourceResult.rows[0] ?? null;

    for (const plan of SIMPLE_ORGANIZATION_CHILDREN) {
      await collectReferenceSnapshot(
        client,
        collector,
        plan.table,
        plan.organizationColumn,
        sourceId,
      );
    }
    await collectReferenceSnapshot(
      client,
      collector,
      'organization_members',
      'organization_id',
      sourceId,
    );
    await collectReferenceSnapshot(
      client,
      collector,
      'user_scope_grants',
      'organization_id',
      sourceId,
    );
    await collectReferenceSnapshot(
      client,
      collector,
      'resource_tags',
      'target_id',
      sourceId,
      'AND source_row.target_type = $2',
      ['organization'],
    );
    await collectReferenceSnapshot(
      client,
      collector,
      'submissions',
      'target_id',
      sourceId,
      'AND source_row.target_type = $2',
      ['organization'],
    );
  } else {
    const sourceResult = await client.query<{
      id: string;
      status: string;
      integrity_hold_at: string | null;
      integrity_hold_reason: string | null;
      integrity_held_by_user_id: string | null;
      updated_by_user_id: string | null;
    }>(
      `SELECT id, status, integrity_hold_at::text AS integrity_hold_at,
              integrity_hold_reason, integrity_held_by_user_id,
              updated_by_user_id
       FROM public.services
       WHERE id = $1
       FOR UPDATE`,
      [sourceId],
    );
    sourceLifecycle = sourceResult.rows[0] ?? null;

    for (const plan of UNIQUE_SERVICE_CHILDREN) {
      await collectReferenceSnapshot(
        client,
        collector,
        plan.table,
        plan.serviceColumn,
        sourceId,
      );
    }
    for (const plan of SIMPLE_SERVICE_CHILDREN) {
      await collectReferenceSnapshot(
        client,
        collector,
        plan.table,
        plan.serviceColumn,
        sourceId,
      );
    }
    await collectReferenceSnapshot(
      client,
      collector,
      'ownership_transfers',
      'service_id',
      sourceId,
      'AND source_row.status = ANY($2::text[])',
      [['pending', 'verified', 'approved']],
    );
    await collectReferenceSnapshot(
      client,
      collector,
      'resource_tags',
      'target_id',
      sourceId,
      'AND source_row.target_type = $2',
      ['service'],
    );
    await collectReferenceSnapshot(
      client,
      collector,
      'submissions',
      'service_id',
      sourceId,
      `AND NOT EXISTS (
         SELECT 1
         FROM oran_internal.resource_freshness_findings finding
         WHERE finding.submission_id = source_row.id
       )`,
    );
    await collectReferenceSnapshot(
      client,
      collector,
      'submissions',
      'target_id',
      sourceId,
      `AND source_row.target_type = $2
       AND NOT EXISTS (
         SELECT 1
         FROM oran_internal.resource_freshness_findings finding
         WHERE finding.submission_id = source_row.id
       )`,
      ['service'],
    );
    await collectReferenceSnapshot(
      client,
      collector,
      'confidence_scores',
      'service_id',
      sourceId,
    );

    const findingResult = await client.query<{
      id: string;
      submission_id: string | null;
      status: string;
      resolved_at: string | null;
      resolution: string | null;
    }>(
      `SELECT id, submission_id, status, resolved_at::text AS resolved_at, resolution
       FROM oran_internal.resource_freshness_findings
       WHERE service_id = $1
         AND status = 'open'
       FOR UPDATE`,
      [sourceId],
    );
    const finding = findingResult.rows[0] ?? null;
    let linkedSubmission: Record<string, unknown> | null = null;
    if (finding?.submission_id) {
      const linkedSubmissionResult = await client.query<Record<string, unknown>>(
        `SELECT id, status, resolved_at::text AS resolved_at, is_locked,
                locked_at::text AS locked_at, locked_by_user_id,
                assigned_to_user_id
         FROM public.submissions
         WHERE id = $1
         FOR UPDATE`,
        [finding.submission_id],
      );
      linkedSubmission = linkedSubmissionResult.rows[0] ?? null;
    }
    freshnessLifecycle = { finding, linkedSubmission };
  }

  await client.query(
    `INSERT INTO audit_logs (action, resource_type, resource_id, before, actor_user_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      `${mergeType}_merge_snapshot`,
      mergeType,
      sourceId,
      JSON.stringify({
        schemaVersion: 2,
        targetId,
        sourceId,
        sourceLifecycle,
        freshnessLifecycle,
        referenceCount: collector.total,
        references: collector.references,
        reversal: {
          strategy: 'restore_reference_columns_by_primary_key',
          sourceStatusField: 'status',
        },
      }),
      actorUserId,
    ],
  );
}

// ============================================================
// ORGANIZATION MERGE
// ============================================================

/**
 * Merge two organizations: move all child entities from source → target,
 * then archive the source organization.
 *
 * Reassigned entities:
 *  - services (organization_id → target)
 *  - organization_members (organization_id → target)
 *  - submissions (target_id → target where target_type = 'organization')
 *
 * This does NOT merge field-level data (name, description, etc.) —
 * the admin should update the target org's details separately.
 */
export async function mergeOrganizations(
  targetId: string,
  sourceId: string,
  actorUserId: string,
): Promise<MergeResult> {
  if (targetId === sourceId) {
    return { success: false, targetId, sourceId, mergedCounts: {}, error: 'Cannot merge an organization into itself' };
  }

  try {
    const counts = await withTransaction(async (client) => {
      // Exclusive side of the publication/merge gate. Publication writers
      // take the shared side before any entity row locks.
      await acquireLivePublicationMergeLock(client);
      await acquireOfflineMaintenanceLocks(client);
      // Authorization is protected by the same transaction as the merge. The
      // row-share lock prevents a concurrent demotion/freeze from committing
      // after the check but before the identity mutation.
      await assertMergeAuthorized(client, actorUserId);

      // Verify both organizations exist and are not archived
      const orgs = await client.query<{ id: string; status: string | null }>(
        `SELECT id, status
         FROM organizations
         WHERE id = ANY($1::uuid[])
         ORDER BY id
         FOR UPDATE`,
        [[targetId, sourceId]],
      );

      if (orgs.rows.length < 2) {
        throw new Error('One or both organizations not found');
      }
      const targetOrg = orgs.rows.find(r => r.id === targetId);
      const sourceOrg = orgs.rows.find(r => r.id === sourceId);
      if (targetOrg?.status !== 'active') {
        throw new Error('Target organization must be active');
      }
      if (sourceOrg?.status === 'defunct') {
        throw new Error('Source organization is already archived');
      }

      await assertOrganizationMergePlanCurrent(client);
      await assertNoUnreconciledNonFkMergeState(client, 'organization', sourceId, targetId);
      await assertNoOrganizationMergeConflicts(client, targetId, sourceId);

      // LB11: Snapshot pre-merge state for undo capability
      await recordMergeSnapshot(client, 'organization', targetId, sourceId, actorUserId);

      // 1. Move every live organization-owned child, including publication
      // and ingestion references that are not visible in the basic admin UI.
      const childCounts = new Map<string, number>();
      for (const plan of SIMPLE_ORGANIZATION_CHILDREN) {
        const key = `${plan.table}.${plan.organizationColumn}`;
        childCounts.set(
          key,
          await moveOrganizationChildren(client, plan, targetId, sourceId),
        );
      }

      // 2. Reassign organization members. Conflicts were rejected before any
      // mutation so role/status metadata is never silently discarded.
      const memResult = await client.query(
        `UPDATE organization_members SET organization_id = $1, updated_at = NOW()
         WHERE organization_id = $2`,
        [targetId, sourceId],
      );

      // User scope grants have the same target-relative uniqueness boundary;
      // the preflight rejects ambiguous duplicates.
      await client.query(
        `UPDATE public.user_scope_grants
         SET organization_id = $1, updated_at = now()
         WHERE organization_id = $2`,
        [targetId, sourceId],
      );

      // Polymorphic tag conflicts were rejected before mutation.
      await client.query(
        `UPDATE public.resource_tags
         SET target_id = $1
         WHERE target_type = 'organization'
           AND target_id = $2`,
        [targetId, sourceId],
      );

      // 4. Reassign submissions targeting the source org
      const subResult = await client.query(
        `UPDATE submissions SET target_id = $1, updated_at = NOW()
         WHERE target_id = $2 AND target_type = 'organization'`,
        [targetId, sourceId],
      );

      // Confidence scores are service-owned, so they move with the services.

      // 5. Archive the source organization
      await client.query(
        `UPDATE organizations SET status = 'defunct', updated_at = NOW() WHERE id = $1`,
        [sourceId],
      );

      await client.query(
        `INSERT INTO public.lifecycle_events
           (entity_type, entity_id, event_type, from_status, to_status,
            actor_type, actor_id, reason, metadata)
         VALUES
           ('organization', $1, 'merged', $2, 'defunct', 'human', $3,
            'Organization identity merged by ORAN administration', $4::jsonb)`,
        [
          sourceId,
          sourceOrg?.status ?? null,
          actorUserId,
          JSON.stringify({
            mergedIntoOrganizationId: targetId,
            preservedHistoryTables: PRESERVED_NON_FK_ENTITY_HISTORY,
          }),
        ],
      );

      // 6. Record audit trail
      await client.query(
        `INSERT INTO audit_logs (action, resource_type, resource_id, after, actor_user_id)
         VALUES ('org_merged', 'organization', $1, $2::jsonb, $3)`,
        [
          targetId,
          JSON.stringify({
            source_id: sourceId,
            services_moved: childCounts.get('services.organization_id') ?? 0,
            members_moved: memResult.rowCount ?? 0,
            submissions_moved: subResult.rowCount ?? 0,
            child_references_reconciled: [...childCounts.keys()],
          }),
          actorUserId,
        ],
      );

      return {
        services: childCounts.get('services.organization_id') ?? 0,
        members: memResult.rowCount ?? 0,
        submissions: subResult.rowCount ?? 0,
        confidenceScores: 0,
      };
    });

    return { success: true, targetId, sourceId, mergedCounts: counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Merge failed';
    return { success: false, targetId, sourceId, mergedCounts: {}, error: message };
  }
}

// ============================================================
// SERVICE MERGE
// ============================================================

/**
 * Merge two services: move child entities from source → target,
 * then mark the source defunct.
 *
 * Reassigned entities:
 *  - service_at_location (service_id → target)
 *  - phones (service_id → target)
 *  - submissions (service_id → target or target_id → target where target_type = 'service')
 *  - confidence_scores (service_id → target)
 */
export async function mergeServices(
  targetId: string,
  sourceId: string,
  actorUserId: string,
): Promise<MergeResult> {
  if (targetId === sourceId) {
    return { success: false, targetId, sourceId, mergedCounts: {}, error: 'Cannot merge a service into itself' };
  }

  try {
    const counts = await withTransaction(async (client) => {
      // Global order: publication/merge gate -> freshness gate -> row locks.
      // Freshness reconciliation follows the same order before it projects
      // live state, preventing a finding from being split from its hold and
      // review packet without introducing an advisory-lock inversion.
      await acquireLivePublicationMergeLock(client);
      await client.query(
        `SELECT pg_catalog.pg_advisory_xact_lock(
           pg_catalog.hashtextextended('oran:resource-freshness-scan', 0)
         )`,
      );
      await acquireOfflineMaintenanceLocks(client);
      await assertMergeAuthorized(client, actorUserId);

      // Verify both services exist
      const svcs = await client.query<{ id: string; status: string | null }>(
        `SELECT id, status
         FROM services
         WHERE id = ANY($1::uuid[])
         ORDER BY id
         FOR UPDATE`,
        [[targetId, sourceId]],
      );

      if (svcs.rows.length < 2) {
        throw new Error('One or both services not found');
      }
      const targetService = svcs.rows.find(r => r.id === targetId);
      const sourceService = svcs.rows.find(r => r.id === sourceId);
      if (targetService?.status !== 'active') {
        throw new Error('Target service must be active');
      }
      if (sourceService?.status === 'defunct') {
        throw new Error('Source service is defunct and cannot be merged');
      }

      await assertServiceMergePlanCurrent(client);
      await assertSourceHasNoManualPublicationAuthority(client, sourceId);
      await assertNoUnreconciledNonFkMergeState(client, 'service', sourceId, targetId);
      await assertNoServiceMergeConflicts(client, targetId, sourceId);

      const activeTransferConflict = await client.query<{ id: string }>(
        `SELECT source_transfer.id::text AS id
         FROM public.ownership_transfers source_transfer
         JOIN public.ownership_transfers target_transfer
           ON target_transfer.service_id = $1
          AND target_transfer.status = ANY($3::text[])
         WHERE source_transfer.service_id = $2
           AND source_transfer.status = ANY($3::text[])
         ORDER BY source_transfer.id, target_transfer.id
         LIMIT 1
         FOR UPDATE OF source_transfer, target_transfer`,
        [targetId, sourceId, ['pending', 'verified', 'approved']],
      );
      if (activeTransferConflict.rows[0]) {
        throw new Error('Cannot merge services while both have active ownership transfers');
      }

      const openFindingResult = await client.query<{
        id: string;
        submission_id: string | null;
        hold_reason: string;
      }>(
        `SELECT id, submission_id, hold_reason
         FROM oran_internal.resource_freshness_findings
         WHERE service_id = $1
           AND status = 'open'
         FOR UPDATE`,
        [sourceId],
      );
      const openFinding = openFindingResult.rows[0] ?? null;
      const freshnessSubmission = openFinding?.submission_id
        ? await client.query<{ id: string; status: string }>(
            `SELECT id, status
             FROM submissions
             WHERE id = $1
             FOR UPDATE`,
            [openFinding.submission_id],
          )
        : null;

      // LB11: Snapshot pre-merge state for undo capability
      await recordMergeSnapshot(client, 'service', targetId, sourceId, actorUserId);

      if (openFinding) {
        const linkedSubmission = freshnessSubmission?.rows[0];
        if (linkedSubmission && linkedSubmission.status !== 'archived') {
          await client.query(
            `INSERT INTO submission_transitions
               (submission_id, from_status, to_status, actor_user_id, actor_role,
                reason, gates_checked, gates_passed, metadata)
             VALUES ($1, $2, 'archived', $3, 'oran_admin', $4, $5::jsonb, true, $6::jsonb)`,
            [
              linkedSubmission.id,
              linkedSubmission.status,
              actorUserId,
              'Freshness review retired because its source service was merged',
              JSON.stringify([{
                gate: 'service_merge_retirement',
                passed: true,
                message: 'Source service is being merged by an ORAN admin',
              }]),
              JSON.stringify({
                resourceFreshnessFindingId: openFinding.id,
                mergedIntoServiceId: targetId,
              }),
            ],
          );
          await client.query(
            `UPDATE submissions
             SET status = 'archived',
                 resolved_at = coalesce(resolved_at, now()),
                 is_locked = false,
                 locked_at = NULL,
                 locked_by_user_id = NULL,
                 assigned_to_user_id = NULL,
                 updated_at = now()
             WHERE id = $1`,
            [linkedSubmission.id],
          );
        }

        await client.query(
          `UPDATE oran_internal.resource_freshness_findings
           SET status = 'resolved',
               resolved_at = now(),
               resolution = $2
           WHERE id = $1
             AND status = 'open'`,
          [openFinding.id, `service_merged_into:${targetId}`],
        );
        await client.query(
          `UPDATE services
           SET integrity_hold_at = NULL,
               integrity_hold_reason = NULL,
               integrity_held_by_user_id = NULL,
               updated_by_user_id = $3,
               updated_at = now()
           WHERE id = $1
             AND integrity_hold_reason = $2
             AND integrity_held_by_user_id = 'system:resource-freshness-scan'`,
          [sourceId, openFinding.hold_reason, actorUserId],
        );
      }

      // 1. Move every child only after every ambiguity check and the bounded
      // reversal snapshot have succeeded.
      const uniqueMoved = new Map<string, number>();
      for (const plan of UNIQUE_SERVICE_CHILDREN) {
        uniqueMoved.set(
          plan.table,
          await moveUniqueServiceChildren(client, plan, targetId, sourceId),
        );
      }
      const simpleMoved = new Map<string, number>();
      for (const plan of SIMPLE_SERVICE_CHILDREN) {
        simpleMoved.set(
          plan.table,
          await moveSimpleServiceChildren(client, plan, targetId, sourceId),
        );
      }

      await client.query(
        `UPDATE public.ownership_transfers
         SET service_id = $1, updated_at = now()
         WHERE service_id = $2
           AND status = ANY($3::text[])`,
        [targetId, sourceId, ['pending', 'verified', 'approved']],
      );

      // Polymorphic tag conflicts were rejected before mutation.
      await client.query(
        `UPDATE public.resource_tags
         SET target_id = $1
         WHERE target_type = 'service'
           AND target_id = $2`,
        [targetId, sourceId],
      );

      // 2. Reassign submissions. Freshness audit submissions stay bound to
      // the resolved source finding and are archived above.
      const subResult = await client.query(
        `UPDATE submissions sub SET service_id = $1, updated_at = NOW()
         WHERE sub.service_id = $2
           AND NOT EXISTS (
             SELECT 1
             FROM oran_internal.resource_freshness_findings finding
             WHERE finding.submission_id = sub.id
           )`,
        [targetId, sourceId],
      );

      // Also update submissions targeting the source service
      await client.query(
        `UPDATE submissions sub SET target_id = $1, updated_at = NOW()
         WHERE sub.target_id = $2 AND sub.target_type = 'service'
           AND NOT EXISTS (
             SELECT 1
             FROM oran_internal.resource_freshness_findings finding
             WHERE finding.submission_id = sub.id
           )`,
        [targetId, sourceId],
      );

      // 3. Confidence collisions are ambiguous and were rejected. A lone
      // source score can therefore move without changing any score evidence.
      const movedScore = await client.query(
        `UPDATE public.confidence_scores
         SET service_id = $1, updated_at = now()
         WHERE service_id = $2`,
        [targetId, sourceId],
      );
      const confidenceScoresMoved = movedScore.rowCount ?? 0;

      // 4. Retire the source permanently only after every live child move has
      // completed successfully. `defunct` prevents direct-edit workflows from
      // treating a merged identity as a temporarily inactive listing.
      await client.query(
        `UPDATE services SET status = 'defunct', updated_at = NOW() WHERE id = $1`,
        [sourceId],
      );

      await client.query(
        `INSERT INTO public.lifecycle_events
           (entity_type, entity_id, event_type, from_status, to_status,
            actor_type, actor_id, reason, metadata)
         VALUES
           ('service', $1, 'merged', $2, 'defunct', 'human', $3,
            'Service identity merged by ORAN administration', $4::jsonb)`,
        [
          sourceId,
          sourceService?.status ?? null,
          actorUserId,
          JSON.stringify({
            mergedIntoServiceId: targetId,
            preservedHistoryTables: PRESERVED_NON_FK_ENTITY_HISTORY,
          }),
        ],
      );

      // 5. Audit trail
      await client.query(
        `INSERT INTO audit_logs (action, resource_type, resource_id, after, actor_user_id)
         VALUES ('service_merged', 'service', $1, $2::jsonb, $3)`,
        [
          targetId,
          JSON.stringify({
            source_id: sourceId,
            locations_moved: uniqueMoved.get('service_at_location') ?? 0,
            phones_moved: simpleMoved.get('phones') ?? 0,
            submissions_moved: subResult.rowCount ?? 0,
            child_tables_reconciled: [
              ...UNIQUE_SERVICE_CHILDREN.map((plan) => plan.table),
              ...SIMPLE_SERVICE_CHILDREN.map((plan) => plan.table),
            ],
          }),
          actorUserId,
        ],
      );

      return {
        locations: uniqueMoved.get('service_at_location') ?? 0,
        phones: simpleMoved.get('phones') ?? 0,
        submissions: subResult.rowCount ?? 0,
        confidenceScores: confidenceScoresMoved,
      };
    });

    return { success: true, targetId, sourceId, mergedCounts: counts };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Merge failed';
    return { success: false, targetId, sourceId, mergedCounts: {}, error: message };
  }
}

// ============================================================
// PREVIEW (read-only check before merge)
// ============================================================

/**
 * Preview what a merge would affect without making changes.
 */
export async function previewOrganizationMerge(
  targetId: string,
  sourceId: string,
): Promise<{
  target: { id: string; name: string; serviceCount: number };
  source: { id: string; name: string; serviceCount: number };
  wouldMerge: { services: number; members: number; submissions: number };
}> {
  const [target] = await executeQuery<{ id: string; name: string; service_count: string }>(
    `SELECT o.id, o.name, COUNT(s.id)::text as service_count
     FROM organizations o
     LEFT JOIN services s ON s.organization_id = o.id
     WHERE o.id = $1
     GROUP BY o.id`,
    [targetId],
  );

  const [source] = await executeQuery<{ id: string; name: string; service_count: string }>(
    `SELECT o.id, o.name, COUNT(s.id)::text as service_count
     FROM organizations o
     LEFT JOIN services s ON s.organization_id = o.id
     WHERE o.id = $1
     GROUP BY o.id`,
    [sourceId],
  );

  if (!target || !source) {
    throw new Error('One or both organizations not found');
  }

  const [memberCount] = await executeQuery<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM organization_members
     WHERE organization_id = $1
       AND user_id NOT IN (SELECT user_id FROM organization_members WHERE organization_id = $2)`,
    [sourceId, targetId],
  );

  const [subCount] = await executeQuery<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM submissions
     WHERE target_id = $1 AND target_type = 'organization'`,
    [sourceId],
  );

  return {
    target: { id: target.id, name: target.name, serviceCount: parseInt(target.service_count, 10) },
    source: { id: source.id, name: source.name, serviceCount: parseInt(source.service_count, 10) },
    wouldMerge: {
      services: parseInt(source.service_count, 10),
      members: parseInt(memberCount?.count ?? '0', 10),
      submissions: parseInt(subCount?.count ?? '0', 10),
    },
  };
}
