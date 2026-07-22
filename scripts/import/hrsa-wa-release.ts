#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Pool, type PoolClient } from 'pg';

import {
  appendLifecycleEvent,
  replaceCurrentSnapshot,
  upsertConfidenceScore,
} from '../../src/services/publication/livePublication';
import { decidePublicationOverwrite } from '../../src/services/publication/liveAuthority';
import {
  assertAllowedRuntimeEndpoint,
  assertExpectedSupabaseProjectDatabaseEndpoint,
} from '../../src/services/runtime/providerPolicy';
import {
  HRSA_ADMIN_HOLD_REASON_PREFIX,
  HRSA_DATASET_PAGE_URL,
  HRSA_RELEASE_ACTOR,
  HRSA_SITE_CSV_URL,
  HRSA_SOURCE_LICENSE,
  HRSA_TERMS_URL,
  HRSA_WITHDRAWAL_HOLD_REASON_PREFIX,
  assertExpectedHrsaWaCohort,
  buildHrsaOrganizationFacts,
  buildHrsaSnapshotMetadata,
  buildHrsaSourceAssertion,
  canonicalHrsaIds,
  hrsaHoldBatchSlug,
  hrsaHoldReason,
  hrsaServiceDescription,
  hrsaServiceName,
  hrsaWithdrawalReason,
  isHrsaManagedHold,
  legacyHrsaIds,
  parseHrsaWaSnapshot,
  sha256Hex,
  uuidV5,
  type HrsaSnapshotMetadata,
  type HrsaWaAdminOnlySite,
  type HrsaWaCohort,
  type HrsaWaSite,
  type HrsaWaSiteIdentity,
} from '../../src/services/ingestion/hrsaWa';

type ReleaseMode = 'dry-run' | 'apply' | 'rollback-holds';

interface CliOptions {
  mode: ReleaseMode;
  file: string | null;
  databaseCheck: boolean;
  localDisposable: boolean;
  expectedSha256: string | null;
  expectedIncluded: number | null;
  expectedAdminOnly: number | null;
  expectedInactive: number | null;
  expectedExistingServices: number | null;
  retrievedAt: string | null;
  etag: string | null;
  lastModified: string | null;
  actorId: string;
}

interface SnapshotInput {
  bytes: Buffer;
  retrievedAt: string;
  etag: string | null;
  lastModified: string | null;
}

interface LiveServiceState {
  id: string;
  organization_id: string;
  status: string;
  integrity_hold_at: string | null;
  integrity_hold_reason: string | null;
  integrity_held_by_user_id: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
}

interface DatabasePlan {
  existingIncludedServices: number;
  missingIncludedServices: number;
  existingAdminOnlyServices: number;
  heldAdminOnlyServices: number;
  matchingCurrentSnapshots: number;
  existingHoldBatchStatus: string | null;
}

const SOURCE_SYSTEM_NAME = 'HRSA Health Center Program';
const SOURCE_FEED_NAME = 'WA service-delivery sites';
const SOURCE_SYSTEM_ID = uuidV5('source-system:hrsa-health-center-program');
const SOURCE_FEED_ID = uuidV5('source-feed:hrsa-wa-service-delivery-sites');
const HEALTHCARE_TAXONOMY_ID = uuidV5('tax:healthcare');

function usage(): string {
  return [
    'Usage:',
    '  pnpm ingest:hrsa-wa -- --dry-run [--file snapshot.csv] [expectations]',
    '  pnpm ingest:hrsa-wa -- --apply --expected-sha256 <sha> --expected-included <n> --expected-admin-only <n> [--expected-inactive <n>] [--file snapshot.csv]',
    '  pnpm ingest:hrsa-wa -- --rollback-holds --expected-sha256 <sha> --expected-included <n> --expected-admin-only <n> [--expected-inactive <n>] [--file snapshot.csv]',
    '',
    'Options:',
    '  --database-check                    Read the target DB during dry-run; never writes',
    '  --local-disposable                  Use MIGRATION_DATABASE_URL only for a localhost disposable DB',
    '  --expected-existing-services <n>   First-run legacy reconciliation guard',
    '  --expected-inactive <n>            Explicitly acknowledge inactive WA rows (default 0)',
    '  --retrieved-at <ISO>               Required for a local file in apply/rollback mode',
    '  --etag <value>                     Source response ETag for a local file',
    '  --last-modified <value>            Source response Last-Modified for a local file',
    '  --actor-id <id>                    Audit actor (default system:hrsa-wa-release)',
    '',
    'Apply/rollback require SUPABASE_DB_URL and SUPABASE_PROJECT_REF. The URL is validated and never printed.',
  ].join('\n');
}

function positiveInteger(raw: string | undefined, option: string): number {
  const value = Number.parseInt(raw ?? '', 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${option} must be a non-negative integer`);
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    mode: 'dry-run',
    file: null,
    databaseCheck: false,
    localDisposable: false,
    expectedSha256: null,
    expectedIncluded: null,
    expectedAdminOnly: null,
    expectedInactive: null,
    expectedExistingServices: null,
    retrievedAt: null,
    etag: null,
    lastModified: null,
    actorId: HRSA_RELEASE_ACTOR,
  };
  let modeCount = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--help') {
      console.log(usage());
      process.exit(0);
    }
    if (arg === '--dry-run' || arg === '--apply' || arg === '--rollback-holds') {
      options.mode = arg.slice(2) as ReleaseMode;
      modeCount += 1;
      continue;
    }
    if (arg === '--database-check') {
      options.databaseCheck = true;
      continue;
    }
    if (arg === '--local-disposable') {
      options.localDisposable = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
    index += 1;
    if (arg === '--file') options.file = value;
    else if (arg === '--expected-sha256') options.expectedSha256 = value.trim().toLowerCase();
    else if (arg === '--expected-included') options.expectedIncluded = positiveInteger(value, arg);
    else if (arg === '--expected-admin-only') options.expectedAdminOnly = positiveInteger(value, arg);
    else if (arg === '--expected-inactive') options.expectedInactive = positiveInteger(value, arg);
    else if (arg === '--expected-existing-services') {
      options.expectedExistingServices = positiveInteger(value, arg);
    } else if (arg === '--retrieved-at') options.retrievedAt = value;
    else if (arg === '--etag') options.etag = value;
    else if (arg === '--last-modified') options.lastModified = value;
    else if (arg === '--actor-id') options.actorId = value.trim();
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (modeCount > 1) throw new Error('Choose exactly one of --dry-run, --apply, or --rollback-holds');
  if (!options.actorId) throw new Error('--actor-id cannot be blank');
  if (options.expectedSha256 && !/^[0-9a-f]{64}$/u.test(options.expectedSha256)) {
    throw new Error('--expected-sha256 must contain 64 lowercase hexadecimal characters');
  }
  if (options.mode !== 'dry-run') {
    if (!options.expectedSha256) throw new Error('--expected-sha256 is required for writes');
    if (options.expectedIncluded === null) throw new Error('--expected-included is required for writes');
    if (options.expectedAdminOnly === null) throw new Error('--expected-admin-only is required for writes');
    if (options.file && !options.retrievedAt) {
      throw new Error('--retrieved-at is required when applying or rolling back from a local file');
    }
  }
  return options;
}

async function loadSnapshot(options: CliOptions): Promise<SnapshotInput> {
  if (options.file) {
    return {
      bytes: await readFile(resolve(process.cwd(), options.file)),
      retrievedAt: options.retrievedAt ?? new Date().toISOString(),
      etag: options.etag,
      lastModified: options.lastModified,
    };
  }

  const response = await fetch(HRSA_SITE_CSV_URL, {
    redirect: 'error',
    headers: { Accept: 'text/csv,application/octet-stream;q=0.9' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HRSA snapshot fetch returned HTTP ${response.status}`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    retrievedAt: options.retrievedAt ?? new Date().toISOString(),
    etag: options.etag ?? response.headers.get('etag'),
    lastModified: options.lastModified ?? response.headers.get('last-modified'),
  };
}

function validatedDatabaseUrl(options: CliOptions): string {
  if (options.localDisposable) {
    const localUrl = process.env.MIGRATION_DATABASE_URL?.trim();
    if (!localUrl) throw new Error('MIGRATION_DATABASE_URL is required with --local-disposable');
    const parsed = new URL(localUrl);
    const localHost = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    const disposableDatabase = /(?:disposable|test)/iu.test(parsed.pathname);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !localHost || !disposableDatabase) {
      throw new Error('--local-disposable accepts only a localhost disposable/test PostgreSQL database');
    }
    return localUrl;
  }
  const databaseUrl = process.env.SUPABASE_DB_URL?.trim();
  const projectRef = process.env.SUPABASE_PROJECT_REF?.trim();
  if (!databaseUrl) throw new Error('SUPABASE_DB_URL is required for database checks or writes');
  if (!projectRef) throw new Error('SUPABASE_PROJECT_REF is required for database checks or writes');
  assertAllowedRuntimeEndpoint(databaseUrl, 'SUPABASE_DB_URL', { NODE_ENV: 'production' });
  assertExpectedSupabaseProjectDatabaseEndpoint(
    databaseUrl,
    projectRef,
    'SUPABASE_DB_URL',
    'SUPABASE_PROJECT_REF',
  );
  return databaseUrl;
}

