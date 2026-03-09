import crypto from 'node:crypto';
import type { PoolClient } from 'pg';

const HOST_PORTAL_SOURCE_NAME = 'ORAN Host Portal';
const HOST_PORTAL_SOURCE_FAMILY = 'host_portal';
const HOST_PORTAL_SOURCE_FEED_NAME = 'Host Portal Intake';
const HOST_PORTAL_SOURCE_FEED_TYPE = 'manual_portal';
const HOST_PORTAL_BASE_URL = 'oran://host-portal';

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
  const rows = await client.query<{ id: string }>(
    `INSERT INTO source_systems
       (name, family, homepage_url, trust_tier, domain_rules, crawl_policy, jurisdiction_scope, contact_info, notes)
     VALUES ($1, $2, $3, 'allowlisted', '[]'::jsonb, $4::jsonb, '{}'::jsonb, '{}'::jsonb, $5)
     ON CONFLICT (name)
     DO UPDATE SET
       family = EXCLUDED.family,
       homepage_url = EXCLUDED.homepage_url,
       trust_tier = EXCLUDED.trust_tier,
       domain_rules = EXCLUDED.domain_rules,
       crawl_policy = EXCLUDED.crawl_policy,
       updated_at = NOW()
     RETURNING id`,
    [
      HOST_PORTAL_SOURCE_NAME,
      HOST_PORTAL_SOURCE_FAMILY,
      HOST_PORTAL_BASE_URL,
      JSON.stringify({
        origin: 'host_portal',
        discovery: [{ type: 'manual_portal' }],
        userAgent: 'oran-host-portal/1.0',
      }),
      'Authenticated host portal submissions and change requests.',
    ],
  );
  return rows.rows[0].id;
}

async function ensureHostPortalFeed(client: PoolClient, sourceSystemId: string): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id
     FROM source_feeds
     WHERE source_system_id = $1
       AND feed_name = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    [sourceSystemId, HOST_PORTAL_SOURCE_FEED_NAME],
  );

  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO source_feeds
       (source_system_id, feed_name, feed_type, base_url, auth_type, jurisdiction_scope, refresh_interval_hours)
     VALUES ($1, $2, $3, $4, 'session', '{}'::jsonb, 24)
     RETURNING id`,
    [sourceSystemId, HOST_PORTAL_SOURCE_FEED_NAME, HOST_PORTAL_SOURCE_FEED_TYPE, HOST_PORTAL_BASE_URL],
  );

  return created.rows[0].id;
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
    [sourceFeedId, input.recordType, input.recordId, payloadSha256],
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
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $6::jsonb, $7, $8, $9::jsonb, 'processed', NOW())
     RETURNING id`,
    [
      sourceFeedId,
      input.recordType,
      input.recordId,
      input.canonicalSourceUrl,
      payloadSha256,
      payloadJson,
      `host-portal:${input.recordType}:${input.recordId}`,
      'internal_submission',
      JSON.stringify({
        origin: 'host_portal',
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
