import crypto from 'node:crypto';

import type { PoolClient } from 'pg';

import type { AuthContext } from '@/services/auth/session';
import { executeQuery, withTransaction } from '@/services/db/postgres';
import {
  createFormInstance,
  createFormTemplate,
  getAccessibleFormInstance,
  listAccessibleFormInstances,
  setFormSubmissionReviewerNotes,
  updateFormInstanceDraft,
} from '@/services/forms/vault';
import type { FormInstance, FormTemplate } from '@/domain/forms';
import type { SubmissionStatus } from '@/domain/types';
import {
  createEmptyResourceSubmissionDraft,
  type ResourceSubmissionChannel,
  computeResourceSubmissionCards,
  isResourceSubmissionComplete,
  normalizeResourceSubmissionDraft,
  type ResourceSubmissionDraft,
  type ResourceSubmissionReviewMeta,
  type ResourceSubmissionVariant,
} from '@/domain/resourceSubmission';

type ResourceTemplateKey = 'host_listing' | 'public_listing' | 'host_claim';

const RESOURCE_TEMPLATE_SPECS: Record<
  ResourceTemplateKey,
  {
    slug: string;
    title: string;
    description: string;
    audience: 'shared' | 'host_member';
    storageScope: 'platform' | 'organization';
    defaultTargetRole: 'community_admin' | 'oran_admin';
    variant: ResourceSubmissionVariant;
    channel: ResourceSubmissionChannel;
    submissionType: 'new_service' | 'org_claim';
  }
> = {
  host_listing: {
    slug: 'resource-listing-host',
    title: 'Resource listing submission',
    description: 'Structured listing submission for organization operators.',
    audience: 'host_member',
    storageScope: 'organization',
    defaultTargetRole: 'community_admin',
    variant: 'listing',
    channel: 'host',
    submissionType: 'new_service',
  },
  public_listing: {
    slug: 'resource-listing-public',
    title: 'Community resource submission',
    description: 'Structured listing suggestion submitted by a community member.',
    audience: 'shared',
    storageScope: 'platform',
    defaultTargetRole: 'community_admin',
    variant: 'listing',
    channel: 'public',
    submissionType: 'new_service',
  },
  host_claim: {
    slug: 'resource-claim-host',
    title: 'Organization claim submission',
    description: 'Structured ownership claim for a host operator.',
    audience: 'host_member',
    storageScope: 'platform',
    defaultTargetRole: 'oran_admin',
    variant: 'claim',
    channel: 'host',
    submissionType: 'org_claim',
  },
};

interface CreateResourceSubmissionInput {
  variant: ResourceSubmissionVariant;
  channel: ResourceSubmissionChannel;
  submittedByUserId: string;
  actorRole?: string | null;
  ownerOrganizationId?: string | null;
  existingServiceId?: string | null;
  draft?: unknown;
  title?: string | null;
  notes?: string | null;
}

interface UpdateResourceSubmissionDraftInput {
  title?: string | null;
  notes?: string | null;
  draft?: unknown;
}

export interface ResourceSubmissionDetail {
  instance: FormInstance;
  draft: ResourceSubmissionDraft;
  cards: ReturnType<typeof computeResourceSubmissionCards>;
  reviewMeta: ResourceSubmissionReviewMeta;
  transitions: Array<{
    id: string;
    from_status: string;
    to_status: string;
    actor_user_id: string;
    actor_role: string | null;
    actor_display_name: string | null;
    reason: string | null;
    created_at: string;
  }>;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function hashPublicAccessToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function resolveSubmissionTitle(draft: ResourceSubmissionDraft): string {
  if (draft.variant === 'claim') {
    return `Claim organization: ${draft.organization.name || 'Untitled'}`;
  }

  return `Resource: ${draft.service.name || draft.organization.name || 'Untitled'}`;
}

function resolveSubmissionTargetType(
  variant: ResourceSubmissionVariant,
  existingServiceId: string | null,
  ownerOrganizationId: string | null,
): 'service' | 'organization' | 'system' {
  if (existingServiceId) return 'service';
  if (variant === 'claim') return 'organization';
  if (ownerOrganizationId) return 'organization';
  return 'system';
}

function buildSeedWeek(): ResourceSubmissionDraft['locations'][number]['schedule'] {
  return createEmptyResourceSubmissionDraft('listing', 'host').locations[0]?.schedule ?? [];
}

function mapStoredWeekday(value: string): ResourceSubmissionDraft['locations'][number]['schedule'][number]['day'] | null {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'monday':
    case 'mo':
      return 'Monday';
    case 'tuesday':
    case 'tu':
      return 'Tuesday';
    case 'wednesday':
    case 'we':
      return 'Wednesday';
    case 'thursday':
    case 'th':
      return 'Thursday';
    case 'friday':
    case 'fr':
      return 'Friday';
    case 'saturday':
    case 'sa':
      return 'Saturday';
    case 'sunday':
    case 'su':
      return 'Sunday';
    default:
      return null;
  }
}

function resolveTemplateKey(
  variant: ResourceSubmissionVariant,
  channel: ResourceSubmissionChannel,
): ResourceTemplateKey {
  if (variant === 'claim') return 'host_claim';
  return channel === 'host' ? 'host_listing' : 'public_listing';
}

function buildTemplateSchema(spec: (typeof RESOURCE_TEMPLATE_SPECS)[ResourceTemplateKey]): Record<string, unknown> {
  return {
    ui: {
      shell: 'resource_submission',
      variant: spec.variant,
      channel: spec.channel,
    },
    routing: {
      submissionType: spec.submissionType,
      targetType: 'system',
      defaultRecipientRole: spec.defaultTargetRole,
      defaultPriority: spec.channel === 'public' ? 1 : 0,
      autoQueueForReview: false,
      attachmentsEnabled: true,
      maxAttachments: 5,
    },
  };
}

async function resolveResourceInstanceId(identifier: string): Promise<string | null> {
  const rows = await executeQuery<{ id: string }>(
    `SELECT fi.id
       FROM form_instances fi
       JOIN form_templates ft ON ft.id = fi.template_id
      WHERE ft.slug LIKE 'resource-%'
        AND (fi.id = $1 OR fi.submission_id = $1)
      LIMIT 1`,
    [identifier],
  );

  return rows[0]?.id ?? null;
}