async function assertDatabasePrerequisites(client: PoolClient): Promise<void> {
  const state = await client.query<{
    is_read_only: boolean;
    entity_type_constraint: string | null;
    quarantine_batches: string | null;
    quarantine_members: string | null;
  }>(
    `SELECT current_setting('transaction_read_only') = 'on' AS is_read_only,
            (
              SELECT pg_get_constraintdef(c.oid)
              FROM pg_constraint c
              WHERE c.conrelid = 'public.entity_identifiers'::regclass
                AND c.conname = 'entity_identifiers_entity_type_check'
            ) AS entity_type_constraint,
            to_regclass('oran_internal.resource_quarantine_batches')::text AS quarantine_batches,
            to_regclass('oran_internal.resource_quarantine_members')::text AS quarantine_members`,
  );
  const row = state.rows[0];
  if (!row) throw new Error('Could not inspect the target database');
  if (!row.entity_type_constraint?.includes('canonical_service')) {
    throw new Error('0073 canonical entity identifier migration is not applied');
  }
  if (!row.quarantine_batches || !row.quarantine_members) {
    throw new Error('Reversible resource-quarantine controls are not installed');
  }
}

async function loadLiveServiceStates(
  client: PoolClient,
  sites: HrsaWaSiteIdentity[],
): Promise<Map<string, LiveServiceState>> {
  const ids = sites.map((site) => legacyHrsaIds(site).serviceId);
  if (ids.length === 0) return new Map();
  const result = await client.query<LiveServiceState>(
    `SELECT id, organization_id, status, integrity_hold_at, integrity_hold_reason,
            integrity_held_by_user_id, created_by_user_id, updated_by_user_id
       FROM public.services
      WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function databasePlan(
  client: PoolClient,
  cohort: HrsaWaCohort,
  snapshot: HrsaSnapshotMetadata,
): Promise<DatabasePlan> {
  const includedStates = await loadLiveServiceStates(client, cohort.included);
  const adminStates = await loadLiveServiceStates(client, cohort.adminOnly);
  const includedIds = cohort.included.map((site) => legacyHrsaIds(site).serviceId);
  const snapshotMatches = includedIds.length === 0
    ? { rows: [{ count: '0' }] }
    : await client.query<{ count: string }>(
        `SELECT count(DISTINCT snap.entity_id)::text AS count
           FROM public.hsds_export_snapshots snap
          WHERE snap.entity_id = ANY($1::uuid[])
            AND snap.entity_type = 'service'
            AND snap.status = 'current'
            AND snap.hsds_payload #>> '{meta,sourceSnapshotSha256}' = $2`,
        [includedIds, snapshot.sha256],
      );
  const batch = await client.query<{ status: string }>(
    `SELECT status
       FROM oran_internal.resource_quarantine_batches
      WHERE slug = $1`,
    [hrsaHoldBatchSlug(snapshot.sha256)],
  );
  return {
    existingIncludedServices: includedStates.size,
    missingIncludedServices: cohort.included.length - includedStates.size,
    existingAdminOnlyServices: adminStates.size,
    heldAdminOnlyServices: [...adminStates.values()].filter((row) => row.integrity_hold_at).length,
    matchingCurrentSnapshots: Number.parseInt(snapshotMatches.rows[0]?.count ?? '0', 10),
    existingHoldBatchStatus: batch.rows[0]?.status ?? null,
  };
}

async function releaseManagedHoldsForIncludedSites(
  client: PoolClient,
  cohort: HrsaWaCohort,
  actorId: string,
): Promise<number> {
  const serviceIds = cohort.included.map((site) => legacyHrsaIds(site).serviceId);
  if (serviceIds.length === 0) return 0;
  const released = await client.query(
    `UPDATE public.services
        SET status = 'active', integrity_hold_at = NULL, integrity_hold_reason = NULL,
            integrity_held_by_user_id = NULL, updated_at = NOW(), updated_by_user_id = $2
      WHERE id = ANY($1::uuid[])
        AND created_by_user_id = 'import:hrsa'
        AND status = 'inactive'
        AND integrity_held_by_user_id = $3
        AND (
          integrity_hold_reason LIKE $4 || '%'
          OR integrity_hold_reason LIKE $5 || '%'
        )`,
    [
      serviceIds,
      actorId,
      HRSA_RELEASE_ACTOR,
      HRSA_ADMIN_HOLD_REASON_PREFIX,
      HRSA_WITHDRAWAL_HOLD_REASON_PREFIX,
    ],
  );
  return released.rowCount ?? 0;
}

interface ManagedCanonicalPublication {
  canonical_service_id: string;
  canonical_location_id: string | null;
  published_service_id: string | null;
  site_id: string;
}

async function withdrawNoLongerIncludedSites(
  client: PoolClient,
  cohort: HrsaWaCohort,
  snapshot: HrsaSnapshotMetadata,
  sourceSystemId: string,
  actorId: string,
): Promise<number> {
  const managed = await client.query<ManagedCanonicalPublication>(
    `SELECT canonical_service.id AS canonical_service_id,
            location_identifier.entity_id AS canonical_location_id,
            canonical_service.published_service_id,
            service_identifier.identifier_value AS site_id
       FROM public.canonical_services canonical_service
       JOIN public.entity_identifiers service_identifier
         ON service_identifier.entity_type = 'canonical_service'
        AND service_identifier.entity_id = canonical_service.id
        AND service_identifier.identifier_scheme = 'hrsa_bphc_site'
        AND service_identifier.status = 'active'
       LEFT JOIN public.entity_identifiers location_identifier
         ON location_identifier.entity_type = 'canonical_location'
        AND location_identifier.identifier_scheme = 'hrsa_bphc_site_location'
        AND location_identifier.identifier_value = service_identifier.identifier_value
        AND location_identifier.status = 'active'
      WHERE canonical_service.winning_source_system_id = $1
        AND canonical_service.status = 'active'
        AND canonical_service.lifecycle_status = 'active'
        AND canonical_service.publication_status = 'published'
        AND NOT (service_identifier.identifier_value = ANY($2::text[]))
      FOR UPDATE OF canonical_service`,
    [sourceSystemId, cohort.included.map((site) => site.siteId)],
  );
  const withdrawalReason = hrsaWithdrawalReason(snapshot.sha256);

  for (const publication of managed.rows) {
    await client.query(
      `UPDATE public.canonical_services
          SET status = 'inactive', lifecycle_status = 'withdrawn',
              publication_status = 'retracted', last_refreshed_at = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [publication.canonical_service_id, snapshot.retrievedAt],
    );
    if (publication.canonical_location_id) {
      await client.query(
        `UPDATE public.canonical_locations
            SET lifecycle_status = 'withdrawn', publication_status = 'retracted',
                last_refreshed_at = $2, updated_at = NOW()
          WHERE id = $1`,
        [publication.canonical_location_id, snapshot.retrievedAt],
      );
    }
    await client.query(
      `UPDATE public.canonical_provenance provenance
          SET decision_status = 'superseded', decided_at = NOW(), decided_by = $4,
              updated_at = NOW()
         FROM public.source_records record
         JOIN public.source_feeds feed ON feed.id = record.source_feed_id
        WHERE provenance.source_record_id = record.id
          AND feed.source_system_id = $1
          AND provenance.decision_status = 'accepted'
          AND (
            (provenance.canonical_entity_type = 'service' AND provenance.canonical_entity_id = $2)
            OR (
              $3::uuid IS NOT NULL
              AND provenance.canonical_entity_type = 'location'
              AND provenance.canonical_entity_id = $3::uuid
            )
          )`,
      [
        sourceSystemId,
        publication.canonical_service_id,
        publication.canonical_location_id,
        actorId,
      ],
    );

    if (!publication.published_service_id) continue;
    const overwrite = await decidePublicationOverwrite(
      client,
      publication.published_service_id,
      'canonical_feed',
    );
    const currentMeta = overwrite.current?.payload?.meta;
    const currentMetaRecord = currentMeta && typeof currentMeta === 'object'
      ? currentMeta as Record<string, unknown>
      : null;
    const ownsCurrentSnapshot = !overwrite.current
      || (
        currentMetaRecord?.generatedBy === 'oran-hrsa-wa-release'
        && currentMetaRecord.canonicalServiceId === publication.canonical_service_id
      );
    if (!overwrite.shouldOverwrite || !ownsCurrentSnapshot) continue;

    const held = await client.query(
      `UPDATE public.services
          SET status = 'inactive', integrity_hold_at = NOW(), integrity_hold_reason = $2,
              integrity_held_by_user_id = $3, updated_at = NOW(), updated_by_user_id = $4
        WHERE id = $1
          AND created_by_user_id = 'import:hrsa'
          AND (
            (status = 'active' AND integrity_hold_at IS NULL AND integrity_hold_reason IS NULL)
            OR (
              status = 'inactive'
              AND integrity_held_by_user_id = $3
              AND (
                integrity_hold_reason LIKE $5 || '%'
                OR integrity_hold_reason LIKE $6 || '%'
              )
            )
          )`,
      [
        publication.published_service_id,
        withdrawalReason,
        HRSA_RELEASE_ACTOR,
        actorId,
        HRSA_ADMIN_HOLD_REASON_PREFIX,
        HRSA_WITHDRAWAL_HOLD_REASON_PREFIX,
      ],
    );
    const withdrawnSnapshots = await client.query(
      `UPDATE public.hsds_export_snapshots
          SET status = 'withdrawn', withdrawn_at = NOW()
        WHERE entity_type = 'service'
          AND entity_id = $1
          AND status = 'current'
          AND hsds_payload #>> '{meta,generatedBy}' = 'oran-hrsa-wa-release'
          AND hsds_payload #>> '{meta,canonicalServiceId}' = $2`,
      [publication.published_service_id, publication.canonical_service_id],
    );
    if ((held.rowCount ?? 0) > 0 || (withdrawnSnapshots.rowCount ?? 0) > 0) {
      await appendLifecycleEvent(client, {
        entityType: 'service',
        entityId: publication.published_service_id,
        eventType: 'status_changed',
        fromStatus: 'published',
        toStatus: 'withdrawn',
        actorType: 'system',
        actorId,
        metadata: {
          canonicalServiceId: publication.canonical_service_id,
          sourceSiteId: publication.site_id,
          sourceSnapshotSha256: snapshot.sha256,
          reason: 'not included in the current acknowledged HRSA WA release cohort',
        },
        snapshotsInvalidated: withdrawnSnapshots.rowCount ?? 0,
      });
    }
  }

  return managed.rows.length;
}

