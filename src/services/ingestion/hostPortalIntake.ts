import crypto from 'node:crypto';
import type { PoolClient } from 'pg';

const HOST_PORTAL_SOURCE_NAME = 'ORAN Host Portal';
const HOST_PORTAL_SOURCE_FAMILY = 'manual';
const HOST_PORTAL_SOURCE_FEED_NAME = 'Host Portal Intake';
const HOST_PORTAL_SOURCE_FEED_TYPE = 'manual_entry';
const HOST_PORTAL_BASE_URL = 'oran://host-portal';
const HOST_PORTAL_SOURCE_RECORD_TYPE = 'mixed_bundle';

export interface HostPortalPhoneInput {
  number: string;
  extension?: string;
  type: 'voice' | 'fax' | 'text' | 'hotline' | 'tty';
  description?: string;
}

export interface HostPortalDayScheduleInput {
  day: 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
  opens: string;
  closes: string;
  closed: boolean;
}

export interface HostServiceRequestedChanges {
  name?: string;
  description?: string;
  url?: string;
  email?: string;
  interpretationServices?: string;
  applicationProcess?: string;
  waitTime?: string;
  fees?: string;
  accreditations?: string;
  licenses?: string;
  phones?: HostPortalPhoneInput[];
  schedule?: HostPortalDayScheduleInput[];
}

export type HostServiceVerificationChangeType =
  | 'host_service_create'
  | 'host_service_update'
  | 'host_service_archive';

export interface HostServiceVerificationPayload {
  flow: 'host_portal';
  changeType: HostServiceVerificationChangeType;
  sourceRecordId: string;
  organizationId?: string;
  serviceId?: string;
  currentStatus?: 'active' | 'inactive' | 'defunct' | null;
  requestedChanges?: HostServiceRequestedChanges;
}

export interface CreateHostPortalSourceAssertionInput {
  actorUserId: string;
  actorRole?: string | null;
  recordType:
    | 'host_org_create'
    | 'host_org_claim'
    | 'host_org_update'
    | 'host_org_archive'
    | 'host_location_create'
    | 'host_location_update'
    | 'host_location_archive'
    | 'host_service_create'
    | 'host_service_update'
    | 'host_service_archive';
  recordId: string;
  canonicalSourceUrl: string;
  payload: Record<string, unknown>;
}

export interface QueueServiceVerificationSubmissionInput {
  serviceId: string;
  submittedByUserId: string;
  actorRole: string;
  title: string;
  notes?: string | null;
  payload: HostServiceVerificationPayload;
}

async function ensureHostPortalSourceSystem(client: PoolClient): Promise<string> {
  const crawlPolicy = JSON.stringify({
    origin: 'host_portal',
    discovery: [{ type: 'manual_portal' }],
    userAgent: 'oran-host-portal/1.0',
  });
  const notes = 'Authenticated host portal submissions and change requests.';
  const rows = await client.query<{ id: string }>(
    `WITH authority_lock AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(lock_key)
       FROM (SELECT hashtextextended($6, 0) AS lock_key) lock_keys
     ), existing AS MATERIALIZED (
       SELECT source.id,
              source.family = $2
                AND source.homepage_url IS NOT DISTINCT FROM $3
                AND source.trust_tier = 'trusted_partner'
                AND source.resource_purpose = 'service_catalog'
                AND source.domain_rules = '[]'::jsonb
                AND source.crawl_policy = $4::jsonb
                AND source.jurisdiction_scope = '{}'::jsonb
                AND source.contact_info = '{}'::jsonb
                AND source.notes IS NOT DISTINCT FROM $5
                AND source.is_active = true AS configuration_matches
       FROM public.source_systems source
       CROSS JOIN authority_lock
       WHERE source.name = $1
     ), inserted AS (
       INSERT INTO source_systems
       (name, family, homepage_url, trust_tier, resource_purpose, domain_rules, crawl_policy, jurisdiction_scope, contact_info, notes)
       SELECT $1, $2, $3, 'trusted_partner', 'service_catalog', '[]'::jsonb,
              $4::jsonb, '{}'::jsonb, '{}'::jsonb, $5
       FROM authority_lock
       WHERE NOT EXISTS (SELECT 1 FROM existing)
       ON CONFLICT (name) DO NOTHING
       RETURNING id
     )
     SELECT id
     FROM existing
     WHERE configuration_matches
       AND (SELECT COUNT(*) FROM existing) = 1
     UNION ALL
     SELECT id FROM inserted
     LIMIT 1`,
    [
      HOST_PORTAL_SOURCE_NAME,
      HOST_PORTAL_SOURCE_FAMILY,
      HOST_PORTAL_BASE_URL,
      crawlPolicy,
      notes,
      'oran:reserved-source:host-portal',
    ],
  );
  if (!rows.rows[0]?.id) {
    throw new Error(
      `${HOST_PORTAL_SOURCE_NAME} exists with configuration drift; use the reviewed source-authority workflow`,
    );
  }
  return rows.rows[0].id;
}