async function getResourceSubmissionInstanceForPublic(
  identifier: string,
  accessToken: string,
): Promise<FormInstance | null> {
  const resolvedId = await resolveResourceInstanceId(identifier);
  if (!resolvedId) {
    return null;
  }

  const rows = await executeQuery<FormInstance>(
    `SELECT fi.id,
            fi.submission_id,
            fi.template_id,
            ft.slug AS template_slug,
            ft.title AS template_title,
            ft.description AS template_description,
            ft.category AS template_category,
            ft.audience_scope AS template_audience_scope,
            ft.storage_scope AS template_storage_scope,
            ft.default_target_role AS template_default_target_role,
            ft.schema_json AS template_schema_json,
            ft.ui_schema_json AS template_ui_schema_json,
            ft.instructions_markdown AS template_instructions_markdown,
            ft.is_published AS template_is_published,
            fi.template_version,
            fi.storage_scope,
            fi.owner_organization_id,
            fi.coverage_zone_id,
            fi.recipient_role,
            fi.recipient_user_id,
            fi.recipient_organization_id,
            fi.blob_storage_prefix,
            fi.form_data,
            fi.attachment_manifest,
            fi.last_saved_at,
            s.submission_type,
            s.status,
            s.target_type,
            s.target_id,
            s.submitted_by_user_id,
            s.assigned_to_user_id,
            s.title,
            s.notes,
            s.reviewer_notes,
            s.priority,
            s.sla_deadline,
            s.sla_breached,
            s.submitted_at,
            s.reviewed_at,
            s.resolved_at,
            s.created_at,
            s.updated_at
       FROM form_instances fi
       JOIN form_templates ft ON ft.id = fi.template_id
       JOIN submissions s ON s.id = fi.submission_id
      WHERE fi.id = $1
        AND ft.slug = 'resource-listing-public'
        AND coalesce(s.payload->>'publicAccessTokenHash', '') = $2`,
    [resolvedId, hashPublicAccessToken(accessToken)],
  );

  return rows[0] ?? null;
}

async function getResourceSubmissionSupplemental(submissionId: string): Promise<{
  payload: Record<string, unknown>;
  submittedByLabel: string | null;
  assignedToLabel: string | null;
}> {
  const rows = await executeQuery<{
    payload: Record<string, unknown>;
    submitted_by_label: string | null;
    assigned_to_label: string | null;
  }>(
    `SELECT s.payload,
            submitter.display_name AS submitted_by_label,
            assignee.display_name AS assigned_to_label
       FROM submissions s
       LEFT JOIN user_profiles submitter ON submitter.user_id = s.submitted_by_user_id
       LEFT JOIN user_profiles assignee ON assignee.user_id = s.assigned_to_user_id
      WHERE s.id = $1
      LIMIT 1`,
    [submissionId],
  );

  return {
    payload: readObject(rows[0]?.payload),
    submittedByLabel: rows[0]?.submitted_by_label ?? null,
    assignedToLabel: rows[0]?.assigned_to_label ?? null,
  };
}

async function buildResourceSubmissionDetail(instance: FormInstance): Promise<ResourceSubmissionDetail> {
  const draft = normalizeResourceSubmissionDraft(
    readObject(instance.form_data).draft,
    instance.template_slug.includes('claim') ? 'claim' : 'listing',
    instance.template_slug.includes('public') ? 'public' : 'host',
  );

  const [transitions, confidenceRows, supplemental] = await Promise.all([
    executeQuery<{
      id: string;
      from_status: string;
      to_status: string;
      actor_user_id: string;
      actor_role: string | null;
      actor_display_name: string | null;
      reason: string | null;
      created_at: string;
    }>(
      `SELECT st.id,
              st.from_status,
              st.to_status,
              st.actor_user_id,
              st.actor_role,
              up.display_name AS actor_display_name,
              st.reason,
              st.created_at
         FROM submission_transitions st
         LEFT JOIN user_profiles up ON up.user_id = st.actor_user_id
        WHERE st.submission_id = $1
        ORDER BY st.created_at ASC`,
      [instance.submission_id],
    ),
    instance.target_id
      ? executeQuery<{ score: number; verification_confidence: number }>(
          `SELECT score, verification_confidence
             FROM confidence_scores
            WHERE service_id = $1
            LIMIT 1`,
          [instance.target_id],
        )
      : Promise.resolve([]),
    getResourceSubmissionSupplemental(instance.submission_id),
  ]);

  const reviewMeta: ResourceSubmissionReviewMeta = {
    submissionId: instance.submission_id,
    status: instance.status,
    submissionType: instance.submission_type,
    targetType: instance.target_type,
    targetId: instance.target_id,
    submittedByUserId: instance.submitted_by_user_id,
    submittedByLabel: supplemental.submittedByLabel,
    assignedToUserId: instance.assigned_to_user_id,
    assignedToLabel: supplemental.assignedToLabel,
    reviewedAt: instance.reviewed_at,
    resolvedAt: instance.resolved_at,
    submittedAt: instance.submitted_at,
    slaDeadline: instance.sla_deadline,
    confidenceScore: confidenceRows[0]?.score ?? null,
    verificationConfidence: confidenceRows[0]?.verification_confidence ?? null,
    reverifyAt: null,
    reviewerNotes: instance.reviewer_notes,
    sourceRecordId: typeof supplemental.payload.sourceRecordId === 'string'
      ? supplemental.payload.sourceRecordId
      : null,
  };

  return {
    instance,
    draft,
    cards: computeResourceSubmissionCards(draft, reviewMeta),
    reviewMeta,
    transitions,
  };
}