function assertPreexistingServiceOwnership(
  sites: HrsaWaSiteIdentity[],
  states: Map<string, LiveServiceState>,
  options: { allowManagedHold: boolean },
): void {
  for (const site of sites) {
    const expected = legacyHrsaIds(site);
    const state = states.get(expected.serviceId);
    if (!state) continue;
    if (state.created_by_user_id !== 'import:hrsa') {
      throw new Error(`Refusing HRSA reconciliation: service ${state.id} is not legacy import:hrsa data`);
    }
    const hasManagedHold = isHrsaManagedHold({
      status: state.status,
      integrityHoldReason: state.integrity_hold_reason,
      integrityHeldByUserId: state.integrity_held_by_user_id,
    });
    if (options.allowManagedHold && hasManagedHold) continue;
    if (state.status !== 'active' || state.integrity_hold_at || state.integrity_hold_reason) {
      throw new Error(`Refusing HRSA reconciliation: service ${state.id} has a newer status or integrity hold`);
    }
  }
}

async function assertCanonicalIdentifierOwnership(
  client: PoolClient,
  cohort: HrsaWaCohort,
): Promise<void> {
  const schemes = [
    'hrsa_health_center_number',
    'hrsa_bphc_site',
    'hrsa_bphc_site_location',
  ];
  const identifiers = await client.query<{
    entity_type: string;
    entity_id: string;
    identifier_scheme: string;
    identifier_value: string;
  }>(
    `SELECT entity_type, entity_id, identifier_scheme, identifier_value
       FROM public.entity_identifiers
      WHERE status = 'active'
        AND identifier_scheme = ANY($1::text[])`,
    [schemes],
  );
  const expected = new Map<string, { entityType: string; entityId: string }>();
  for (const site of cohort.included) {
    const canonical = canonicalHrsaIds(site);
    expected.set(`hrsa_health_center_number:${site.healthCenterNumber}`, {
      entityType: 'canonical_organization',
      entityId: canonical.organizationId,
    });
    expected.set(`hrsa_bphc_site:${site.siteId}`, {
      entityType: 'canonical_service',
      entityId: canonical.serviceId,
    });
    expected.set(`hrsa_bphc_site_location:${site.siteId}`, {
      entityType: 'canonical_location',
      entityId: canonical.locationId,
    });
  }
  for (const row of identifiers.rows) {
    const key = `${row.identifier_scheme}:${row.identifier_value}`;
    const match = expected.get(key);
    if (!match) continue;
    if (row.entity_type !== match.entityType || row.entity_id !== match.entityId) {
      throw new Error(`Canonical HRSA identifier collision for ${key}`);
    }
  }
}

async function upsertSourceRegistry(
  client: PoolClient,
  snapshot: HrsaSnapshotMetadata,
  actorId: string,
): Promise<{ sourceSystemId: string; sourceFeedId: string }> {
  const source = await client.query<{ id: string }>(
    `INSERT INTO public.source_systems (
       id, name, family, homepage_url, license_notes, terms_url, trust_tier,
       resource_purpose, jurisdiction_scope, is_active, notes
     ) VALUES (
       $1, $2, 'government_open_data', $3, $4, $5, 'verified_publisher',
       'service_catalog', $6::jsonb, true, $7
     )
     ON CONFLICT (name) DO UPDATE SET
       family = EXCLUDED.family,
       homepage_url = EXCLUDED.homepage_url,
       license_notes = EXCLUDED.license_notes,
       terms_url = EXCLUDED.terms_url,
       trust_tier = EXCLUDED.trust_tier,
       resource_purpose = EXCLUDED.resource_purpose,
       jurisdiction_scope = EXCLUDED.jurisdiction_scope,
       is_active = true,
       notes = EXCLUDED.notes,
       updated_at = NOW()
     RETURNING id`,
    [
      SOURCE_SYSTEM_ID,
      SOURCE_SYSTEM_NAME,
      HRSA_DATASET_PAGE_URL,
      HRSA_SOURCE_LICENSE,
      HRSA_TERMS_URL,
      JSON.stringify({ country: 'US', state: 'WA' }),
      `Controlled WA release; last snapshot ${snapshot.sha256}; actor ${actorId}`,
    ],
  );
  const sourceSystemId = source.rows[0]?.id;
  if (!sourceSystemId) throw new Error('Could not register the HRSA source system');

  const existingFeeds = await client.query<{ id: string }>(
    `SELECT id FROM public.source_feeds
      WHERE source_system_id = $1 AND feed_name = $2
      ORDER BY created_at`,
    [sourceSystemId, SOURCE_FEED_NAME],
  );
  if (existingFeeds.rows.length > 1) throw new Error('Duplicate HRSA WA source feeds require review');
  const sourceFeedId = existingFeeds.rows[0]?.id ?? SOURCE_FEED_ID;
  await client.query(
    `INSERT INTO public.source_feeds (
       id, source_system_id, feed_name, feed_type, feed_handler, base_url,
       healthcheck_url, auth_type, jurisdiction_scope, refresh_interval_hours, is_active
     ) VALUES ($1, $2, $3, 'csv', 'none', $4, $5, 'none', $6::jsonb, 24, true)
     ON CONFLICT (id) DO UPDATE SET
       source_system_id = EXCLUDED.source_system_id,
       feed_name = EXCLUDED.feed_name,
       feed_type = EXCLUDED.feed_type,
       feed_handler = EXCLUDED.feed_handler,
       base_url = EXCLUDED.base_url,
       healthcheck_url = EXCLUDED.healthcheck_url,
       jurisdiction_scope = EXCLUDED.jurisdiction_scope,
       is_active = true,
       updated_at = NOW()`,
    [
      sourceFeedId,
      sourceSystemId,
      SOURCE_FEED_NAME,
      HRSA_SITE_CSV_URL,
      HRSA_DATASET_PAGE_URL,
      JSON.stringify({ country: 'US', state: 'WA' }),
    ],
  );
  const existingFeedState = await client.query<{ emergency_pause: boolean }>(
    `SELECT emergency_pause
       FROM public.source_feed_states
      WHERE source_feed_id = $1
      FOR UPDATE`,
    [sourceFeedId],
  );
  if (existingFeedState.rows[0]?.emergency_pause) {
    throw new Error('HRSA WA source feed is emergency-paused; release refused');
  }
  await client.query(
    `INSERT INTO public.source_feed_states (
       source_feed_id, publication_mode, auto_publish_approved_at,
       auto_publish_approved_by, emergency_pause, last_attempt_status, notes
     ) VALUES ($1, 'auto_publish', NOW(), $2, false, 'running', $3)
     ON CONFLICT (source_feed_id) DO UPDATE SET
       publication_mode = 'auto_publish',
       auto_publish_approved_at = COALESCE(source_feed_states.auto_publish_approved_at, NOW()),
       auto_publish_approved_by = EXCLUDED.auto_publish_approved_by,
       last_attempt_status = 'running',
       last_attempt_started_at = NOW(),
       notes = EXCLUDED.notes,
       updated_at = NOW()`,
    [sourceFeedId, actorId, 'Founder-authorized regional production release.'],
  );
  return { sourceSystemId, sourceFeedId };
}

