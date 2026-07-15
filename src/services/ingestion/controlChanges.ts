import crypto from 'node:crypto';
import { z } from 'zod';
import type { PoolClient } from 'pg';

import { executeQuery, withTransaction } from '@/services/db/postgres';
import {
  advanceInTransaction,
  sendTerminalStatusEmail,
} from '@/services/workflow/engine';
import {
  registryTrustLevelToSourceSystemTrustTier,
  SourceRegistryEntrySchema,
  SourceSystemTrustTierSchema,
} from '@/agents/ingestion/sourceRegistry';
import { acquireLivePublicationMergeLock } from '@/services/publication/liveEntityMerge';
import {
  acquireProtectedMaintenanceGatesShared,
  assertAuthoritativeEntitiesMutable,
} from '@/services/publication/protectedAuthoritativeMutation';

type ControlChangeTargetType = 'source' | 'source_system' | 'source_feed';
type ControlChangeAction = 'create' | 'update' | 'deactivate';

interface BaseControlChangePayload {
  entityType: ControlChangeTargetType;
  action: ControlChangeAction;
  entityId: string;
  entityLabel: string;
  summary: string;
  beforeState: Record<string, unknown> | null;
}

export interface SourceControlChangePayload extends BaseControlChangePayload {
  entityType: 'source';
  action: 'update' | 'deactivate';
  nextState?: Record<string, unknown>;
}

export interface SourceSystemControlChangePayload extends BaseControlChangePayload {
  entityType: 'source_system';
  action: 'create' | 'update' | 'deactivate';
  createState?: Record<string, unknown>;
  initialFeed?: Record<string, unknown>;
  patch?: Record<string, unknown>;
}

export interface SourceFeedControlChangePayload extends BaseControlChangePayload {
  entityType: 'source_feed';
  action: 'update' | 'deactivate';
  feedPatch?: Record<string, unknown>;
  nextState?: Record<string, unknown> | null;
}

export type IngestionControlChangePayload =
  | SourceControlChangePayload
  | SourceSystemControlChangePayload
  | SourceFeedControlChangePayload;

const SourceSystemPatchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  family: z.enum([
    'hsds_api',
    'hsds_tabular',
    'partner_api',
    'partner_export',
    'government_open_data',
    'allowlisted_scrape',
    'manual',
  ]).optional(),
  trustTier: SourceSystemTrustTierSchema.optional(),
  resourcePurpose: z.enum([
    'service_catalog',
    'program_navigation',
    'supporting_reference',
    'excluded',
  ]).optional(),
  homepageUrl: z.string().url().nullable().optional(),
  licenseNotes: z.string().max(4000).nullable().optional(),
  termsUrl: z.string().url().nullable().optional(),
  hsdsProfileUri: z.string().url().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  domainRules: z.array(z.object({
    type: z.enum(['exact_host', 'suffix']),
    value: z.string().min(1),
  }).strict()).optional(),
  jurisdictionScope: z.record(z.string(), z.unknown()).optional(),
  contactInfo: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
}).strict();

const SourceSystemCreateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  family: z.enum([
    'hsds_api',
    'hsds_tabular',
    'partner_api',
    'partner_export',
    'government_open_data',
    'allowlisted_scrape',
    'manual',
  ]),
  trustTier: SourceSystemTrustTierSchema,
  resourcePurpose: z.enum([
    'service_catalog',
    'program_navigation',
    'supporting_reference',
    'excluded',
  ]),
  homepageUrl: z.string().url().nullable().optional(),
  licenseNotes: z.string().max(4000).nullable().optional(),
  termsUrl: z.string().url().nullable().optional(),
  hsdsProfileUri: z.string().url().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  domainRules: z.array(z.object({
    type: z.enum(['exact_host', 'suffix']),
    value: z.string().min(1),
  }).strict()).default([]),
  crawlPolicy: z.record(z.string(), z.unknown()).default({}),
  jurisdictionScope: z.unknown().default({}),
  contactInfo: z.record(z.string(), z.unknown()).default({}),
  isActive: z.boolean(),
}).strict();

const InitialSourceFeedCreateSchema = z.object({
  id: z.string().uuid(),
  sourceSystemId: z.string().uuid(),
  feedName: z.string().min(1).max(200),
  feedType: z.string().min(1).max(100),
  feedHandler: z.enum(['none', 'hsds_api', 'ndp_211']),
  baseUrl: z.string().url().nullable().optional(),
  healthcheckUrl: z.string().url().nullable().optional(),
  authType: z.string().min(1).max(50).nullable().optional(),
  profileUri: z.string().url().nullable().optional(),
  jurisdictionScope: z.record(z.string(), z.unknown()).default({}),
  refreshIntervalHours: z.number().int().min(1).max(720),
  isActive: z.boolean(),
}).strict();