async function getTemplateBySlug(slug: string): Promise<FormTemplate | null> {
  const rows = await executeQuery<FormTemplate>(
    `SELECT * FROM form_templates WHERE slug = $1 LIMIT 1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function ensureResourceSubmissionTemplate(
  variant: ResourceSubmissionVariant,
  channel: ResourceSubmissionChannel,
  createdByUserId?: string | null,
): Promise<FormTemplate> {
  const key = resolveTemplateKey(variant, channel);
  const spec = RESOURCE_TEMPLATE_SPECS[key];
  const existing = await getTemplateBySlug(spec.slug);
  if (existing) {
    return existing;
  }

  return createFormTemplate({
    slug: spec.slug,
    title: spec.title,
    description: spec.description,
    category: spec.variant === 'claim' ? 'org_verification' : 'service_listing',
    audience_scope: spec.audience,
    storage_scope: spec.storageScope,
    default_target_role: spec.defaultTargetRole,
    schema_json: buildTemplateSchema(spec),
    ui_schema_json: {
      shell: 'resource_submission',
      variant: spec.variant,
      channel: spec.channel,
    },
    instructions_markdown:
      spec.variant === 'claim'
        ? 'Complete each card, explain your relationship to the organization, and submit for review.'
        : 'Complete each card, verify the taxonomy and contact paths, then submit for review.',
    is_published: true,
    created_by_user_id: createdByUserId ?? null,
  });
}

async function ensureManualSubmissionSourceSystem(
  client: PoolClient,
  channel: ResourceSubmissionChannel,
): Promise<{ sourceSystemId: string; sourceFeedId: string }> {
  const sourceName =
    channel === 'host'
      ? 'ORAN Resource Studio'
      : 'ORAN Community Resource Submissions';
  const family = channel === 'host' ? 'host_portal' : 'community_submission';
  const baseUrl = channel === 'host' ? 'oran://resource-studio' : 'oran://community-resource-submissions';
  const trustTier = channel === 'host' ? 'allowlisted' : 'quarantine';

  const systemRows = await client.query<{ id: string }>(
    `INSERT INTO source_systems
       (name, family, homepage_url, trust_tier, domain_rules, crawl_policy, jurisdiction_scope, contact_info, notes)
     VALUES ($1, $2, $3, $4, '[]'::jsonb, $5::jsonb, '{}'::jsonb, '{}'::jsonb, $6)
     ON CONFLICT (name)
     DO UPDATE SET
       family = EXCLUDED.family,
       homepage_url = EXCLUDED.homepage_url,
       trust_tier = EXCLUDED.trust_tier,
       crawl_policy = EXCLUDED.crawl_policy,
       updated_at = NOW()
     RETURNING id`,
    [
      sourceName,
      family,
      baseUrl,
      trustTier,
      JSON.stringify({
        origin: channel,
        discovery: [{ type: channel === 'host' ? 'manual_portal' : 'manual_public_submission' }],
      }),
      channel === 'host'
        ? 'Structured resource submissions from authenticated host operators.'
        : 'Structured resource submissions from public and community contributors.',
    ],
  );
  const sourceSystemId = systemRows.rows[0].id;

  const feedName = channel === 'host' ? 'Resource Studio Intake' : 'Community Resource Intake';
  const feedRows = await client.query<{ id: string }>(
    `SELECT id
       FROM source_feeds
      WHERE source_system_id = $1
        AND feed_name = $2
      LIMIT 1`,
    [sourceSystemId, feedName],
  );

  if (feedRows.rows[0]?.id) {
    return { sourceSystemId, sourceFeedId: feedRows.rows[0].id };
  }

  const createdFeed = await client.query<{ id: string }>(
    `INSERT INTO source_feeds
       (source_system_id, feed_name, feed_type, feed_handler, base_url, auth_type, jurisdiction_scope, refresh_interval_hours)
     VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, 24)
     RETURNING id`,
    [
      sourceSystemId,
      feedName,
      channel === 'host' ? 'manual_portal' : 'manual_submission',
      'none',
      baseUrl,
      channel === 'host' ? 'session' : 'none',
    ],
  );

  return { sourceSystemId, sourceFeedId: createdFeed.rows[0].id };
}

async function attachSourceAssertion(
  client: PoolClient,
  submissionId: string,
  variant: ResourceSubmissionVariant,
  channel: ResourceSubmissionChannel,
  actorUserId: string,
  actorRole: string | null,
  draft: ResourceSubmissionDraft,
): Promise<string> {
  const { sourceFeedId } = await ensureManualSubmissionSourceSystem(client, channel);
  const payloadJson = JSON.stringify({ submissionId, variant, channel, draft });
  const payloadSha256 = crypto.createHash('sha256').update(payloadJson).digest('hex');

  const existing = await client.query<{ id: string }>(
    `SELECT id
       FROM source_records
      WHERE source_feed_id = $1
        AND source_record_type = $2
        AND source_record_id = $3
        AND payload_sha256 = $4
      LIMIT 1`,
    [sourceFeedId, variant === 'claim' ? 'org_claim_submission' : 'resource_submission', submissionId, payloadSha256],
  );

  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
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
      variant === 'claim' ? 'org_claim_submission' : 'resource_submission',
      submissionId,
      `oran://resource-submissions/${submissionId}`,
      payloadSha256,
      payloadJson,
      `resource-submission:${submissionId}`,
      'internal_submission',
      JSON.stringify({
        channel,
        actorUserId,
        actorRole,
        authenticated: !actorUserId.startsWith('anon_'),
      }),
    ],
  );

  return created.rows[0].id;
}

async function attachApprovedProjectionAssertion(
  client: PoolClient,
  submissionId: string,
  variant: ResourceSubmissionVariant,
  channel: ResourceSubmissionChannel,
  actorUserId: string,
  draft: ResourceSubmissionDraft,
  projection: {
    organizationId: string | null;
    serviceId: string | null;
    targetType: 'organization' | 'service';
    submissionType: string;
  },
): Promise<string> {
  const { sourceFeedId } = await ensureManualSubmissionSourceSystem(client, channel);
  const payloadJson = JSON.stringify({
    submissionId,
    variant,
    channel,
    projection,
    draft,
  });
  const payloadSha256 = crypto.createHash('sha256').update(payloadJson).digest('hex');
  const sourceRecordType = variant === 'claim'
    ? 'approved_org_claim_projection'
    : 'approved_resource_projection';

  const existing = await client.query<{ id: string }>(
    `SELECT id
       FROM source_records
      WHERE source_feed_id = $1
        AND source_record_type = $2
        AND source_record_id = $3
        AND payload_sha256 = $4
      LIMIT 1`,
    [sourceFeedId, sourceRecordType, submissionId, payloadSha256],
  );

  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
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
      sourceRecordType,
      submissionId,
      `oran://resource-submissions/${submissionId}/projection`,
      payloadSha256,
      payloadJson,
      `resource-projection:${submissionId}`,
      'internal_submission',
      JSON.stringify({
        channel,
        actorUserId,
        targetType: projection.targetType,
        submissionType: projection.submissionType,
      }),
    ],
  );

  return created.rows[0].id;
}