async function upsertSourceRecord(
  client: PoolClient,
  input: {
    site: HrsaWaSite | HrsaWaAdminOnlySite;
    snapshot: HrsaSnapshotMetadata;
    sourceFeedId: string;
    correlationId: string;
    status: 'pending' | 'rejected';
    processingError?: string;
  },
): Promise<string> {
  const assertion = buildHrsaSourceAssertion(input.site, input.snapshot);
  const id = uuidV5(
    `source-record:hrsa-wa:${input.site.siteId}:${assertion.payloadSha256}`,
  );
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO public.source_records (
       id, source_feed_id, source_record_type, source_record_id, source_version,
       fetched_at, canonical_source_url, payload_sha256, raw_payload, parsed_payload,
       correlation_id, source_license, source_confidence_signals,
       processing_status, processing_error, processed_at
     ) VALUES (
       $1, $2, 'mixed_bundle', $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb,
       $10, $11, $12::jsonb, $13, $14, CASE WHEN $13 = 'rejected' THEN NOW() ELSE NULL END
     )
     ON CONFLICT (source_feed_id, source_record_type, source_record_id, payload_sha256)
     DO NOTHING
     RETURNING id`,
    [
      id,
      input.sourceFeedId,
      assertion.sourceRecordId,
      assertion.sourceVersion,
      input.snapshot.retrievedAt,
      assertion.canonicalSourceUrl,
      assertion.payloadSha256,
      JSON.stringify(assertion.rawPayload),
      JSON.stringify({
        ...assertion.parsedPayload,
        ...(input.status === 'rejected'
          ? { publicationDecision: { status: 'rejected', reason: input.processingError } }
          : {}),
      }),
      input.correlationId,
      assertion.sourceLicense,
      JSON.stringify({
        ...assertion.sourceConfidenceSignals,
        ...(input.status === 'rejected'
          ? { publicationDecision: 'excluded_administrative_only' }
          : {}),
      }),
      input.status,
      input.processingError ?? null,
    ],
  );
  if (inserted.rows[0]?.id) return inserted.rows[0].id;
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM public.source_records
      WHERE source_feed_id = $1
        AND source_record_type = 'mixed_bundle'
        AND source_record_id = $2
        AND payload_sha256 = $3`,
    [input.sourceFeedId, assertion.sourceRecordId, assertion.payloadSha256],
  );
  const existingId = existing.rows[0]?.id;
  if (!existingId) throw new Error(`Could not resolve HRSA source record ${input.site.siteId}`);
  if (input.status === 'rejected') {
    await client.query(
      `UPDATE public.source_records
          SET processing_status = 'rejected', processing_error = $2, processed_at = NOW()
        WHERE id = $1 AND processing_status <> 'published'`,
      [existingId, input.processingError ?? null],
    );
  }
  return existingId;
}