const SourceFeedPatchSchema = z.object({
  feedName: z.string().min(1).max(200).optional(),
  feedType: z.string().min(1).max(100).optional(),
  feedHandler: z.enum(['none', 'hsds_api', 'ndp_211', 'azure_function']).optional(),
  baseUrl: z.string().url().nullable().optional(),
  healthcheckUrl: z.string().url().nullable().optional(),
  authType: z.string().min(1).max(50).nullable().optional(),
  profileUri: z.string().url().nullable().optional(),
  jurisdictionScope: z.record(z.string(), z.unknown()).optional(),
  refreshIntervalHours: z.number().int().min(1).max(720).optional(),
  isActive: z.boolean().optional(),
}).strict();

const SourceFeedControlStateSchema = z.object({
  sourceFeedId: z.string().min(1),
  publicationMode: z.enum(['canonical_only', 'review_required', 'auto_publish']),
  autoPublishApprovedAt: z.union([z.string().datetime(), z.date()]).nullable().optional(),
  autoPublishApprovedBy: z.string().nullable().optional(),
  emergencyPause: z.boolean().optional(),
  includedDataOwners: z.array(z.string()).optional(),
  excludedDataOwners: z.array(z.string()).optional(),
  maxOrganizationsPerPoll: z.number().int().min(1).max(1000).nullable().optional(),
  replayFromCursor: z.string().nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
}).passthrough();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function requireReviewedUpdatedAt(value: unknown, label: string): string {
  const record = asRecord(value);
  const raw = record?.updatedAt;
  const date = raw instanceof Date ? raw : typeof raw === 'string' ? new Date(raw) : null;
  if (!date || !Number.isFinite(date.getTime())) {
    throw new Error(`${label} is missing its reviewed updatedAt version`);
  }
  return date.toISOString();
}

function valuesDiffer(before: unknown, after: unknown): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function computeIngestionControlProposalHash(
  payload: IngestionControlChangePayload,
): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
}