async function ensureHostPortalFeed(client: PoolClient, sourceSystemId: string): Promise<string> {
  const rows = await client.query<{ id: string }>(
    `WITH authority_lock AS MATERIALIZED (
       SELECT pg_advisory_xact_lock(lock_key)
       FROM (SELECT hashtextextended($5, 0) AS lock_key) lock_keys
     ), existing AS MATERIALIZED (
       SELECT feed.id,
              feed.feed_type = $3
                AND feed.feed_handler = 'none'
                AND feed.base_url IS NOT DISTINCT FROM $4
                AND feed.healthcheck_url IS NULL
                AND feed.auth_type = 'custom'
                AND feed.profile_uri IS NULL
                AND feed.jurisdiction_scope = '{}'::jsonb
                AND feed.refresh_interval_hours = 24
                AND feed.is_active = true AS configuration_matches
       FROM public.source_feeds feed
       CROSS JOIN authority_lock
       WHERE feed.source_system_id = $1
         AND feed.feed_name = $2
     ), inserted AS (
       INSERT INTO source_feeds
       (source_system_id, feed_name, feed_type, feed_handler, base_url, auth_type, jurisdiction_scope, refresh_interval_hours)
       SELECT $1, $2, $3, 'none', $4, 'custom', '{}'::jsonb, 24
       FROM authority_lock
       WHERE NOT EXISTS (SELECT 1 FROM existing)
       RETURNING id
     )
     SELECT id
     FROM existing
     WHERE configuration_matches
       AND (SELECT COUNT(*) FROM existing) = 1
     UNION ALL
     SELECT id FROM inserted
     LIMIT 1`,
    [
      sourceSystemId,
      HOST_PORTAL_SOURCE_FEED_NAME,
      HOST_PORTAL_SOURCE_FEED_TYPE,
      HOST_PORTAL_BASE_URL,
      `oran:reserved-feed:host-portal:${sourceSystemId}`,
    ],
  );
  if (!rows.rows[0]?.id) {
    throw new Error(
      `${HOST_PORTAL_SOURCE_FEED_NAME} exists with configuration drift; use the reviewed source-authority workflow`,
    );
  }
  return rows.rows[0].id;
}

export async function createHostPortalSourceAssertion(
  client: PoolClient,
  input: CreateHostPortalSourceAssertionInput,
): Promise<{ sourceSystemId: string; sourceFeedId: string; sourceRecordId: string }> {
  const sourceSystemId = await ensureHostPortalSourceSystem(client);
  const sourceFeedId = await ensureHostPortalFeed(client, sourceSystemId);

  const payloadJson = JSON.stringify(input.payload);
  const payloadSha256 = crypto.createHash('sha256').update(payloadJson).digest('hex');

  const existing = await client.query<{ id: string }>(
    `SELECT id
     FROM source_records
     WHERE source_feed_id = $1
       AND source_record_type = $2
       AND source_record_id = $3
       AND payload_sha256 = $4
     LIMIT 1`,
    [sourceFeedId, HOST_PORTAL_SOURCE_RECORD_TYPE, input.recordId, payloadSha256],
  );

  if (existing.rows[0]?.id) {
    return {
      sourceSystemId,
      sourceFeedId,
      sourceRecordId: existing.rows[0].id,
    };
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO source_records
       (source_feed_id, source_record_type, source_record_id, canonical_source_url,
        payload_sha256, raw_payload, parsed_payload, correlation_id,
        source_license, source_confidence_signals, processing_status, processed_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $6::jsonb, $7, $8, $9::jsonb, 'normalized', NOW())
     RETURNING id`,
    [
      sourceFeedId,
      HOST_PORTAL_SOURCE_RECORD_TYPE,
      input.recordId,
      input.canonicalSourceUrl,
      payloadSha256,
      payloadJson,
      `host-portal:${input.recordType}:${input.recordId}`,
      'internal_submission',
      JSON.stringify({
        origin: 'host_portal',
        assertionType: input.recordType,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole ?? null,
        authenticated: true,
      }),
    ],
  );

  return {
    sourceSystemId,
    sourceFeedId,
    sourceRecordId: created.rows[0].id,
  };
}

export async function queueServiceVerificationSubmission(
  client: PoolClient,
  input: QueueServiceVerificationSubmissionInput,
): Promise<string> {
  const submissionRows = await client.query<{ id: string }>(
    `INSERT INTO submissions
       (submission_type, status, target_type, target_id, service_id,
        submitted_by_user_id, title, notes, payload, submitted_at)
     VALUES ('service_verification', 'submitted', 'service', $1, $1, $2, $3, $4, $5::jsonb, NOW())
     RETURNING id`,
    [
      input.serviceId,
      input.submittedByUserId,
      input.title,
      input.notes ?? null,
      JSON.stringify(input.payload),
    ],
  );

  const submissionId = submissionRows.rows[0].id;

  await client.query(
    `INSERT INTO submission_transitions
       (submission_id, from_status, to_status, actor_user_id, actor_role,
        reason, gates_checked, gates_passed, metadata)
     VALUES ($1, 'draft', 'submitted', $2, $3, $4, '[]'::jsonb, true, $5::jsonb)`,
    [
      submissionId,
      input.submittedByUserId,
      input.actorRole,
      input.notes ?? input.title,
      JSON.stringify({
        flow: 'host_portal',
        changeType: input.payload.changeType,
        sourceRecordId: input.payload.sourceRecordId,
      }),
    ],
  );

  await client.query(
    `INSERT INTO notification_events
       (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
     SELECT up.user_id,
            'submission_status_changed',
            'Service review requested',
            $2,
            'submission',
            $1,
            '/verify?id=' || $1,
            'host_service_review_' || $1 || '_' || up.user_id
     FROM user_profiles up
     WHERE up.role IN ('community_admin', 'oran_admin')
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [submissionId, input.title],
  );

  return submissionId;
}