async function insertCanonicalIdentifier(
  client: PoolClient,
  input: {
    entityType: 'canonical_organization' | 'canonical_service' | 'canonical_location';
    entityId: string;
    scheme: string;
    value: string;
    sourceSystemId: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO public.entity_identifiers (
       id, entity_type, entity_id, identifier_scheme, identifier_value,
       source_system_id, is_primary, confidence, status, status_changed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, true, 100, 'active', NOW())
     ON CONFLICT DO NOTHING`,
    [
      uuidV5(`entity-identifier:${input.entityType}:${input.scheme}:${input.value}`),
      input.entityType,
      input.entityId,
      input.scheme,
      input.value,
      input.sourceSystemId,
    ],
  );
}

async function upsertOrganizations(
  client: PoolClient,
  cohort: HrsaWaCohort,
  snapshot: HrsaSnapshotMetadata,
  sourceSystemId: string,
  actorId: string,
): Promise<void> {
  for (const organization of buildHrsaOrganizationFacts(cohort)) {
    const sampleSite = cohort.included.find(
      (site) => site.healthCenterNumber === organization.healthCenterNumber,
    );
    if (!sampleSite) throw new Error('Internal HRSA organization grouping error');
    const canonical = canonicalHrsaIds(sampleSite);
    const live = legacyHrsaIds(sampleSite);

    await client.query(
      `INSERT INTO public.organizations (
         id, name, url, status, verified_at, created_by_user_id, updated_by_user_id
       ) VALUES ($1, $2, $3, 'active', $4, 'import:hrsa', $5)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         url = EXCLUDED.url,
         verified_at = EXCLUDED.verified_at,
         updated_at = NOW(),
         updated_by_user_id = EXCLUDED.updated_by_user_id
       WHERE public.organizations.created_by_user_id = 'import:hrsa'
         AND (
           public.organizations.updated_by_user_id IS NULL
           OR public.organizations.updated_by_user_id LIKE 'import:%'
           OR public.organizations.updated_by_user_id = $5
         )`,
      [live.organizationId, organization.name, organization.url, snapshot.retrievedAt, actorId],
    );
    await client.query(
      `INSERT INTO public.canonical_organizations (
         id, name, url, lifecycle_status, publication_status,
         winning_source_system_id, source_count, source_confidence_summary,
         published_organization_id, first_seen_at, last_refreshed_at
       ) VALUES ($1, $2, $3, 'active', 'published', $4, 1, $5::jsonb, $6, $7, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         url = EXCLUDED.url,
         lifecycle_status = 'active',
         publication_status = 'published',
         winning_source_system_id = EXCLUDED.winning_source_system_id,
         source_confidence_summary = EXCLUDED.source_confidence_summary,
         published_organization_id = EXCLUDED.published_organization_id,
         last_refreshed_at = EXCLUDED.last_refreshed_at,
         updated_at = NOW()`,
      [
        canonical.organizationId,
        organization.name,
        organization.url,
        sourceSystemId,
        JSON.stringify({
          overall: 90,
          snapshotSha256: snapshot.sha256,
          retrievedAt: snapshot.retrievedAt,
        }),
        live.organizationId,
        snapshot.retrievedAt,
      ],
    );
    await insertCanonicalIdentifier(client, {
      entityType: 'canonical_organization',
      entityId: canonical.organizationId,
      scheme: 'hrsa_health_center_number',
      value: organization.healthCenterNumber,
      sourceSystemId,
    });
  }
}

function provenanceRows(input: {
  site: HrsaWaSite;
  sourceRecordId: string;
  canonicalOrganizationId: string;
  canonicalServiceId: string;
  canonicalLocationId: string;
}) {
  const facts: Array<{
    entityType: 'organization' | 'service' | 'location';
    entityId: string;
    fieldName: string;
    value: unknown;
  }> = [
    { entityType: 'organization', entityId: input.canonicalOrganizationId, fieldName: 'name', value: input.site.healthCenterName },
    { entityType: 'service', entityId: input.canonicalServiceId, fieldName: 'name', value: hrsaServiceName(input.site) },
    { entityType: 'service', entityId: input.canonicalServiceId, fieldName: 'description', value: hrsaServiceDescription(input.site) },
    { entityType: 'service', entityId: input.canonicalServiceId, fieldName: 'status', value: 'active' },
    { entityType: 'location', entityId: input.canonicalLocationId, fieldName: 'name', value: input.site.siteName },
    { entityType: 'location', entityId: input.canonicalLocationId, fieldName: 'latitude', value: input.site.latitude },
    { entityType: 'location', entityId: input.canonicalLocationId, fieldName: 'longitude', value: input.site.longitude },
    { entityType: 'location', entityId: input.canonicalLocationId, fieldName: 'addressLine1', value: input.site.addressLine1 },
    { entityType: 'location', entityId: input.canonicalLocationId, fieldName: 'addressCity', value: input.site.city },
    { entityType: 'location', entityId: input.canonicalLocationId, fieldName: 'addressRegion', value: input.site.region },
    { entityType: 'location', entityId: input.canonicalLocationId, fieldName: 'addressPostalCode', value: input.site.postalCode },
    { entityType: 'location', entityId: input.canonicalLocationId, fieldName: 'addressCountry', value: 'US' },
  ];
  if (input.site.explicitUrl) {
    facts.push({
      entityType: 'service',
      entityId: input.canonicalServiceId,
      fieldName: 'url',
      value: input.site.explicitUrl,
    });
  }
  return facts.map((fact) => ({
    id: uuidV5(
      `canonical-provenance:${fact.entityType}:${fact.entityId}:${input.sourceRecordId}:${fact.fieldName}:${JSON.stringify(fact.value)}`,
    ),
    canonicalEntityType: fact.entityType,
    canonicalEntityId: fact.entityId,
    fieldName: fact.fieldName,
    assertedValue: fact.value,
    sourceRecordId: input.sourceRecordId,
  }));
}

async function insertProvenance(
  client: PoolClient,
  rows: ReturnType<typeof provenanceRows>,
  actorId: string,
): Promise<void> {
  const serializedRows = JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      canonical_entity_type: row.canonicalEntityType,
      canonical_entity_id: row.canonicalEntityId,
      field_name: row.fieldName,
      asserted_value: row.assertedValue,
      source_record_id: row.sourceRecordId,
    })),
  );
  await client.query(
    `WITH incoming AS (
       SELECT DISTINCT p.canonical_entity_type, p.canonical_entity_id::uuid,
              p.source_record_id::uuid
       FROM jsonb_to_recordset($1::jsonb) AS p(
         canonical_entity_type text,
         canonical_entity_id text,
         source_record_id text
       )
     ), incoming_sources AS (
       SELECT incoming.*, current_feed.source_system_id
       FROM incoming
       JOIN public.source_records current_record
         ON current_record.id = incoming.source_record_id
       JOIN public.source_feeds current_feed
         ON current_feed.id = current_record.source_feed_id
     )
     UPDATE public.canonical_provenance prior
        SET decision_status = 'superseded', decided_at = NOW(), decided_by = $2,
            updated_at = NOW()
       FROM incoming_sources incoming,
            public.source_records prior_record,
            public.source_feeds prior_feed
      WHERE prior.canonical_entity_type = incoming.canonical_entity_type
        AND prior.canonical_entity_id = incoming.canonical_entity_id
        AND prior.decision_status = 'accepted'
        AND prior.source_record_id = prior_record.id
        AND prior_record.source_feed_id = prior_feed.id
        AND prior_feed.source_system_id = incoming.source_system_id
        AND prior.source_record_id IS DISTINCT FROM incoming.source_record_id`,
    [serializedRows, actorId],
  );
  await client.query(
    `INSERT INTO public.canonical_provenance (
       id, canonical_entity_type, canonical_entity_id, field_name, asserted_value,
       source_record_id, confidence_hint, decision_status, decided_at, decided_by
     )
     SELECT p.id::uuid, p.canonical_entity_type, p.canonical_entity_id::uuid,
            p.field_name, p.asserted_value, p.source_record_id::uuid,
            90, 'accepted', NOW(), $2
     FROM jsonb_to_recordset($1::jsonb) AS p(
       id text,
       canonical_entity_type text,
       canonical_entity_id text,
       field_name text,
       asserted_value jsonb,
       source_record_id text
     )
    ON CONFLICT (id) DO NOTHING`,
    [serializedRows, actorId],
  );
}

async function preserveHigherPublicationAuthority(
  client: PoolClient,
  input: {
    canonicalServiceId: string;
    canonicalLocationId: string;
    liveServiceId: string;
    liveLocationId: string;
    sourceSystemId: string;
    sourceRecordId: string;
    actorId: string;
    authorityReason: string;
  },
): Promise<void> {
  await client.query(
    `UPDATE public.canonical_services
        SET publication_status = 'retracted', updated_at = NOW()
      WHERE id = $1
        AND published_service_id = $2
        AND winning_source_system_id = $3`,
    [input.canonicalServiceId, input.liveServiceId, input.sourceSystemId],
  );
  await client.query(
    `UPDATE public.canonical_locations
        SET publication_status = 'retracted', updated_at = NOW()
      WHERE id = $1
        AND published_location_id = $2
        AND winning_source_system_id = $3`,
    [input.canonicalLocationId, input.liveLocationId, input.sourceSystemId],
  );
  await client.query(
    `UPDATE public.canonical_provenance provenance
        SET decision_status = 'superseded', decided_at = NOW(), decided_by = $4,
            updated_at = NOW()
       FROM public.source_records record
       JOIN public.source_feeds feed ON feed.id = record.source_feed_id
      WHERE provenance.source_record_id = record.id
        AND feed.source_system_id = $1
        AND provenance.decision_status = 'accepted'
        AND (
          (provenance.canonical_entity_type = 'service' AND provenance.canonical_entity_id = $2)
          OR (
            provenance.canonical_entity_type = 'location'
            AND provenance.canonical_entity_id = $3
          )
        )`,
    [
      input.sourceSystemId,
      input.canonicalServiceId,
      input.canonicalLocationId,
      input.actorId,
    ],
  );
  await client.query(
    `UPDATE public.source_records
        SET processing_status = 'normalized', processing_error = NULL,
            parsed_payload = jsonb_set(
              COALESCE(parsed_payload, '{}'::jsonb),
              '{publicationDecision}',
              jsonb_build_object('status', 'authority_preserved', 'reason', $2::text),
              true
            ),
            processed_at = NOW()
      WHERE id = $1
        AND processing_status IN ('pending', 'processing', 'normalized')`,
    [input.sourceRecordId, input.authorityReason],
  );
}

export async function publishSite(
  client: PoolClient,
  input: {
    site: HrsaWaSite;
    snapshot: HrsaSnapshotMetadata;
    sourceSystemId: string;
    sourceRecordId: string;
    actorId: string;
  },
): Promise<'created' | 'updated' | 'unchanged' | 'authority-preserved'> {
  const { site, snapshot, sourceSystemId, sourceRecordId, actorId } = input;
  const canonical = canonicalHrsaIds(site);
  const live = legacyHrsaIds(site);
  const currentService = await client.query<{ id: string }>(
    'SELECT id FROM public.services WHERE id = $1',
    [live.serviceId],
  );
  const existed = Boolean(currentService.rows[0]);
  const overwrite = await decidePublicationOverwrite(client, live.serviceId, 'canonical_feed');
  const sameSnapshot =
    overwrite.current?.payload?.meta
    && typeof overwrite.current.payload.meta === 'object'
    && (overwrite.current.payload.meta as Record<string, unknown>).sourceSnapshotSha256 === snapshot.sha256
    && (overwrite.current.payload.meta as Record<string, unknown>).sourceSiteId === site.siteId;

  if (!overwrite.shouldOverwrite) {
    await preserveHigherPublicationAuthority(client, {
      canonicalServiceId: canonical.serviceId,
      canonicalLocationId: canonical.locationId,
      liveServiceId: live.serviceId,
      liveLocationId: live.locationId,
      sourceSystemId,
      sourceRecordId,
      actorId,
      authorityReason: overwrite.reason,
    });
    return 'authority-preserved';
  }

  await client.query(
    `INSERT INTO public.canonical_services (
       id, canonical_organization_id, name, description, url, status,
       lifecycle_status, publication_status, winning_source_system_id,
       source_count, source_confidence_summary, published_service_id,
       first_seen_at, last_refreshed_at
     ) VALUES (
       $1, $2, $3, $4, $5, 'active', 'active', 'published', $6,
       1, $7::jsonb, $8, $9, $9
     )
     ON CONFLICT (id) DO UPDATE SET
       canonical_organization_id = EXCLUDED.canonical_organization_id,
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       url = EXCLUDED.url,
       status = 'active',
       lifecycle_status = 'active',
       publication_status = 'published',
       winning_source_system_id = EXCLUDED.winning_source_system_id,
       source_confidence_summary = EXCLUDED.source_confidence_summary,
       published_service_id = EXCLUDED.published_service_id,
       last_refreshed_at = EXCLUDED.last_refreshed_at,
       updated_at = NOW()`,
    [
      canonical.serviceId,
      canonical.organizationId,
      hrsaServiceName(site),
      hrsaServiceDescription(site),
      site.explicitUrl,
      sourceSystemId,
      JSON.stringify({
        overall: 90,
        snapshotSha256: snapshot.sha256,
        retrievedAt: snapshot.retrievedAt,
        sourceSiteId: site.siteId,
        operatingHoursPerWeek: site.operatingHoursPerWeek,
      }),
      live.serviceId,
      snapshot.retrievedAt,
    ],
  );
  await client.query(
    `INSERT INTO public.canonical_locations (
       id, canonical_organization_id, name, latitude, longitude,
       address_line1, address_city, address_region, address_postal_code,
       address_country, lifecycle_status, publication_status,
       winning_source_system_id, source_count, source_confidence_summary,
       published_location_id, first_seen_at, last_refreshed_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, 'WA', $8, 'US',
       'active', 'published', $9, 1, $10::jsonb, $11, $12, $12
     )
     ON CONFLICT (id) DO UPDATE SET
       canonical_organization_id = EXCLUDED.canonical_organization_id,
       name = EXCLUDED.name,
       latitude = EXCLUDED.latitude,
       longitude = EXCLUDED.longitude,
       address_line1 = EXCLUDED.address_line1,
       address_city = EXCLUDED.address_city,
       address_region = EXCLUDED.address_region,
       address_postal_code = EXCLUDED.address_postal_code,
       address_country = EXCLUDED.address_country,
       lifecycle_status = 'active',
       publication_status = 'published',
       winning_source_system_id = EXCLUDED.winning_source_system_id,
       source_confidence_summary = EXCLUDED.source_confidence_summary,
       published_location_id = EXCLUDED.published_location_id,
       last_refreshed_at = EXCLUDED.last_refreshed_at,
       updated_at = NOW()`,
    [
      canonical.locationId,
      canonical.organizationId,
      site.siteName,
      site.latitude,
      site.longitude,
      site.addressLine1,
      site.city,
      site.postalCode,
      sourceSystemId,
      JSON.stringify({
        overall: 90,
        snapshotSha256: snapshot.sha256,
        retrievedAt: snapshot.retrievedAt,
      }),
      live.locationId,
      snapshot.retrievedAt,
    ],
  );
  await client.query(
    `INSERT INTO public.canonical_service_locations (
       id, canonical_service_id, canonical_location_id
     ) VALUES ($1, $2, $3)
     ON CONFLICT (canonical_service_id, canonical_location_id) DO NOTHING`,
    [canonical.serviceLocationId, canonical.serviceId, canonical.locationId],
  );
  await insertCanonicalIdentifier(client, {
    entityType: 'canonical_service',
    entityId: canonical.serviceId,
    scheme: 'hrsa_bphc_site',
    value: site.siteId,
    sourceSystemId,
  });
  await insertCanonicalIdentifier(client, {
    entityType: 'canonical_location',
    entityId: canonical.locationId,
    scheme: 'hrsa_bphc_site_location',
    value: site.siteId,
    sourceSystemId,
  });
  await insertProvenance(
    client,
    provenanceRows({
      site,
      sourceRecordId,
      canonicalOrganizationId: canonical.organizationId,
      canonicalServiceId: canonical.serviceId,
      canonicalLocationId: canonical.locationId,
    }),
    actorId,
  );

  if (overwrite.shouldOverwrite) {
    const service = await client.query<{ id: string }>(
      `INSERT INTO public.services (
         id, organization_id, name, description, url, status,
         created_by_user_id, updated_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, 'active', 'import:hrsa', $6)
       ON CONFLICT (id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         url = EXCLUDED.url,
         updated_at = NOW(),
         updated_by_user_id = EXCLUDED.updated_by_user_id
       WHERE public.services.created_by_user_id = 'import:hrsa'
         AND public.services.status = 'active'
         AND public.services.integrity_hold_at IS NULL
         AND (
           public.services.updated_by_user_id IS NULL
           OR public.services.updated_by_user_id LIKE 'import:%'
           OR public.services.updated_by_user_id = $6
         )
       RETURNING id`,
      [
        live.serviceId,
        live.organizationId,
        hrsaServiceName(site),
        hrsaServiceDescription(site),
        site.explicitUrl,
        actorId,
      ],
    );
    if (!service.rows[0]?.id) {
      throw new Error(`HRSA service ${live.serviceId} changed after preflight`);
    }
    const location = await client.query<{ id: string }>(
      `INSERT INTO public.locations (
         id, organization_id, name, latitude, longitude, status,
         created_by_user_id, updated_by_user_id
       ) VALUES ($1, $2, $3, $4, $5, 'active', 'import:hrsa', $6)
       ON CONFLICT (id) DO UPDATE SET
         organization_id = EXCLUDED.organization_id,
         name = EXCLUDED.name,
         latitude = EXCLUDED.latitude,
         longitude = EXCLUDED.longitude,
         updated_at = NOW(),
         updated_by_user_id = EXCLUDED.updated_by_user_id
       WHERE public.locations.created_by_user_id = 'import:hrsa'
         AND public.locations.status = 'active'
         AND (
           public.locations.updated_by_user_id IS NULL
           OR public.locations.updated_by_user_id LIKE 'import:%'
           OR public.locations.updated_by_user_id = $6
         )
       RETURNING id`,
      [live.locationId, live.organizationId, site.siteName, site.latitude, site.longitude, actorId],
    );
    if (!location.rows[0]?.id) throw new Error(`HRSA location ${live.locationId} changed after preflight`);
    await client.query(
      `INSERT INTO public.addresses (
         id, location_id, address_1, city, state_province, postal_code, country,
         created_by_user_id, updated_by_user_id
       ) VALUES ($1, $2, $3, $4, 'WA', $5, 'US', 'import:hrsa', $6)
       ON CONFLICT (id) DO UPDATE SET
         location_id = EXCLUDED.location_id,
         address_1 = EXCLUDED.address_1,
         city = EXCLUDED.city,
         state_province = EXCLUDED.state_province,
         postal_code = EXCLUDED.postal_code,
         country = EXCLUDED.country,
         updated_at = NOW(),
         updated_by_user_id = EXCLUDED.updated_by_user_id
       WHERE (
         public.addresses.created_by_user_id IS NULL
         OR public.addresses.created_by_user_id = 'import:hrsa'
       ) AND (
         public.addresses.updated_by_user_id IS NULL
         OR public.addresses.updated_by_user_id LIKE 'import:%'
         OR public.addresses.updated_by_user_id = $6
       )`,
      [live.addressId, live.locationId, site.addressLine1, site.city, site.postalCode, actorId],
    );
    await client.query(
      `INSERT INTO public.service_at_location (
         id, service_id, location_id, created_by_user_id, updated_by_user_id
       ) VALUES ($1, $2, $3, 'import:hrsa', $4)
       ON CONFLICT (service_id, location_id) DO NOTHING`,
      [live.serviceLocationId, live.serviceId, live.locationId, actorId],
    );
    await client.query(
      `INSERT INTO public.phones (
         id, service_id, organization_id, number, type,
         created_by_user_id, updated_by_user_id
       ) VALUES ($1, $2, $3, $4, 'voice', 'import:hrsa', $5)
       ON CONFLICT (id) DO UPDATE SET
         service_id = EXCLUDED.service_id,
         organization_id = EXCLUDED.organization_id,
         number = EXCLUDED.number,
         type = EXCLUDED.type,
         updated_at = NOW(),
         updated_by_user_id = EXCLUDED.updated_by_user_id
       WHERE (
         public.phones.created_by_user_id IS NULL
         OR public.phones.created_by_user_id = 'import:hrsa'
       ) AND (
         public.phones.updated_by_user_id IS NULL
         OR public.phones.updated_by_user_id LIKE 'import:%'
         OR public.phones.updated_by_user_id = $5
       )`,
      [live.phoneId, live.serviceId, live.organizationId, site.phone, actorId],
    );
    await client.query(
      `INSERT INTO public.service_taxonomy (
         id, service_id, taxonomy_term_id, created_by_user_id, updated_by_user_id
       ) VALUES ($1, $2, $3, 'import:hrsa', $4)
       ON CONFLICT (service_id, taxonomy_term_id) DO NOTHING`,
      [live.serviceTaxonomyId, live.serviceId, HEALTHCARE_TAXONOMY_ID, actorId],
    );
    await upsertConfidenceScore(client, {
      serviceId: live.serviceId,
      score: 90,
      verificationConfidence: 90,
      eligibilityMatch: 0,
      constraintFit: 0,
    });
  }

  await client.query(
    `INSERT INTO public.entity_identifiers (
       id, entity_type, entity_id, identifier_scheme, identifier_value,
       source_system_id, is_primary, confidence, status, status_changed_at
     ) VALUES ($1, 'service', $2, 'oran_canonical_service_id', $3, $4, true, 100, 'active', NOW())
     ON CONFLICT DO NOTHING`,
    [
      uuidV5(`live-canonical-service-link:${live.serviceId}:${canonical.serviceId}`),
      live.serviceId,
      canonical.serviceId,
      sourceSystemId,
    ],
  );

  if (overwrite.shouldOverwrite && !sameSnapshot) {
    await replaceCurrentSnapshot(client, {
      entityType: 'service',
      entityId: live.serviceId,
      replaceCurrent: Boolean(overwrite.current),
      hsdsPayload: {
        meta: {
          generatedBy: 'oran-hrsa-wa-release',
          publicationSourceKind: 'canonical_feed',
          canonicalServiceId: canonical.serviceId,
          canonicalOrganizationId: canonical.organizationId,
          sourceSystem: SOURCE_SYSTEM_NAME,
          sourceSiteId: site.siteId,
          sourceSnapshotSha256: snapshot.sha256,
          sourceRetrievedAt: snapshot.retrievedAt,
          sourceLastModified: snapshot.lastModified,
          sourceEtag: snapshot.etag,
          sourceUrl: snapshot.sourceUrl,
          datasetPageUrl: snapshot.datasetPageUrl,
          termsUrl: snapshot.termsUrl,
          sourceLicense: snapshot.sourceLicense,
        },
        organization: {
          id: live.organizationId,
          name: site.healthCenterName,
        },
        service: {
          id: live.serviceId,
          organizationId: live.organizationId,
          name: hrsaServiceName(site),
          description: hrsaServiceDescription(site),
          url: site.explicitUrl,
          status: 'active',
        },
        locations: [
          {
            id: live.locationId,
            name: site.siteName,
            latitude: site.latitude,
            longitude: site.longitude,
            address: site.addressLine1,
            city: site.city,
            region: 'WA',
            postalCode: site.postalCode,
            country: 'US',
          },
        ],
        contacts: { phones: [{ number: site.phone, type: 'voice' }] },
        sourceFacts: {
          healthCenterNumber: site.healthCenterNumber,
          bphcAssignedNumber: site.siteId,
          siteType: site.siteType,
          operatingHoursPerWeek: site.operatingHoursPerWeek,
        },
        confidenceSummary: { overall: 90, eligibilityVerified: false, availabilityVerified: false },
      },
    });
    await appendLifecycleEvent(client, {
      entityType: 'service',
      entityId: live.serviceId,
      eventType: existed ? 'updated' : 'published',
      fromStatus: existed ? 'published' : 'canonical',
      toStatus: 'published',
      actorType: 'system',
      actorId,
      metadata: {
        canonicalServiceId: canonical.serviceId,
        sourceRecordId,
        sourceSiteId: site.siteId,
        sourceSnapshotSha256: snapshot.sha256,
        incomingAuthority: 'canonical_feed',
        authorityReason: overwrite.reason,
      },
    });
  }

  await client.query(
    `UPDATE public.source_records
        SET processing_status = 'published', processing_error = NULL, processed_at = NOW()
      WHERE id = $1 AND processing_status IN ('pending', 'normalized', 'published')`,
    [sourceRecordId],
  );

  if (sameSnapshot) return 'unchanged';
  return existed ? 'updated' : 'created';
}

async function applyAdminOnlyHolds(
  client: PoolClient,
  cohort: HrsaWaCohort,
  snapshot: HrsaSnapshotMetadata,
  actorId: string,
): Promise<'applied' | 'unchanged'> {
  const slug = hrsaHoldBatchSlug(snapshot.sha256);
  const reason = hrsaHoldReason(snapshot.sha256);
  const serviceIds = cohort.adminOnly.map((site) => legacyHrsaIds(site).serviceId).sort();
  const memberChecksum = sha256Hex(serviceIds.join(','));
  const existing = await client.query<{
    id: string;
    status: string;
    expected_service_count: number;
    member_checksum: string | null;
  }>(
    `SELECT id, status, expected_service_count, member_checksum
       FROM oran_internal.resource_quarantine_batches
      WHERE slug = $1
      FOR UPDATE`,
    [slug],
  );
  if (existing.rows[0]) {
    const batch = existing.rows[0];
    if (
      batch.status !== 'applied'
      || batch.expected_service_count !== cohort.adminOnly.length
      || batch.member_checksum !== memberChecksum
    ) {
      throw new Error(`Existing HRSA hold batch ${slug} does not match this snapshot`);
    }
    return 'unchanged';
  }

  const targets = await client.query<{
    service_id: string;
    organization_id: string;
    location_id: string;
    service_status: string;
    organization_status: string;
    location_status: string;
    integrity_hold_at: string | null;
    integrity_hold_reason: string | null;
    integrity_held_by_user_id: string | null;
  }>(
    `SELECT s.id AS service_id, s.organization_id, l.id AS location_id,
            s.status AS service_status, o.status AS organization_status,
            l.status AS location_status, s.integrity_hold_at,
            s.integrity_hold_reason, s.integrity_held_by_user_id
       FROM public.services s
       JOIN public.organizations o ON o.id = s.organization_id
       JOIN public.service_at_location sal ON sal.service_id = s.id
       JOIN public.locations l ON l.id = sal.location_id
      WHERE s.id = ANY($1::uuid[])
        AND l.id = ANY($2::uuid[])`,
    [
      serviceIds,
      cohort.adminOnly.map((site) => legacyHrsaIds(site).locationId),
    ],
  );
  if (targets.rows.length !== cohort.adminOnly.length) {
    throw new Error(
      `HRSA admin-only hold drift: expected ${cohort.adminOnly.length} exact service/location pairs, found ${targets.rows.length}`,
    );
  }
  const unsafeTargets = targets.rows.filter((row) => {
    const isActiveUnheld = row.service_status === 'active'
      && !row.integrity_hold_at
      && !row.integrity_hold_reason;
    return !isActiveUnheld && !isHrsaManagedHold({
      status: row.service_status,
      integrityHoldReason: row.integrity_hold_reason,
      integrityHeldByUserId: row.integrity_held_by_user_id,
    });
  });
  if (unsafeTargets.length > 0) {
    throw new Error(`${unsafeTargets.length} HRSA admin-only services have non-HRSA changes or holds`);
  }

  const batchId = uuidV5(`resource-quarantine-batch:${slug}`);
  await client.query(
    `INSERT INTO oran_internal.resource_quarantine_batches (
       id, slug, reason, classifier, expected_service_count,
       actual_service_count, actual_organization_count, actual_location_count,
       member_checksum, status, created_by, created_at
     ) VALUES (
       $1, $2, $3, $4::jsonb, $5, $5, 0, 0, $6, 'applying', $7, NOW()
     )`,
    [
      batchId,
      slug,
      reason,
      JSON.stringify({
        source: SOURCE_SYSTEM_NAME,
        jurisdiction: 'WA',
        excludedSiteType: 'Administrative',
        siteIds: cohort.adminOnly.map((site) => site.siteId).sort(),
        snapshotSha256: snapshot.sha256,
        retrievedAt: snapshot.retrievedAt,
        rollbackScope: 'service status and integrity hold only; shared organizations and locations remain active',
      }),
      cohort.adminOnly.length,
      memberChecksum,
      actorId,
    ],
  );
  await client.query(
    `INSERT INTO oran_internal.resource_quarantine_members (
       batch_id, service_id, organization_id, location_id,
       original_service_status, original_organization_status, original_location_status,
       original_integrity_hold_at, original_integrity_hold_reason,
       original_integrity_held_by_user_id, quarantined_at, applied_at
     )
     SELECT $1, t.service_id::uuid, t.organization_id::uuid, t.location_id::uuid,
            t.service_status, t.organization_status, t.location_status,
            t.integrity_hold_at::timestamptz, t.integrity_hold_reason,
            t.integrity_held_by_user_id, NOW(), NOW()
       FROM jsonb_to_recordset($2::jsonb) AS t(
         service_id text,
         organization_id text,
         location_id text,
         service_status text,
         organization_status text,
         location_status text,
         integrity_hold_at text,
         integrity_hold_reason text,
         integrity_held_by_user_id text
       )`,
    [
      batchId,
      JSON.stringify(
        targets.rows.map((row) => ({
          service_id: row.service_id,
          organization_id: row.organization_id,
          location_id: row.location_id,
          service_status: row.service_status,
          organization_status: row.organization_status,
          location_status: row.location_status,
          integrity_hold_at: row.integrity_hold_at,
          integrity_hold_reason: row.integrity_hold_reason,
          integrity_held_by_user_id: row.integrity_held_by_user_id,
        })),
      ),
    ],
  );
  const held = await client.query(
    `UPDATE public.services
        SET status = 'inactive', integrity_hold_at = NOW(), integrity_hold_reason = $2,
            integrity_held_by_user_id = $3, updated_at = NOW(), updated_by_user_id = $3
      WHERE id = ANY($1::uuid[])
        AND created_by_user_id = 'import:hrsa'
        AND (
          (status = 'active' AND integrity_hold_at IS NULL AND integrity_hold_reason IS NULL)
          OR (
            status = 'inactive'
            AND integrity_held_by_user_id = $3
            AND (
              integrity_hold_reason LIKE $4 || '%'
              OR integrity_hold_reason LIKE $5 || '%'
            )
          )
        )`,
    [
      serviceIds,
      reason,
      HRSA_RELEASE_ACTOR,
      HRSA_ADMIN_HOLD_REASON_PREFIX,
      HRSA_WITHDRAWAL_HOLD_REASON_PREFIX,
    ],
  );
  if ((held.rowCount ?? 0) !== cohort.adminOnly.length) {
    throw new Error(
      `HRSA admin-only hold update drift: expected ${cohort.adminOnly.length}, changed ${held.rowCount ?? 0}`,
    );
  }
  await client.query(
    `UPDATE oran_internal.resource_quarantine_batches
        SET status = 'applied', applied_at = NOW()
      WHERE id = $1`,
    [batchId],
  );
  return 'applied';
}

async function rollbackAdminOnlyHolds(
  client: PoolClient,
  cohort: HrsaWaCohort,
  snapshot: HrsaSnapshotMetadata,
  actorId: string,
): Promise<number> {
  const slug = hrsaHoldBatchSlug(snapshot.sha256);
  const reason = hrsaHoldReason(snapshot.sha256);
  const batch = await client.query<{ id: string; status: string; actual_service_count: number }>(
    `SELECT id, status, actual_service_count
       FROM oran_internal.resource_quarantine_batches
      WHERE slug = $1
      FOR UPDATE`,
    [slug],
  );
  const existing = batch.rows[0];
  if (!existing) throw new Error(`HRSA hold batch ${slug} does not exist`);
  if (existing.status === 'rolled_back') return 0;
  if (existing.status !== 'applied' || existing.actual_service_count !== cohort.adminOnly.length) {
    throw new Error(`HRSA hold batch ${slug} is not rollback-ready`);
  }
  const drift = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM oran_internal.resource_quarantine_members member
       JOIN public.services service ON service.id = member.service_id
      WHERE member.batch_id = $1
        AND (
          service.status <> 'inactive'
          OR service.integrity_hold_reason IS DISTINCT FROM $2
          OR service.integrity_held_by_user_id IS DISTINCT FROM $3
        )`,
    [existing.id, reason, HRSA_RELEASE_ACTOR],
  );
  if (Number.parseInt(drift.rows[0]?.count ?? '0', 10) !== 0) {
    throw new Error('HRSA hold rollback refused because held services have newer changes');
  }
  const restored = await client.query(
    `UPDATE public.services service
        SET status = member.original_service_status,
            integrity_hold_at = member.original_integrity_hold_at,
            integrity_hold_reason = member.original_integrity_hold_reason,
            integrity_held_by_user_id = member.original_integrity_held_by_user_id,
            updated_at = NOW(), updated_by_user_id = $2
       FROM oran_internal.resource_quarantine_members member
      WHERE member.batch_id = $1
        AND service.id = member.service_id`,
    [existing.id, actorId],
  );
  if ((restored.rowCount ?? 0) !== cohort.adminOnly.length) {
    throw new Error(`HRSA hold rollback count drift: restored ${restored.rowCount ?? 0}`);
  }
  await client.query(
    `UPDATE oran_internal.resource_quarantine_members
        SET rolled_back_at = NOW()
      WHERE batch_id = $1`,
    [existing.id],
  );
  await client.query(
    `UPDATE oran_internal.resource_quarantine_batches
        SET status = 'rolled_back', rolled_back_at = NOW()
      WHERE id = $1`,
    [existing.id],
  );
  return restored.rowCount ?? 0;
}

async function applyRelease(
  client: PoolClient,
  cohort: HrsaWaCohort,
  snapshot: HrsaSnapshotMetadata,
  options: CliOptions,
): Promise<Record<string, unknown>> {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '30min'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('oran:hrsa-wa-regional-release'))");
    await assertDatabasePrerequisites(client);
    await assertCanonicalIdentifierOwnership(client, cohort);
    const { sourceSystemId, sourceFeedId } = await upsertSourceRegistry(
      client,
      snapshot,
      options.actorId,
    );
    const releasedManagedHolds = await releaseManagedHoldsForIncludedSites(
      client,
      cohort,
      options.actorId,
    );
    const plan = await databasePlan(client, cohort, snapshot);
    const includedStates = await loadLiveServiceStates(client, cohort.included);
    const adminStates = await loadLiveServiceStates(client, cohort.adminOnly);
    assertPreexistingServiceOwnership(cohort.included, includedStates, {
      allowManagedHold: false,
    });
    assertPreexistingServiceOwnership(cohort.adminOnly, adminStates, {
      allowManagedHold: true,
    });
    if (adminStates.size !== cohort.adminOnly.length) {
      throw new Error(
        `HRSA admin-only legacy drift: expected ${cohort.adminOnly.length} services, found ${adminStates.size}`,
      );
    }
    if (
      options.expectedExistingServices !== null
      && plan.existingIncludedServices !== options.expectedExistingServices
      && plan.matchingCurrentSnapshots !== cohort.included.length
    ) {
      throw new Error(
        `HRSA legacy reconciliation drift: expected ${options.expectedExistingServices} existing included services, found ${plan.existingIncludedServices}`,
      );
    }
    const withdrawnServices = await withdrawNoLongerIncludedSites(
      client,
      cohort,
      snapshot,
      sourceSystemId,
      options.actorId,
    );
    await client.query(
      `INSERT INTO public.taxonomy_terms (id, term, taxonomy, created_by_user_id, updated_by_user_id)
       VALUES ($1, 'Healthcare', 'oran-core', 'import:hrsa', $2)
       ON CONFLICT (id) DO NOTHING`,
      [HEALTHCARE_TAXONOMY_ID, options.actorId],
    );
    await upsertOrganizations(client, cohort, snapshot, sourceSystemId, options.actorId);

    const correlationId = `hrsa-wa:${snapshot.sha256}`;
    const outcomes = { created: 0, updated: 0, unchanged: 0, authorityPreserved: 0 };
    for (const site of cohort.included) {
      const sourceRecordId = await upsertSourceRecord(client, {
        site,
        snapshot,
        sourceFeedId,
        correlationId,
        status: 'pending',
      });
      const outcome = await publishSite(client, {
        site,
        snapshot,
        sourceSystemId,
        sourceRecordId,
        actorId: options.actorId,
      });
      if (outcome === 'authority-preserved') outcomes.authorityPreserved += 1;
      else outcomes[outcome] += 1;
    }
    for (const site of cohort.adminOnly) {
      await upsertSourceRecord(client, {
        site,
        snapshot,
        sourceFeedId,
        correlationId,
        status: 'rejected',
        processingError: 'Excluded from seeker publication: HRSA site type is Administrative only.',
      });
    }
    for (const site of cohort.inactiveWashingtonSites) {
      await upsertSourceRecord(client, {
        site,
        snapshot,
        sourceFeedId,
        correlationId,
        status: 'rejected',
        processingError: 'Excluded from seeker publication: HRSA site status is not Active.',
      });
    }
    const holdOutcome = await applyAdminOnlyHolds(
      client,
      cohort,
      snapshot,
      options.actorId,
    );
    await client.query(
      `UPDATE public.source_feeds
          SET last_polled_at = $2, last_success_at = $2, last_error = NULL,
              error_count = 0, updated_at = NOW()
        WHERE id = $1`,
      [sourceFeedId, snapshot.retrievedAt],
    );
    await client.query(
      `UPDATE public.source_feed_states
          SET last_attempt_status = 'succeeded', last_attempt_completed_at = NOW(),
              last_successful_sync_started_at = COALESCE(last_attempt_started_at, NOW()),
              last_successful_sync_completed_at = NOW(),
              last_attempt_summary = $2::jsonb, updated_at = NOW()
        WHERE source_feed_id = $1`,
      [
        sourceFeedId,
        JSON.stringify({
          included: cohort.included.length,
          administrativeOnlyHeld: cohort.adminOnly.length,
          inactiveRejected: cohort.inactiveWashingtonSites.length,
          releasedManagedHolds,
          withdrawnServices,
          snapshotSha256: snapshot.sha256,
          retrievedAt: snapshot.retrievedAt,
          etag: snapshot.etag,
          lastModified: snapshot.lastModified,
          sourceUrl: snapshot.sourceUrl,
          datasetPageUrl: snapshot.datasetPageUrl,
          termsUrl: snapshot.termsUrl,
          sourceLicense: snapshot.sourceLicense,
          outcomes,
        }),
      ],
    );

    const authority = await client.query<{ count: string }>(
      `SELECT count(DISTINCT canonical.published_service_id)::text AS count
         FROM public.canonical_services canonical
         JOIN public.canonical_provenance provenance
           ON provenance.canonical_entity_type = 'service'
          AND provenance.canonical_entity_id = canonical.id
          AND provenance.decision_status = 'accepted'
         JOIN public.source_records record
           ON record.id = provenance.source_record_id
          AND record.processing_status = 'published'
         JOIN public.source_feeds feed
           ON feed.id = record.source_feed_id AND feed.is_active IS TRUE
         JOIN public.source_systems system
           ON system.id = feed.source_system_id
          AND system.id = canonical.winning_source_system_id
          AND system.is_active IS TRUE
          AND system.trust_tier = 'verified_publisher'
          AND system.resource_purpose = 'service_catalog'
        WHERE canonical.id = ANY($1::uuid[])
          AND canonical.status = 'active'
          AND canonical.lifecycle_status = 'active'
          AND canonical.publication_status = 'published'`,
      [cohort.included.map((site) => canonicalHrsaIds(site).serviceId)],
    );
    const authorityCount = Number.parseInt(authority.rows[0]?.count ?? '0', 10);
    const expectedAuthorityCount = cohort.included.length - outcomes.authorityPreserved;
    if (authorityCount !== expectedAuthorityCount) {
      throw new Error(
        `HRSA positive-authority verification failed: expected ${expectedAuthorityCount}, found ${authorityCount}`,
      );
    }
    await client.query('COMMIT');
    return {
      plan,
      outcomes,
      holdOutcome,
      releasedManagedHolds,
      withdrawnServices,
      authorityCount,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const loaded = await loadSnapshot(options);
  const snapshot = buildHrsaSnapshotMetadata({
    bytes: loaded.bytes,
    retrievedAt: loaded.retrievedAt,
    expectedSha256: options.expectedSha256 ?? undefined,
    etag: loaded.etag,
    lastModified: loaded.lastModified,
  });
  const cohort = parseHrsaWaSnapshot(loaded.bytes.toString('utf8'));
  if (
    options.mode !== 'dry-run'
    && cohort.inactiveWashingtonRows.length > 0
    && options.expectedInactive === null
  ) {
    throw new Error('--expected-inactive is required when a write snapshot contains inactive WA rows');
  }
  if (options.expectedIncluded !== null && options.expectedAdminOnly !== null) {
    assertExpectedHrsaWaCohort(
      cohort,
      options.expectedIncluded,
      options.expectedAdminOnly,
      options.expectedInactive ?? 0,
    );
  } else if (cohort.unexpectedActiveSiteTypes.length > 0) {
    throw new Error(
      `HRSA WA contains unexpected active site types: ${cohort.unexpectedActiveSiteTypes.join(', ')}`,
    );
  }

  const summary: Record<string, unknown> = {
    mode: options.mode,
    sourceUrl: HRSA_SITE_CSV_URL,
    datasetPageUrl: HRSA_DATASET_PAGE_URL,
    termsUrl: HRSA_TERMS_URL,
    sourceLicense: HRSA_SOURCE_LICENSE,
    snapshot: {
      bytes: loaded.bytes.length,
      sha256: snapshot.sha256,
      retrievedAt: snapshot.retrievedAt,
      etag: snapshot.etag,
      lastModified: snapshot.lastModified,
    },
    cohort: {
      totalRows: cohort.totalRows,
      totalWashingtonRows: cohort.totalWashingtonRows,
      included: cohort.included.length,
      serviceDelivery: cohort.included.filter((site) => site.siteType === 'Service Delivery Site').length,
      administrativeServiceDelivery: cohort.included.filter(
        (site) => site.siteType === 'Administrative/Service Delivery Site',
      ).length,
      administrativeOnly: cohort.adminOnly.length,
      inactiveWashington: cohort.inactiveWashingtonRows.length,
      explicitWebsites: cohort.included.filter((site) => site.explicitUrl).length,
      phoneOnlyOrBareWebsite: cohort.included.filter((site) => !site.explicitUrl).length,
      organizations: new Set(cohort.included.map((site) => site.healthCenterNumber)).size,
      counties: new Set(cohort.included.map((site) => site.county)).size,
    },
  };

  const shouldConnect = options.mode !== 'dry-run' || options.databaseCheck;
  if (!shouldConnect) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const pool = new Pool({
    connectionString: validatedDatabaseUrl(options),
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  });
  const client = await pool.connect();
  try {
    if (options.mode === 'dry-run') {
      await client.query('BEGIN READ ONLY');
      try {
        await assertDatabasePrerequisites(client);
        summary.databasePlan = await databasePlan(client, cohort, snapshot);
      } finally {
        await client.query('ROLLBACK');
      }
    } else if (options.mode === 'apply') {
      summary.release = await applyRelease(client, cohort, snapshot, options);
    } else {
      await client.query('BEGIN');
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('oran:hrsa-wa-regional-release'))");
        await assertDatabasePrerequisites(client);
        summary.restoredAdminOnlyServices = await rollbackAdminOnlyHolds(
          client,
          cohort,
          snapshot,
          options.actorId,
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log(JSON.stringify(summary, null, 2));
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