async function updateSubmissionPayload(
  client: PoolClient,
  submissionId: string,
  payloadPatch: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `UPDATE submissions
        SET payload = COALESCE(payload, '{}'::jsonb) || $1::jsonb,
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(payloadPatch), submissionId],
  );
}

export async function setResourceSubmissionPublicAccessToken(
  submissionId: string,
  accessToken: string,
): Promise<void> {
  await withTransaction(async (client) => {
    await updateSubmissionPayload(client, submissionId, {
      publicAccessTokenHash: hashPublicAccessToken(accessToken),
    });
  });
}

export async function seedResourceSubmissionDraftFromService(
  serviceId: string,
  channel: ResourceSubmissionChannel = 'host',
): Promise<ResourceSubmissionDraft> {
  const draft = createEmptyResourceSubmissionDraft('listing', channel);
  draft.existingServiceId = serviceId;

  const serviceRows = await executeQuery<{
    organization_id: string;
    organization_name: string | null;
    organization_description: string | null;
    organization_url: string | null;
    organization_email: string | null;
    organization_phone: string | null;
    organization_tax_status: string | null;
    organization_tax_id: string | null;
    organization_year_incorporated: number | null;
    organization_legal_status: string | null;
    service_name: string;
    service_description: string | null;
    service_url: string | null;
    service_email: string | null;
    interpretation_services: string | null;
    application_process: string | null;
    fees: string | null;
    wait_time: string | null;
    accreditations: string | null;
    licenses: string | null;
  }>(
    `SELECT s.organization_id,
            o.name AS organization_name,
            o.description AS organization_description,
            o.url AS organization_url,
            o.email AS organization_email,
            o.phone AS organization_phone,
            o.tax_status AS organization_tax_status,
            o.tax_id AS organization_tax_id,
            o.year_incorporated AS organization_year_incorporated,
            o.legal_status AS organization_legal_status,
            s.name AS service_name,
            s.description AS service_description,
            s.url AS service_url,
            s.email AS service_email,
            s.interpretation_services,
            s.application_process,
            s.fees,
            s.wait_time,
            s.accreditations,
            s.licenses
       FROM services s
       JOIN organizations o ON o.id = s.organization_id
      WHERE s.id = $1
      LIMIT 1`,
    [serviceId],
  );

  const service = serviceRows[0];
  if (!service) {
    return draft;
  }

  draft.ownerOrganizationId = service.organization_id;
  draft.organization = {
    name: service.organization_name ?? '',
    description: service.organization_description ?? '',
    url: service.organization_url ?? '',
    email: service.organization_email ?? '',
    phone: service.organization_phone ?? '',
    taxStatus: service.organization_tax_status ?? '',
    taxId: service.organization_tax_id ?? '',
    yearIncorporated: service.organization_year_incorporated ? String(service.organization_year_incorporated) : '',
    legalStatus: service.organization_legal_status ?? '',
  };
  draft.service = {
    name: service.service_name,
    description: service.service_description ?? '',
    url: service.service_url ?? '',
    email: service.service_email ?? '',
    applicationProcess: service.application_process ?? '',
    fees: service.fees ?? '',
    waitTime: service.wait_time ?? '',
    interpretationServices: service.interpretation_services ?? '',
    accreditations: service.accreditations ?? '',
    licenses: service.licenses ?? '',
    phones: [],
  };

  const [servicePhones, taxonomyTerms, serviceLanguages, eligibilityRows, requiredDocuments, serviceAreas, locationRows] = await Promise.all([
    executeQuery<{ number: string; extension: string | null; type: string | null; description: string | null }>(
      `SELECT number, extension, type, description
         FROM phones
        WHERE service_id = $1
        ORDER BY created_at ASC`,
      [serviceId],
    ),
    executeQuery<{ term: string }>(
      `SELECT tt.term
         FROM service_taxonomy st
         JOIN taxonomy_terms tt ON tt.id = st.taxonomy_term_id
        WHERE st.service_id = $1
        ORDER BY tt.term ASC`,
      [serviceId],
    ),
    executeQuery<{ language: string }>(
      `SELECT language
         FROM languages
        WHERE service_id = $1
        ORDER BY created_at ASC`,
      [serviceId],
    ),
    executeQuery<{ description: string | null; minimum_age: number | null; maximum_age: number | null }>(
      `SELECT description, minimum_age, maximum_age
         FROM eligibility
        WHERE service_id = $1
        ORDER BY created_at ASC
        LIMIT 1`,
      [serviceId],
    ),
    executeQuery<{ document: string }>(
      `SELECT document
         FROM required_documents
        WHERE service_id = $1
        ORDER BY created_at ASC`,
      [serviceId],
    ),
    executeQuery<{ name: string | null }>(
      `SELECT name
         FROM service_areas
        WHERE service_id = $1
        ORDER BY created_at ASC`,
      [serviceId],
    ),
    executeQuery<{
      id: string;
      name: string | null;
      description: string | null;
      transportation: string | null;
      latitude: number | null;
      longitude: number | null;
      address_1: string | null;
      address_2: string | null;
      city: string | null;
      region: string | null;
      state_province: string | null;
      postal_code: string | null;
      country: string | null;
    }>(
      `SELECT l.id,
              l.name,
              l.description,
              l.transportation,
              l.latitude,
              l.longitude,
              a.address_1,
              a.address_2,
              a.city,
              a.region,
              a.state_province,
              a.postal_code,
              a.country
         FROM service_at_location sal
         JOIN locations l ON l.id = sal.location_id
         LEFT JOIN addresses a ON a.location_id = l.id
        WHERE sal.service_id = $1
        ORDER BY l.created_at ASC`,
      [serviceId],
    ),
  ]);

  draft.service.phones = servicePhones.map((phone) => ({
    number: phone.number,
    extension: phone.extension ?? '',
    type: phone.type === 'sms' ? 'text' : (phone.type as 'voice' | 'fax' | 'text' | 'hotline' | 'tty' | null) ?? 'voice',
    description: phone.description ?? '',
  }));

  draft.taxonomy.categories = taxonomyTerms.map((entry) => entry.term);
  draft.access.languages = serviceLanguages.map((entry) => entry.language);
  draft.access.eligibilityDescription = eligibilityRows[0]?.description ?? '';
  draft.access.minimumAge = eligibilityRows[0]?.minimum_age !== null && eligibilityRows[0]?.minimum_age !== undefined
    ? String(eligibilityRows[0].minimum_age)
    : '';
  draft.access.maximumAge = eligibilityRows[0]?.maximum_age !== null && eligibilityRows[0]?.maximum_age !== undefined
    ? String(eligibilityRows[0].maximum_age)
    : '';
  draft.access.requiredDocuments = requiredDocuments.map((entry) => entry.document);
  draft.access.serviceAreas = serviceAreas.map((entry) => entry.name ?? '').filter(Boolean);

  draft.locations = [];
  for (const location of locationRows) {
    const [locationPhones, locationSchedules, locationLanguages, accessibilityRows] = await Promise.all([
      executeQuery<{ number: string; extension: string | null; type: string | null; description: string | null }>(
        `SELECT number, extension, type, description
           FROM phones
          WHERE location_id = $1
          ORDER BY created_at ASC`,
        [location.id],
      ),
      executeQuery<{ days: string[] | null; opens_at: string | null; closes_at: string | null }>(
        `SELECT days, opens_at, closes_at
           FROM schedules
          WHERE location_id = $1
          ORDER BY created_at ASC`,
        [location.id],
      ),
      executeQuery<{ language: string }>(
        `SELECT language
           FROM languages
          WHERE location_id = $1
          ORDER BY created_at ASC`,
        [location.id],
      ),
      executeQuery<{ accessibility: string }>(
        `SELECT accessibility
           FROM accessibility_for_disabilities
          WHERE location_id = $1
          ORDER BY created_at ASC`,
        [location.id],
      ),
    ]);

    const schedule = buildSeedWeek();
    for (const entry of locationSchedules) {
      for (const rawDay of readStringArray(entry.days)) {
        const day = mapStoredWeekday(rawDay);
        if (!day) continue;
        const current = schedule.find((item) => item.day === day);
        if (!current) continue;
        current.closed = false;
        current.opens = entry.opens_at ?? current.opens;
        current.closes = entry.closes_at ?? current.closes;
      }
    }

    draft.locations.push({
      id: location.id,
      name: location.name ?? '',
      description: location.description ?? '',
      transportation: location.transportation ?? '',
      address1: location.address_1 ?? '',
      address2: location.address_2 ?? '',
      city: location.city ?? '',
      region: location.region ?? '',
      stateProvince: location.state_province ?? '',
      postalCode: location.postal_code ?? '',
      country: location.country ?? 'US',
      latitude: location.latitude !== null && location.latitude !== undefined ? String(location.latitude) : '',
      longitude: location.longitude !== null && location.longitude !== undefined ? String(location.longitude) : '',
      phones: locationPhones.map((phone) => ({
        number: phone.number,
        extension: phone.extension ?? '',
        type: phone.type === 'sms' ? 'text' : (phone.type as 'voice' | 'fax' | 'text' | 'hotline' | 'tty' | null) ?? 'voice',
        description: phone.description ?? '',
      })),
      languages: locationLanguages.map((entry) => entry.language),
      accessibility: accessibilityRows.map((entry) => entry.accessibility),
      schedule,
    });
  }

  if (draft.locations.length === 0) {
    draft.locations = createEmptyResourceSubmissionDraft('listing', channel).locations;
  }

  return draft;
}

export async function seedResourceSubmissionDraftFromOrganization(
  organizationId: string,
  channel: ResourceSubmissionChannel = 'host',
): Promise<ResourceSubmissionDraft> {
  const draft = createEmptyResourceSubmissionDraft('listing', channel);
  draft.ownerOrganizationId = organizationId;

  const organizationRows = await executeQuery<{
    name: string;
    description: string | null;
    url: string | null;
    email: string | null;
    phone: string | null;
    tax_status: string | null;
    tax_id: string | null;
    year_incorporated: number | null;
    legal_status: string | null;
  }>(
    `SELECT name,
            description,
            url,
            email,
            phone,
            tax_status,
            tax_id,
            year_incorporated,
            legal_status
       FROM organizations
      WHERE id = $1
      LIMIT 1`,
    [organizationId],
  );

  const organization = organizationRows[0];
  if (!organization) {
    return draft;
  }

  draft.organization = {
    name: organization.name,
    description: organization.description ?? '',
    url: organization.url ?? '',
    email: organization.email ?? '',
    phone: organization.phone ?? '',
    taxStatus: organization.tax_status ?? '',
    taxId: organization.tax_id ?? '',
    yearIncorporated: organization.year_incorporated ? String(organization.year_incorporated) : '',
    legalStatus: organization.legal_status ?? '',
  };

  return draft;
}

export async function createResourceSubmission(input: CreateResourceSubmissionInput): Promise<ResourceSubmissionDetail> {
  const template = await ensureResourceSubmissionTemplate(input.variant, input.channel, input.submittedByUserId);
  const draft = input.draft === undefined
    ? input.existingServiceId
      ? await seedResourceSubmissionDraftFromService(input.existingServiceId, input.channel)
      : input.ownerOrganizationId
        ? await seedResourceSubmissionDraftFromOrganization(input.ownerOrganizationId, input.channel)
        : normalizeResourceSubmissionDraft(input.draft, input.variant, input.channel)
    : normalizeResourceSubmissionDraft(input.draft, input.variant, input.channel);
  const completion = computeResourceSubmissionCards(draft);
  const ownerOrganizationId = input.ownerOrganizationId ?? draft.ownerOrganizationId ?? null;
  const existingServiceId = input.existingServiceId ?? draft.existingServiceId ?? null;
  const instance = await createFormInstance({
    template,
    submittedByUserId: input.submittedByUserId,
    ownerOrganizationId,
    title: input.title ?? resolveSubmissionTitle(draft),
    notes: input.notes ?? draft.evidence.notes ?? null,
    formData: {
      draft,
      cards: completion,
    },
    submissionType: input.variant === 'claim'
      ? 'org_claim'
      : existingServiceId
        ? 'service_verification'
        : 'new_service',
    targetType: resolveSubmissionTargetType(input.variant, existingServiceId, ownerOrganizationId),
    targetId: existingServiceId ?? ownerOrganizationId ?? null,
    serviceId: existingServiceId,
    payload: {
      variant: input.variant,
      channel: input.channel,
      ownerOrganizationId,
      existingServiceId,
      readyForSubmit: isResourceSubmissionComplete(draft),
    },
  });

  return buildResourceSubmissionDetail(instance);
}

export async function saveResourceSubmissionDraft(
  instanceId: string,
  input: UpdateResourceSubmissionDraftInput,
): Promise<void> {
  const current = await executeQuery<{ form_data: Record<string, unknown> }>(
    `SELECT form_data FROM form_instances WHERE id = $1`,
    [instanceId],
  );
  const currentDraft = normalizeResourceSubmissionDraft(current[0]?.form_data ? readObject(current[0].form_data).draft : undefined, 'listing', 'host');
  const nextDraft = input.draft === undefined
    ? currentDraft
    : normalizeResourceSubmissionDraft(input.draft, currentDraft.variant, currentDraft.channel);

  await updateFormInstanceDraft(instanceId, {
    title: input.title,
    notes: input.notes ?? nextDraft.evidence.notes,
    formData: {
      draft: nextDraft,
      cards: computeResourceSubmissionCards(nextDraft),
    },
  });
}

export async function submitResourceSubmission(
  instanceId: string,
  actorUserId: string,
  actorRole: string | null,
): Promise<void> {
  await withTransaction(async (client) => {
    const rows = await client.query<{
      submission_id: string;
      form_data: Record<string, unknown>;
      template_slug: string;
      submission_type: string;
    }>(
      `SELECT fi.submission_id,
              fi.form_data,
              ft.slug AS template_slug,
              s.submission_type
         FROM form_instances fi
         JOIN form_templates ft ON ft.id = fi.template_id
         JOIN submissions s ON s.id = fi.submission_id
        WHERE fi.id = $1
        FOR UPDATE`,
      [instanceId],
    );

    const row = rows.rows[0];
    if (!row) return;
    const draft = normalizeResourceSubmissionDraft(readObject(row.form_data).draft, row.template_slug.includes('claim') ? 'claim' : 'listing', row.template_slug.includes('public') ? 'public' : 'host');
    const sourceRecordId = await attachSourceAssertion(
      client,
      row.submission_id,
      draft.variant,
      draft.channel,
      actorUserId,
      actorRole,
      draft,
    );

    await updateSubmissionPayload(client, row.submission_id, {
      sourceRecordId,
      readyForSubmit: isResourceSubmissionComplete(draft),
      variant: draft.variant,
      channel: draft.channel,
    });
  });
}

async function ensureTaxonomyTermId(
  client: PoolClient,
  term: string,
  actorUserId: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id
       FROM taxonomy_terms
      WHERE lower(term) = lower($1)
      ORDER BY created_at ASC
      LIMIT 1`,
    [term],
  );
  if (existing.rows[0]?.id) {
    return existing.rows[0].id;
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO taxonomy_terms (term, taxonomy, created_by_user_id, updated_by_user_id)
     VALUES ($1, 'custom', $2, $2)
     RETURNING id`,
    [term, actorUserId],
  );
  return created.rows[0].id;
}

async function upsertOrganizationFromDraft(
  client: PoolClient,
  draft: ResourceSubmissionDraft,
  actorUserId: string,
): Promise<string> {
  if (draft.ownerOrganizationId) {
    await client.query(
      `UPDATE organizations
          SET name = COALESCE(NULLIF($2, ''), name),
              description = COALESCE(NULLIF($3, ''), description),
              url = COALESCE(NULLIF($4, ''), url),
              email = COALESCE(NULLIF($5, ''), email),
              phone = COALESCE(NULLIF($6, ''), phone),
              tax_status = COALESCE(NULLIF($7, ''), tax_status),
              tax_id = COALESCE(NULLIF($8, ''), tax_id),
              year_incorporated = COALESCE(NULLIF($9, '')::int, year_incorporated),
              legal_status = COALESCE(NULLIF($10, ''), legal_status),
              updated_by_user_id = $1,
              updated_at = NOW()
        WHERE id = $11`,
      [
        actorUserId,
        draft.organization.name,
        draft.organization.description,
        draft.organization.url,
        draft.organization.email,
        draft.organization.phone,
        draft.organization.taxStatus,
        draft.organization.taxId,
        draft.organization.yearIncorporated,
        draft.organization.legalStatus,
        draft.ownerOrganizationId,
      ],
    );
    return draft.ownerOrganizationId;
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO organizations
       (name, description, url, email, phone, tax_status, tax_id, year_incorporated, legal_status, status, created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, '')::int, $9, 'active', $10, $10)
     RETURNING id`,
    [
      draft.organization.name || draft.service.name || 'Untitled organization',
      draft.organization.description || null,
      draft.organization.url || null,
      draft.organization.email || null,
      draft.organization.phone || null,
      draft.organization.taxStatus || null,
      draft.organization.taxId || null,
      draft.organization.yearIncorporated || '',
      draft.organization.legalStatus || null,
      actorUserId,
    ],
  );

  return created.rows[0].id;
}