function proposalHashMatches(payload: IngestionControlChangePayload, expected: string | null): boolean {
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) return false;
  const actualBuffer = Buffer.from(computeIngestionControlProposalHash(payload), 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actualBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function inferHomepageUrl(
  discovery: z.infer<typeof SourceRegistryEntrySchema>['discovery'],
): string | null {
  for (const rule of discovery) {
    if (rule.seedUrls?.[0]) return rule.seedUrls[0];
    if (rule.sitemapUrl) return rule.sitemapUrl;
    if (rule.feedUrl) return rule.feedUrl;
    if (rule.indexUrl) return rule.indexUrl;
  }
  return null;
}

class IngestionControlDecisionConflict extends Error {}

export interface QueueIngestionControlChangeInput {
  submittedByUserId: string;
  actorRole: string;
  targetId: string;
  title: string;
  summary: string;
  payload: IngestionControlChangePayload;
}

export interface PendingIngestionControlChangeRow {
  id: string;
  status: string;
  target_id: string | null;
  title: string | null;
  notes: string | null;
  payload: IngestionControlChangePayload;
  submitted_by_user_id: string;
  reviewer_notes: string | null;
  created_at: string;
  updated_at: string;
}

export function isHighRiskSourceUpdate(
  existing: {
    trustLevel?: string | null;
    resourcePurpose?: string | null;
    domainRules?: unknown;
    discovery?: unknown;
  },
  patch: {
    trustLevel?: string;
    resourcePurpose?: string;
    domainRules?: unknown;
    discovery?: unknown;
  },
): boolean {
  return (
    (patch.trustLevel !== undefined && patch.trustLevel !== existing.trustLevel) ||
    (patch.resourcePurpose !== undefined && patch.resourcePurpose !== existing.resourcePurpose) ||
    (patch.domainRules !== undefined && valuesDiffer(patch.domainRules, existing.domainRules)) ||
    (patch.discovery !== undefined && valuesDiffer(patch.discovery, existing.discovery))
  );
}

export function isHighRiskSourceSystemUpdate(
  existing: {
    family?: string | null;
    trustTier?: string | null;
    resourcePurpose?: string | null;
    domainRules?: unknown;
    isActive?: boolean | null;
  },
  patch: {
    family?: string;
    trustTier?: string;
    resourcePurpose?: string;
    domainRules?: unknown;
    isActive?: boolean;
  },
): boolean {
  return (
    (patch.family !== undefined && patch.family !== existing.family) ||
    (patch.trustTier !== undefined && patch.trustTier !== existing.trustTier) ||
    (patch.resourcePurpose !== undefined && patch.resourcePurpose !== existing.resourcePurpose) ||
    (patch.domainRules !== undefined && valuesDiffer(patch.domainRules, existing.domainRules)) ||
    (patch.isActive !== undefined && patch.isActive !== existing.isActive)
  );
}

export function isHighRiskSourceFeedUpdate(
  patch: {
    feedName?: string;
    feedType?: string;
    feedHandler?: string;
    baseUrl?: string | null;
    healthcheckUrl?: string | null;
    authType?: string | null;
    profileUri?: string | null;
    jurisdictionScope?: unknown;
    refreshIntervalHours?: number;
    isActive?: boolean;
    state?: { publicationMode?: string; autoPublishApproved?: boolean };
  },
): boolean {
  return (
    patch.feedName !== undefined
    || patch.feedType !== undefined
    || patch.feedHandler !== undefined
    || patch.baseUrl !== undefined
    || patch.healthcheckUrl !== undefined
    || patch.authType !== undefined
    || patch.profileUri !== undefined
    || patch.jurisdictionScope !== undefined
    || patch.refreshIntervalHours !== undefined
    || patch.isActive !== undefined
    || patch.state?.publicationMode !== undefined
    || patch.state?.autoPublishApproved === true
  );
}

export async function queueIngestionControlChange(
  input: QueueIngestionControlChangeInput,
): Promise<{ submissionId: string }> {
  return withTransaction(async (client) => {
    const submissionId = crypto.randomUUID();
    const proposalSha256 = computeIngestionControlProposalHash(input.payload);
    const metadata = {
      approvalType: 'ingestion_control_change',
      entityType: input.payload.entityType,
      action: input.payload.action,
      proposalSha256,
    };

    await client.query(
      `INSERT INTO submissions
         (id, submission_type, status, target_type, target_id, submitted_by_user_id,
          title, notes, payload, priority, submitted_at)
       VALUES ($1, 'ingestion_control_change', 'pending_second_approval', 'system', $2, $3,
               $4, $5, $6::jsonb, 3, NOW())`,
      [
        submissionId,
        input.targetId,
        input.submittedByUserId,
        input.title,
        input.summary,
        JSON.stringify(input.payload),
      ],
    );

    await client.query(
      `INSERT INTO submission_transitions
         (submission_id, from_status, to_status, actor_user_id, actor_role,
          reason, gates_checked, gates_passed, metadata)
       VALUES ($1, 'draft', 'pending_second_approval', $2, $3,
               $4, '["two_person_approval"]'::jsonb, true, $5::jsonb)`,
      [
        submissionId,
        input.submittedByUserId,
        input.actorRole,
        input.summary,
        JSON.stringify(metadata),
      ],
    );

    await client.query(
      `INSERT INTO notification_events
         (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
       SELECT up.user_id,
              'two_person_approval_needed',
              $2,
              $3,
              'submission',
              $1,
              '/queue?status=pending_second_approval',
              'ingestion_control_change_' || $1 || '_' || up.user_id
       FROM user_profiles up
       WHERE up.role = 'oran_admin'
         AND up.user_id != $4
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [submissionId, input.title, input.summary, input.submittedByUserId],
    );

    return { submissionId };
  });
}

export async function listPendingIngestionControlChanges(
  status?: string,
  limit = 50,
  offset = 0,
): Promise<PendingIngestionControlChangeRow[]> {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 100));
  const safeOffset = Math.max(0, Math.trunc(offset));
  const params: unknown[] = [];
  let where = `WHERE submission_type = 'ingestion_control_change'`;

  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }

  params.push(safeLimit, safeOffset);
  return executeQuery<PendingIngestionControlChangeRow>(
    `SELECT id, status, target_id, title, notes, payload, submitted_by_user_id, reviewer_notes, created_at, updated_at
     FROM submissions
     ${where}
     ORDER BY created_at ASC, id ASC
     LIMIT $${params.length - 1}
     OFFSET $${params.length}`,
    params,
  );
}

async function applyRegistrySourceChangeInTransaction(
  client: PoolClient,
  submissionId: string,
  payload: SourceControlChangePayload,
): Promise<void> {
  if (payload.action === 'deactivate') {
    const reviewedUpdatedAt = requireReviewedUpdatedAt(payload.beforeState, `Source ${payload.entityId}`);
    const result = await client.query<{ id: string }>(
      `UPDATE public.source_systems
          SET is_active = false,
              updated_at = NOW()
        WHERE id = $1
          AND updated_at = $2::timestamptz
        RETURNING id`,
      [payload.entityId, reviewedUpdatedAt],
    );
    if (!result.rows[0]) {
      throw new Error(`Source ${payload.entityId} no longer exists`);
    }
    return;
  }

  const nextState = SourceRegistryEntrySchema.safeParse(payload.nextState);
  const beforeState = asRecord(payload.beforeState);
  if (!nextState.success || !beforeState) {
    throw new Error(`Ingestion control change ${submissionId} has invalid source state`);
  }
  if (nextState.data.id !== payload.entityId) {
    throw new Error(`Ingestion control change ${submissionId} targets a different source`);
  }

  // Apply only fields that differed in the reviewed proposal. This preserves
  // unrelated low-risk edits made while the second approval was pending.
  const patch: Record<string, unknown> = {};
  if (valuesDiffer(beforeState.displayName, nextState.data.displayName)) {
    patch.name = nextState.data.displayName;
  }
  if (valuesDiffer(beforeState.trustLevel, nextState.data.trustLevel)) {
    patch.trustTier = registryTrustLevelToSourceSystemTrustTier(nextState.data.trustLevel);
  }
  if (valuesDiffer(beforeState.resourcePurpose, nextState.data.resourcePurpose)) {
    patch.resourcePurpose = nextState.data.resourcePurpose;
  }
  if (valuesDiffer(beforeState.domainRules, nextState.data.domainRules)) {
    patch.domainRules = nextState.data.domainRules;
  }
  if (
    valuesDiffer(beforeState.discovery, nextState.data.discovery)
    || valuesDiffer(beforeState.crawl, nextState.data.crawl)
  ) {
    patch.family = nextState.data.discovery[0]?.type ?? 'seeded_only';
    patch.homepageUrl = inferHomepageUrl(nextState.data.discovery);
    patch.crawlPolicy = {
      ...nextState.data.crawl,
      discovery: nextState.data.discovery,
    };
  }
  if (valuesDiffer(beforeState.coverage, nextState.data.coverage)) {
    patch.jurisdictionScope = nextState.data.coverage;
  }

  const result = await client.query<{ id: string }>(
    `UPDATE public.source_systems
        SET name = CASE WHEN $2::jsonb ? 'name' THEN $2::jsonb ->> 'name' ELSE name END,
            family = CASE WHEN $2::jsonb ? 'family' THEN $2::jsonb ->> 'family' ELSE family END,
            homepage_url = CASE WHEN $2::jsonb ? 'homepageUrl' THEN $2::jsonb ->> 'homepageUrl' ELSE homepage_url END,
            trust_tier = CASE WHEN $2::jsonb ? 'trustTier' THEN $2::jsonb ->> 'trustTier' ELSE trust_tier END,
            resource_purpose = CASE WHEN $2::jsonb ? 'resourcePurpose' THEN $2::jsonb ->> 'resourcePurpose' ELSE resource_purpose END,
            domain_rules = CASE WHEN $2::jsonb ? 'domainRules' THEN $2::jsonb -> 'domainRules' ELSE domain_rules END,
            crawl_policy = CASE WHEN $2::jsonb ? 'crawlPolicy' THEN $2::jsonb -> 'crawlPolicy' ELSE crawl_policy END,
            jurisdiction_scope = CASE WHEN $2::jsonb ? 'jurisdictionScope' THEN $2::jsonb -> 'jurisdictionScope' ELSE jurisdiction_scope END,
            updated_at = NOW()
      WHERE id = $1
        AND is_active = true
        AND updated_at = $3::timestamptz
      RETURNING id`,
    [
      payload.entityId,
      JSON.stringify(patch),
      requireReviewedUpdatedAt(beforeState, `Source ${payload.entityId}`),
    ],
  );
  if (!result.rows[0]) {
    throw new Error(`Source ${payload.entityId} is no longer active; refresh the control change`);
  }
}

async function assertControlTargetMutable(
  client: PoolClient,
  payload: IngestionControlChangePayload,
): Promise<void> {
  if (payload.entityType === 'source_feed') {
    const feed = await client.query<{ source_system_id: string }>(
      `SELECT source_system_id
       FROM public.source_feeds
       WHERE id = $1`,
      [payload.entityId],
    );
    if (!feed.rows[0]) {
      throw new Error(`Source feed ${payload.entityId} no longer exists`);
    }
    await assertAuthoritativeEntitiesMutable(client, {
      sourceSystemIds: [feed.rows[0].source_system_id],
      sourceFeedIds: [payload.entityId],
    });
    return;
  }

  await assertAuthoritativeEntitiesMutable(client, {
    sourceSystemIds: [payload.entityId],
  });
}

async function applySourceSystemChangeInTransaction(
  client: PoolClient,
  submissionId: string,
  payload: SourceSystemControlChangePayload,
): Promise<void> {
  if (payload.action === 'create') {
    const createState = SourceSystemCreateSchema.safeParse(payload.createState);
    const initialFeed = payload.initialFeed
      ? InitialSourceFeedCreateSchema.safeParse(payload.initialFeed)
      : null;
    if (
      !createState.success
      || createState.data.id !== payload.entityId
      || (initialFeed && !initialFeed.success)
      || (initialFeed?.success && initialFeed.data.sourceSystemId !== payload.entityId)
    ) {
      throw new Error(`Ingestion control change ${submissionId} has invalid source creation state`);
    }

    const source = createState.data;
    const created = await client.query<{ id: string }>(
      `INSERT INTO public.source_systems
         (id, name, family, homepage_url, license_notes, terms_url, trust_tier,
          resource_purpose, hsds_profile_uri, domain_rules, crawl_policy,
          jurisdiction_scope, contact_info, is_active, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
               $12::jsonb, $13::jsonb, $14, $15)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        source.id,
        source.name,
        source.family,
        source.homepageUrl ?? null,
        source.licenseNotes ?? null,
        source.termsUrl ?? null,
        source.trustTier,
        source.resourcePurpose,
        source.hsdsProfileUri ?? null,
        JSON.stringify(source.domainRules),
        JSON.stringify(source.crawlPolicy),
        JSON.stringify(source.jurisdictionScope),
        JSON.stringify(source.contactInfo),
        source.isActive,
        source.notes ?? null,
      ],
    );
    if (!created.rows[0]) {
      throw new Error(`Source system ${payload.entityId} already exists; refresh the control change`);
    }

    if (initialFeed?.success) {
      const feed = initialFeed.data;
      const createdFeed = await client.query<{ id: string }>(
        `INSERT INTO public.source_feeds
           (id, source_system_id, feed_name, feed_type, feed_handler, base_url,
            healthcheck_url, auth_type, profile_uri, jurisdiction_scope,
            refresh_interval_hours, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          feed.id,
          feed.sourceSystemId,
          feed.feedName,
          feed.feedType,
          feed.feedHandler,
          feed.baseUrl ?? null,
          feed.healthcheckUrl ?? null,
          feed.authType ?? 'none',
          feed.profileUri ?? null,
          JSON.stringify(feed.jurisdictionScope),
          feed.refreshIntervalHours,
          feed.isActive,
        ],
      );
      if (!createdFeed.rows[0]) {
        throw new Error(`Initial source feed ${feed.id} already exists`);
      }
      await client.query(
        `INSERT INTO public.source_feed_states
           (source_feed_id, publication_mode, emergency_pause,
            included_data_owners, excluded_data_owners)
         VALUES ($1, 'review_required', false, '[]'::jsonb, '[]'::jsonb)`,
        [feed.id],
      );
    }
    return;
  }

  if (payload.action === 'deactivate') {
    const reviewedUpdatedAt = requireReviewedUpdatedAt(
      payload.beforeState,
      `Source system ${payload.entityId}`,
    );
    const result = await client.query<{ id: string }>(
      `UPDATE public.source_systems
          SET is_active = false,
              updated_at = NOW()
        WHERE id = $1
          AND updated_at = $2::timestamptz
        RETURNING id`,
      [payload.entityId, reviewedUpdatedAt],
    );
    if (!result.rows[0]) {
      throw new Error(`Source system ${payload.entityId} no longer exists`);
    }
    return;
  }

  const patch = SourceSystemPatchSchema.safeParse(payload.patch ?? {});
  if (!patch.success || Object.keys(patch.data).length === 0) {
    throw new Error(`Ingestion control change ${submissionId} has an invalid source-system patch`);
  }
  const result = await client.query<{ id: string }>(
    `UPDATE public.source_systems
        SET name = CASE WHEN $2::jsonb ? 'name' THEN $2::jsonb ->> 'name' ELSE name END,
            family = CASE WHEN $2::jsonb ? 'family' THEN $2::jsonb ->> 'family' ELSE family END,
            trust_tier = CASE WHEN $2::jsonb ? 'trustTier' THEN $2::jsonb ->> 'trustTier' ELSE trust_tier END,
            resource_purpose = CASE WHEN $2::jsonb ? 'resourcePurpose' THEN $2::jsonb ->> 'resourcePurpose' ELSE resource_purpose END,
            homepage_url = CASE WHEN $2::jsonb ? 'homepageUrl' THEN $2::jsonb ->> 'homepageUrl' ELSE homepage_url END,
            license_notes = CASE WHEN $2::jsonb ? 'licenseNotes' THEN $2::jsonb ->> 'licenseNotes' ELSE license_notes END,
            terms_url = CASE WHEN $2::jsonb ? 'termsUrl' THEN $2::jsonb ->> 'termsUrl' ELSE terms_url END,
            hsds_profile_uri = CASE WHEN $2::jsonb ? 'hsdsProfileUri' THEN $2::jsonb ->> 'hsdsProfileUri' ELSE hsds_profile_uri END,
            notes = CASE WHEN $2::jsonb ? 'notes' THEN $2::jsonb ->> 'notes' ELSE notes END,
            domain_rules = CASE WHEN $2::jsonb ? 'domainRules' THEN $2::jsonb -> 'domainRules' ELSE domain_rules END,
            jurisdiction_scope = CASE WHEN $2::jsonb ? 'jurisdictionScope' THEN $2::jsonb -> 'jurisdictionScope' ELSE jurisdiction_scope END,
            contact_info = CASE WHEN $2::jsonb ? 'contactInfo' THEN $2::jsonb -> 'contactInfo' ELSE contact_info END,
            is_active = CASE WHEN $2::jsonb ? 'isActive' THEN ($2::jsonb ->> 'isActive')::boolean ELSE is_active END,
            updated_at = NOW()
      WHERE id = $1
        AND updated_at = $3::timestamptz
      RETURNING id`,
    [
      payload.entityId,
      JSON.stringify(patch.data),
      requireReviewedUpdatedAt(payload.beforeState, `Source system ${payload.entityId}`),
    ],
  );
  if (!result.rows[0]) {
    throw new Error(`Source system ${payload.entityId} no longer exists`);
  }
}

async function applySourceFeedChangeInTransaction(
  client: PoolClient,
  submissionId: string,
  payload: SourceFeedControlChangePayload,
): Promise<void> {
  if (payload.action === 'deactivate') {
    const beforeState = asRecord(payload.beforeState);
    const reviewedUpdatedAt = requireReviewedUpdatedAt(
      asRecord(beforeState?.feed) ?? payload.beforeState,
      `Source feed ${payload.entityId}`,
    );
    const result = await client.query<{ id: string }>(
      `UPDATE public.source_feeds
          SET is_active = false,
              updated_at = NOW()
        WHERE id = $1
          AND updated_at = $2::timestamptz
        RETURNING id`,
      [payload.entityId, reviewedUpdatedAt],
    );
    if (!result.rows[0]) {
      throw new Error(`Source feed ${payload.entityId} no longer exists`);
    }
    return;
  }

  if (payload.feedPatch && Object.keys(payload.feedPatch).length > 0) {
    const feedPatch = SourceFeedPatchSchema.safeParse(payload.feedPatch);
    if (!feedPatch.success) {
      throw new Error(`Ingestion control change ${submissionId} has an invalid source-feed patch`);
    }
    const feedResult = await client.query<{ id: string }>(
      `UPDATE public.source_feeds
          SET feed_name = CASE WHEN $2::jsonb ? 'feedName' THEN $2::jsonb ->> 'feedName' ELSE feed_name END,
              feed_type = CASE WHEN $2::jsonb ? 'feedType' THEN $2::jsonb ->> 'feedType' ELSE feed_type END,
              feed_handler = CASE WHEN $2::jsonb ? 'feedHandler' THEN $2::jsonb ->> 'feedHandler' ELSE feed_handler END,
              base_url = CASE WHEN $2::jsonb ? 'baseUrl' THEN $2::jsonb ->> 'baseUrl' ELSE base_url END,
              healthcheck_url = CASE WHEN $2::jsonb ? 'healthcheckUrl' THEN $2::jsonb ->> 'healthcheckUrl' ELSE healthcheck_url END,
              auth_type = CASE WHEN $2::jsonb ? 'authType' THEN $2::jsonb ->> 'authType' ELSE auth_type END,
              profile_uri = CASE WHEN $2::jsonb ? 'profileUri' THEN $2::jsonb ->> 'profileUri' ELSE profile_uri END,
              jurisdiction_scope = CASE WHEN $2::jsonb ? 'jurisdictionScope' THEN $2::jsonb -> 'jurisdictionScope' ELSE jurisdiction_scope END,
              refresh_interval_hours = CASE WHEN $2::jsonb ? 'refreshIntervalHours' THEN ($2::jsonb ->> 'refreshIntervalHours')::integer ELSE refresh_interval_hours END,
              is_active = CASE WHEN $2::jsonb ? 'isActive' THEN ($2::jsonb ->> 'isActive')::boolean ELSE is_active END,
              updated_at = NOW()
        WHERE id = $1
          AND updated_at = $3::timestamptz
        RETURNING id`,
      [
        payload.entityId,
        JSON.stringify(feedPatch.data),
        requireReviewedUpdatedAt(
          asRecord(asRecord(payload.beforeState)?.feed),
          `Source feed ${payload.entityId}`,
        ),
      ],
    );
    if (!feedResult.rows[0]) {
      throw new Error(`Source feed ${payload.entityId} no longer exists`);
    }
  }

  if (payload.nextState) {
    const state = SourceFeedControlStateSchema.safeParse(payload.nextState);
    if (!state.success || state.data.sourceFeedId !== payload.entityId) {
      throw new Error(`Ingestion control change ${submissionId} has invalid source-feed state`);
    }
    const approvedAt = state.data.autoPublishApprovedAt instanceof Date
      ? state.data.autoPublishApprovedAt.toISOString()
      : state.data.autoPublishApprovedAt ?? null;
    const beforeState = asRecord(payload.beforeState);
    const reviewedState = asRecord(beforeState?.state);
    const currentState = await client.query<{ updated_at: Date | string }>(
      `SELECT updated_at
       FROM public.source_feed_states
       WHERE source_feed_id = $1
       FOR UPDATE`,
      [payload.entityId],
    );
    if (reviewedState) {
      const reviewedUpdatedAt = requireReviewedUpdatedAt(
        reviewedState,
        `Source feed state ${payload.entityId}`,
      );
      const currentUpdatedAt = currentState.rows[0]?.updated_at;
      if (!currentUpdatedAt || new Date(currentUpdatedAt).toISOString() !== reviewedUpdatedAt) {
        throw new Error(`Source feed state ${payload.entityId} changed after review; refresh the control change`);
      }
    } else if (currentState.rows[0]) {
      throw new Error(`Source feed state ${payload.entityId} was created after review; refresh the control change`);
    }
    await client.query(
      `INSERT INTO public.source_feed_states
         (source_feed_id, publication_mode, auto_publish_approved_at,
          auto_publish_approved_by, emergency_pause, included_data_owners,
          excluded_data_owners, max_organizations_per_poll,
          replay_from_cursor, notes, updated_at)
       VALUES ($1, $2, $3::timestamptz, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, NOW())
       ON CONFLICT (source_feed_id)
       DO UPDATE SET
         publication_mode = EXCLUDED.publication_mode,
         auto_publish_approved_at = EXCLUDED.auto_publish_approved_at,
         auto_publish_approved_by = EXCLUDED.auto_publish_approved_by,
         emergency_pause = EXCLUDED.emergency_pause,
         included_data_owners = EXCLUDED.included_data_owners,
         excluded_data_owners = EXCLUDED.excluded_data_owners,
         max_organizations_per_poll = EXCLUDED.max_organizations_per_poll,
         replay_from_cursor = EXCLUDED.replay_from_cursor,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [
        payload.entityId,
        state.data.publicationMode,
        approvedAt,
        state.data.autoPublishApprovedBy ?? null,
        state.data.emergencyPause ?? false,
        JSON.stringify(state.data.includedDataOwners ?? []),
        JSON.stringify(state.data.excludedDataOwners ?? []),
        state.data.maxOrganizationsPerPoll ?? null,
        state.data.replayFromCursor ?? null,
        state.data.notes ?? null,
      ],
    );
  }

  if ((!payload.feedPatch || Object.keys(payload.feedPatch).length === 0) && !payload.nextState) {
    throw new Error(`Ingestion control change ${submissionId} has no source-feed update`);
  }
}

export async function applyApprovedIngestionControlChangeInTransaction(
  client: PoolClient,
  submissionId: string,
  payload: IngestionControlChangePayload,
): Promise<void> {
  if (payload.entityType === 'source') {
    await applyRegistrySourceChangeInTransaction(client, submissionId, payload);
    return;
  }
  if (payload.entityType === 'source_system') {
    await applySourceSystemChangeInTransaction(client, submissionId, payload);
    return;
  }
  await applySourceFeedChangeInTransaction(client, submissionId, payload);
}

export async function applyApprovedIngestionControlChange(submissionId: string): Promise<void> {
  await withTransaction(async (client) => {
    await acquireLivePublicationMergeLock(client);
    await acquireProtectedMaintenanceGatesShared(client);
    const rows = await client.query<{
      status: string;
      payload: IngestionControlChangePayload;
      proposal_sha256: string | null;
    }>(
      `SELECT submission.status,
              submission.payload,
              reviewed_transition.metadata ->> 'proposalSha256' AS proposal_sha256
       FROM submissions submission
       LEFT JOIN LATERAL (
         SELECT transition.metadata
         FROM submission_transitions transition
         WHERE transition.submission_id = submission.id
           AND transition.to_status = 'pending_second_approval'
         ORDER BY transition.created_at ASC, transition.id ASC
         LIMIT 1
       ) reviewed_transition ON true
       WHERE submission.id = $1
         AND submission.submission_type = 'ingestion_control_change'
       FOR UPDATE OF submission`,
      [submissionId],
    );
    const row = rows.rows[0];
    if (!row) {
      throw new Error(`Ingestion control change submission ${submissionId} not found`);
    }
    if (row.status !== 'approved') {
      throw new Error(`Ingestion control change submission ${submissionId} is not approved`);
    }
    if (!proposalHashMatches(row.payload, row.proposal_sha256)) {
      throw new Error(`Ingestion control change submission ${submissionId} failed proposal integrity validation`);
    }
    await assertControlTargetMutable(client, row.payload);
    await applyApprovedIngestionControlChangeInTransaction(client, submissionId, row.payload);
  });
}

export async function decideIngestionControlChange(input: {
  submissionId: string;
  actorUserId: string;
  actorRole: string;
  decision: 'approved' | 'denied';
  notes?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await withTransaction(async (client) => {
      // Authority changes must not race a publication decision that still sees
      // the prior trust/purpose/rollout state.
      await acquireLivePublicationMergeLock(client);
      await acquireProtectedMaintenanceGatesShared(client);

      const actorRows = await client.query<{ role: string; account_status: string | null }>(
        `SELECT role, account_status
         FROM user_profiles
         WHERE user_id = $1
         FOR SHARE`,
        [input.actorUserId],
      );
      const actor = actorRows.rows[0];
      if (!actor || actor.account_status !== 'active' || actor.role !== 'oran_admin') {
        throw new IngestionControlDecisionConflict(
          'Only an active ORAN administrator may decide ingestion control changes.',
        );
      }

      const rows = await client.query<{
        status: string;
        payload: IngestionControlChangePayload;
        submitted_by_user_id: string;
        assigned_to_user_id: string | null;
        is_locked: boolean;
        locked_by_user_id: string | null;
        proposal_sha256: string | null;
      }>(
        `SELECT submission.status,
                submission.payload,
                submission.submitted_by_user_id,
                submission.assigned_to_user_id,
                submission.is_locked,
                submission.locked_by_user_id,
                reviewed_transition.metadata ->> 'proposalSha256' AS proposal_sha256
         FROM submissions submission
         LEFT JOIN LATERAL (
           SELECT transition.metadata
           FROM submission_transitions transition
           WHERE transition.submission_id = submission.id
             AND transition.to_status = 'pending_second_approval'
           ORDER BY transition.created_at ASC, transition.id ASC
           LIMIT 1
         ) reviewed_transition ON true
         WHERE submission.id = $1
           AND submission.submission_type = 'ingestion_control_change'
         FOR UPDATE OF submission`,
        [input.submissionId],
      );
      const submission = rows.rows[0];
      if (!submission) {
        throw new IngestionControlDecisionConflict('Ingestion control change not found.');
      }
      if (submission.status !== 'pending_second_approval') {
        throw new IngestionControlDecisionConflict(
          'Ingestion control change is no longer awaiting second approval.',
        );
      }
      if (!proposalHashMatches(submission.payload, submission.proposal_sha256)) {
        throw new IngestionControlDecisionConflict(
          'The reviewed ingestion control proposal changed after submission.',
        );
      }
      if (submission.submitted_by_user_id === input.actorUserId) {
        throw new IngestionControlDecisionConflict(
          'A different ORAN administrator must provide the second approval.',
        );
      }
      if (
        (submission.assigned_to_user_id && submission.assigned_to_user_id !== input.actorUserId)
        || (submission.is_locked && submission.locked_by_user_id !== input.actorUserId)
      ) {
        throw new IngestionControlDecisionConflict(
          'Another administrator owns this second-approval review.',
        );
      }

      const claimed = await client.query<{ id: string }>(
        `UPDATE submissions
            SET assigned_to_user_id = $2,
                is_locked = true,
                locked_by_user_id = $2,
                locked_at = NOW(),
                updated_at = NOW()
          WHERE id = $1
            AND status = 'pending_second_approval'
            AND submitted_by_user_id != $2
            AND (assigned_to_user_id IS NULL OR assigned_to_user_id = $2)
            AND (is_locked = false OR locked_by_user_id = $2)
          RETURNING id`,
        [input.submissionId, input.actorUserId],
      );
      if (!claimed.rows[0]) {
        throw new IngestionControlDecisionConflict(
          'Second-approval ownership changed; refresh and try again.',
        );
      }

      if (input.notes !== undefined) {
        await client.query(
          `UPDATE submissions
              SET reviewer_notes = $1,
                  updated_at = NOW()
            WHERE id = $2`,
          [input.notes || null, input.submissionId],
        );
      }

      const transition = await advanceInTransaction(
        client,
        {
          submissionId: input.submissionId,
          toStatus: input.decision,
          actorUserId: input.actorUserId,
          actorRole: actor.role,
          reason: input.notes ?? `Ingestion control change ${input.decision}`,
        },
        input.decision === 'approved'
          ? {
              applyIngestionControlChange: async () => {
                await assertControlTargetMutable(client, submission.payload);
                await applyApprovedIngestionControlChangeInTransaction(
                  client,
                  input.submissionId,
                  submission.payload,
                );
              },
            }
          : undefined,
      );
      if (!transition.success) {
        throw new IngestionControlDecisionConflict(
          transition.error ?? 'Unable to decide ingestion control change.',
        );
      }
      return transition;
    });

    await sendTerminalStatusEmail(input.submissionId, result.toStatus);
    return { success: true };
  } catch (error) {
    if (error instanceof IngestionControlDecisionConflict) {
      return { success: false, error: error.message };
    }
    throw error;
  }
}