async function replaceServiceBundleFromDraft(
  client: PoolClient,
  organizationId: string,
  draft: ResourceSubmissionDraft,
  actorUserId: string,
): Promise<string> {
  let serviceId = draft.existingServiceId;

  if (serviceId) {
    await client.query(
      `UPDATE services
          SET organization_id = $1,
              name = $2,
              description = $3,
              url = $4,
              email = $5,
              interpretation_services = $6,
              application_process = $7,
              wait_time = $8,
              fees = $9,
              accreditations = $10,
              licenses = $11,
              status = 'active',
              updated_by_user_id = $12,
              updated_at = NOW()
        WHERE id = $13`,
      [
        organizationId,
        draft.service.name || 'Untitled service',
        draft.service.description || null,
        draft.service.url || null,
        draft.service.email || null,
        draft.service.interpretationServices || null,
        draft.service.applicationProcess || null,
        draft.service.waitTime || null,
        draft.service.fees || null,
        draft.service.accreditations || null,
        draft.service.licenses || null,
        actorUserId,
        serviceId,
      ],
    );
  } else {
    const created = await client.query<{ id: string }>(
      `INSERT INTO services
         (organization_id, name, description, url, email, interpretation_services,
          application_process, wait_time, fees, accreditations, licenses, status, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12, $12)
       RETURNING id`,
      [
        organizationId,
        draft.service.name || 'Untitled service',
        draft.service.description || null,
        draft.service.url || null,
        draft.service.email || null,
        draft.service.interpretationServices || null,
        draft.service.applicationProcess || null,
        draft.service.waitTime || null,
        draft.service.fees || null,
        draft.service.accreditations || null,
        draft.service.licenses || null,
        actorUserId,
      ],
    );
    serviceId = created.rows[0].id;
  }

  await client.query(`DELETE FROM phones WHERE service_id = $1`, [serviceId]);
  for (const phone of draft.service.phones) {
    if (!phone.number.trim()) continue;
    await client.query(
      `INSERT INTO phones
         (service_id, number, extension, type, description, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [
        serviceId,
        phone.number.trim(),
        phone.extension.trim() || null,
        phone.type === 'text' ? 'sms' : phone.type,
        phone.description.trim() || null,
        actorUserId,
      ],
    );
  }

  await client.query(`DELETE FROM service_taxonomy WHERE service_id = $1`, [serviceId]);
  for (const term of [...draft.taxonomy.categories, ...draft.taxonomy.customTerms]) {
    const taxonomyTermId = await ensureTaxonomyTermId(client, term, actorUserId);
    await client.query(
      `INSERT INTO service_taxonomy (service_id, taxonomy_term_id, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (service_id, taxonomy_term_id) DO NOTHING`,
      [serviceId, taxonomyTermId, actorUserId],
    );
  }

  await client.query(`DELETE FROM languages WHERE service_id = $1`, [serviceId]);
  for (const language of draft.access.languages) {
    if (!language.trim()) continue;
    await client.query(
      `INSERT INTO languages (service_id, language, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $3)`,
      [serviceId, language.trim(), actorUserId],
    );
  }

  await client.query(`DELETE FROM eligibility WHERE service_id = $1`, [serviceId]);
  if (draft.access.eligibilityDescription.trim()) {
    await client.query(
      `INSERT INTO eligibility
         (service_id, description, minimum_age, maximum_age, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, NULLIF($3, '')::int, NULLIF($4, '')::int, $5, $5)`,
      [
        serviceId,
        draft.access.eligibilityDescription.trim(),
        draft.access.minimumAge.trim(),
        draft.access.maximumAge.trim(),
        actorUserId,
      ],
    );
  }

  await client.query(`DELETE FROM required_documents WHERE service_id = $1`, [serviceId]);
  for (const document of draft.access.requiredDocuments) {
    if (!document.trim()) continue;
    await client.query(
      `INSERT INTO required_documents (service_id, document, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $3)`,
      [serviceId, document.trim(), actorUserId],
    );
  }

  await client.query(`DELETE FROM service_areas WHERE service_id = $1`, [serviceId]);
  for (const area of draft.access.serviceAreas) {
    if (!area.trim()) continue;
    await client.query(
      `INSERT INTO service_areas (service_id, name, description, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $2, $3, $3)`,
      [serviceId, area.trim(), actorUserId],
    );
  }

  const existingLocationRows = await client.query<{ location_id: string }>(
    `SELECT location_id FROM service_at_location WHERE service_id = $1`,
    [serviceId],
  );
  const existingLocationIds = existingLocationRows.rows.map((row) => row.location_id);

  await client.query(`DELETE FROM service_at_location WHERE service_id = $1`, [serviceId]);
  if (existingLocationIds.length > 0) {
    await client.query(`DELETE FROM locations WHERE id = ANY($1::uuid[])`, [existingLocationIds]);
  }

  for (const location of draft.locations) {
    if (!location.name.trim() && !location.address1.trim() && !location.city.trim()) {
      continue;
    }

    const locationRows = await client.query<{ id: string }>(
      `INSERT INTO locations
         (organization_id, name, description, transportation, latitude, longitude, status, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, NULLIF($5, '')::double precision, NULLIF($6, '')::double precision, 'active', $7, $7)
       RETURNING id`,
      [
        organizationId,
        location.name.trim() || null,
        location.description.trim() || null,
        location.transportation.trim() || null,
        location.latitude.trim(),
        location.longitude.trim(),
        actorUserId,
      ],
    );
    const locationId = locationRows.rows[0].id;

    await client.query(
      `INSERT INTO service_at_location (service_id, location_id, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $3)`,
      [serviceId, locationId, actorUserId],
    );

    await client.query(
      `INSERT INTO addresses
         (location_id, address_1, address_2, city, region, state_province, postal_code, country, created_by_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        locationId,
        location.address1.trim() || null,
        location.address2.trim() || null,
        location.city.trim() || null,
        location.region.trim() || null,
        location.stateProvince.trim() || null,
        location.postalCode.trim() || null,
        location.country.trim() || 'US',
        actorUserId,
      ],
    );

    for (const phone of location.phones) {
      if (!phone.number.trim()) continue;
      await client.query(
        `INSERT INTO phones
           (location_id, number, extension, type, description, created_by_user_id, updated_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [
          locationId,
          phone.number.trim(),
          phone.extension.trim() || null,
          phone.type === 'text' ? 'sms' : phone.type,
          phone.description.trim() || null,
          actorUserId,
        ],
      );
    }

    for (const schedule of location.schedule) {
      if (schedule.closed) continue;
      await client.query(
        `INSERT INTO schedules
           (location_id, days, opens_at, closes_at, created_by_user_id, updated_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [locationId, [schedule.day], schedule.opens, schedule.closes, actorUserId],
      );
    }

    for (const language of location.languages) {
      if (!language.trim()) continue;
      await client.query(
        `INSERT INTO languages (location_id, language, created_by_user_id, updated_by_user_id)
         VALUES ($1, $2, $3, $3)`,
        [locationId, language.trim(), actorUserId],
      );
    }

    for (const accessibility of location.accessibility) {
      if (!accessibility.trim()) continue;
      await client.query(
        `INSERT INTO accessibility_for_disabilities
           (location_id, accessibility, created_by_user_id, updated_by_user_id)
         VALUES ($1, $2, $3, $3)`,
        [locationId, accessibility.trim(), actorUserId],
      );
    }
  }

  return serviceId;
}

export async function projectApprovedResourceSubmission(
  identifier: string,
  actorUserId: string,
): Promise<{ organizationId: string | null; serviceId: string | null }> {
  return withTransaction(async (client) => {
    const resolvedId = await resolveResourceInstanceId(identifier);
    if (!resolvedId) {
      return { organizationId: null, serviceId: null };
    }

    const rows = await client.query<{
      submission_id: string;
      submission_type: string;
      target_type: string;
      target_id: string | null;
      submitted_by_user_id: string;
      form_data: Record<string, unknown>;
    }>(
      `SELECT fi.submission_id,
              s.submission_type,
              s.target_type,
              s.target_id,
              s.submitted_by_user_id,
              fi.form_data
         FROM form_instances fi
         JOIN submissions s ON s.id = fi.submission_id
        WHERE fi.id = $1
        FOR UPDATE`,
      [resolvedId],
    );
    const row = rows.rows[0];
    if (!row) {
      return { organizationId: null, serviceId: null };
    }

    const draft = normalizeResourceSubmissionDraft(readObject(row.form_data).draft, 'listing', 'host');

    if (draft.variant === 'claim' || row.submission_type === 'org_claim') {
      const organizationId = await upsertOrganizationFromDraft(client, draft, actorUserId);
      await client.query(
        `INSERT INTO organization_members
           (organization_id, user_id, role, status, invited_by_user_id, activated_at, created_by_user_id, updated_by_user_id)
         VALUES ($1, $2, 'host_admin', 'active', $3, NOW(), $3, $3)
         ON CONFLICT (organization_id, user_id)
         DO UPDATE SET role = 'host_admin', status = 'active', activated_at = NOW(), updated_at = NOW(), updated_by_user_id = $3`,
        [organizationId, row.submitted_by_user_id, actorUserId],
      );
      await client.query(
        `UPDATE user_profiles
            SET role = CASE
                         WHEN role IN ('seeker', 'host_member') THEN 'host_admin'
                         ELSE role
                       END,
                updated_at = NOW()
          WHERE user_id = $1`,
        [row.submitted_by_user_id],
      );
      await client.query(
        `INSERT INTO user_profiles (user_id, role)
         VALUES ($1, 'host_admin')
         ON CONFLICT (user_id) DO NOTHING`,
        [row.submitted_by_user_id],
      );
      await client.query(
        `UPDATE submissions
            SET target_type = 'organization',
                target_id = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [organizationId, row.submission_id],
      );

      const projectionSourceRecordId = await attachApprovedProjectionAssertion(
        client,
        row.submission_id,
        draft.variant,
        draft.channel,
        actorUserId,
        draft,
        {
          organizationId,
          serviceId: null,
          targetType: 'organization',
          submissionType: row.submission_type,
        },
      );
      await updateSubmissionPayload(client, row.submission_id, {
        projectionSourceRecordId,
        projectedOrganizationId: organizationId,
        projectedServiceId: null,
      });

      return { organizationId, serviceId: null };
    }

    const organizationId = await upsertOrganizationFromDraft(client, draft, actorUserId);
    const serviceId = await replaceServiceBundleFromDraft(client, organizationId, draft, actorUserId);
    await client.query(
      `UPDATE submissions
          SET target_type = 'service',
              target_id = $1,
              service_id = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [serviceId, row.submission_id],
    );

    const projectionSourceRecordId = await attachApprovedProjectionAssertion(
      client,
      row.submission_id,
      draft.variant,
      draft.channel,
      actorUserId,
      draft,
      {
        organizationId,
        serviceId,
        targetType: 'service',
        submissionType: row.submission_type,
      },
    );
    await updateSubmissionPayload(client, row.submission_id, {
      projectionSourceRecordId,
      projectedOrganizationId: organizationId,
      projectedServiceId: serviceId,
    });

    return { organizationId, serviceId };
  });
}

export async function getAccessibleResourceSubmission(
  authCtx: AuthContext,
  identifier: string,
): Promise<FormInstance | null> {
  const resolvedId = await resolveResourceInstanceId(identifier);
  if (!resolvedId) {
    return null;
  }

  const instance = await getAccessibleFormInstance(authCtx, resolvedId);
  if (!instance || !instance.template_slug.startsWith('resource-')) {
    return null;
  }
  return instance;
}

export async function listAccessibleResourceSubmissions(
  authCtx: AuthContext,
): Promise<FormInstance[]> {
  const { instances } = await listAccessibleFormInstances(authCtx, { limit: 100 });
  return instances.filter((instance) => instance.template_slug.startsWith('resource-'));
}

export async function getResourceSubmissionDetailForActor(
  authCtx: AuthContext,
  identifier: string,
): Promise<ResourceSubmissionDetail | null> {
  const instance = await getAccessibleResourceSubmission(authCtx, identifier);
  if (!instance) return null;

  return buildResourceSubmissionDetail(instance);
}

export async function getResourceSubmissionDetailForPublic(
  identifier: string,
  accessToken: string,
): Promise<ResourceSubmissionDetail | null> {
  const instance = await getResourceSubmissionInstanceForPublic(identifier, accessToken);
  if (!instance) {
    return null;
  }

  return buildResourceSubmissionDetail(instance);
}

export async function setResourceSubmissionReviewerNotes(
  submissionId: string,
  reviewerNotes: string | null,
): Promise<void> {
  await setFormSubmissionReviewerNotes(submissionId, reviewerNotes);
}

export function isResourceSubmissionStatusEditable(status: SubmissionStatus): boolean {
  return status === 'draft' || status === 'returned';
}
