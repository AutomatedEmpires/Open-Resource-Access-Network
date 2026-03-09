import type { AuthContext } from '@/services/auth/session';
import { executeQuery, withTransaction } from '@/services/db/postgres';
import { buildCommunitySubmissionScope, getCommunityAdminScope } from '@/services/community/scope';
import type {
  FormInstance,
  FormRecipientRole,
  FormStorageScope,
  FormTemplate,
  FormTemplateAudience,
} from '@/domain/forms';
import { extractRoutingConfig } from '@/domain/forms';
import type { SubmissionPriority, SubmissionTargetType, SubmissionType } from '@/domain/types';

export interface ListFormTemplatesOptions {
  visibleAudiences: FormTemplateAudience[];
  category?: string;
  search?: string;
  includeUnpublished?: boolean;
  limit?: number;
  offset?: number;
}

export interface CreateFormTemplateInput {
  slug: string;
  title: string;
  description?: string | null;
  category?: string;
  audience_scope: FormTemplateAudience;
  storage_scope?: FormStorageScope;
  default_target_role?: FormRecipientRole | null;
  schema_json?: Record<string, unknown>;
  ui_schema_json?: Record<string, unknown>;
  instructions_markdown?: string | null;
  is_published?: boolean;
  blob_storage_prefix?: string | null;
  created_by_user_id?: string | null;
}

export interface UpdateFormTemplateInput {
  title?: string;
  description?: string | null;
  category?: string;
  audience_scope?: FormTemplateAudience;
  storage_scope?: FormStorageScope;
  default_target_role?: FormRecipientRole | null;
  schema_json?: Record<string, unknown>;
  ui_schema_json?: Record<string, unknown>;
  instructions_markdown?: string | null;
  is_published?: boolean;
  blob_storage_prefix?: string | null;
  updated_by_user_id: string;
}

export interface ListFormInstancesOptions {
  status?: string;
  templateId?: string;
  limit?: number;
  offset?: number;
}

export interface CreateFormInstanceInput {
  template: FormTemplate;
  submittedByUserId: string;
  ownerOrganizationId?: string | null;
  coverageZoneId?: string | null;
  recipientRole?: FormRecipientRole | null;
  recipientUserId?: string | null;
  recipientOrganizationId?: string | null;
  title?: string | null;
  notes?: string | null;
  formData?: Record<string, unknown>;
  attachmentManifest?: unknown[];
  submissionType?: SubmissionType;
  targetType?: SubmissionTargetType;
  targetId?: string | null;
  serviceId?: string | null;
  payload?: Record<string, unknown>;
  evidence?: unknown[];
  priority?: SubmissionPriority;
}

export interface UpdateFormInstanceDraftInput {
  title?: string | null;
  notes?: string | null;
  formData?: Record<string, unknown>;
  attachmentManifest?: unknown[];
  recipientRole?: FormRecipientRole | null;
  recipientUserId?: string | null;
  recipientOrganizationId?: string | null;
}

export interface UpdateFormSubmissionOperationalInput {
  priority?: SubmissionPriority;
  assignedToUserId?: string | null;
  slaDeadline?: string | null;
  slaBreached?: boolean;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildBlobStoragePrefix(
  storageScope: FormStorageScope,
  templateId: string,
  submissionId: string,
  ownerOrganizationId?: string | null,
  coverageZoneId?: string | null,
): string {
  switch (storageScope) {
    case 'organization':
      return `forms/organization/${ownerOrganizationId ?? 'unassigned'}/${templateId}/${submissionId}`;
    case 'community':
      return `forms/community/${coverageZoneId ?? 'unassigned'}/${templateId}/${submissionId}`;
    default:
      return `forms/platform/${templateId}/${submissionId}`;
  }
}

async function buildInstanceAccessWhere(ctx: AuthContext, params: unknown[]): Promise<string> {
  if (ctx.role === 'oran_admin') {
    return 'TRUE';
  }

  const clauses: string[] = [];

  params.push(ctx.userId);
  const userIdx = params.length;
  clauses.push(`s.submitted_by_user_id = $${userIdx}`);
  clauses.push(`fi.recipient_user_id = $${userIdx}`);
  clauses.push(`s.assigned_to_user_id = $${userIdx}`);

  if (ctx.role === 'community_admin') {
    const scope = await getCommunityAdminScope(ctx.userId);
    const scopeWhere = buildCommunitySubmissionScope('s', scope, params);
    if (scopeWhere) {
      clauses.push(`(fi.recipient_role = 'community_admin' AND ${scopeWhere})`);
    } else {
      clauses.push(`fi.recipient_role = 'community_admin'`);
    }
  }

  if (ctx.orgIds.length > 0) {
    params.push(ctx.orgIds);
    const orgIdx = params.length;
    clauses.push(`fi.owner_organization_id = ANY($${orgIdx}::uuid[])`);
    clauses.push(`fi.recipient_organization_id = ANY($${orgIdx}::uuid[])`);
  }

  return clauses.length > 0 ? `(${clauses.join(' OR ')})` : 'FALSE';
}

const INSTANCE_SELECT = `SELECT fi.id,
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
       s.is_locked,
       s.locked_at,
       s.locked_by_user_id,
       s.created_at,
       s.updated_at
  FROM form_instances fi
  JOIN form_templates ft ON ft.id = fi.template_id
  JOIN submissions s ON s.id = fi.submission_id`;

export async function listFormTemplates(
  opts: ListFormTemplatesOptions,
): Promise<{ templates: FormTemplate[]; total: number }> {
  const {
    visibleAudiences,
    category,
    search,
    includeUnpublished = false,
    limit = 50,
    offset = 0,
  } = opts;

  if (visibleAudiences.length === 0) {
    return { templates: [], total: 0 };
  }

  const params: unknown[] = [visibleAudiences];
  const clauses = ['audience_scope = ANY($1::text[])'];

  if (!includeUnpublished) {
    clauses.push('is_published = true');
  }

  if (category) {
    params.push(category);
    clauses.push(`category = $${params.length}`);
  }

  if (search) {
    params.push(`%${search}%`);
    clauses.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length} OR slug ILIKE $${params.length})`);
  }

  const where = clauses.join(' AND ');
  const countRows = await executeQuery<{ count: string }>(
    `SELECT COUNT(*) AS count FROM form_templates WHERE ${where}`,
    params,
  );
  const total = Number.parseInt(countRows[0]?.count ?? '0', 10);

  params.push(limit, offset);
  const templates = await executeQuery<FormTemplate>(
    `SELECT * FROM form_templates
     WHERE ${where}
     ORDER BY updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { templates, total };
}

export async function getFormTemplateById(
  id: string,
  visibleAudiences: FormTemplateAudience[],
  includeUnpublished = false,
): Promise<FormTemplate | null> {
  if (visibleAudiences.length === 0) {
    return null;
  }

  const params: unknown[] = [id, visibleAudiences];
  const clauses = ['id = $1', 'audience_scope = ANY($2::text[])'];
  if (!includeUnpublished) {
    clauses.push('is_published = true');
  }

  const rows = await executeQuery<FormTemplate>(
    `SELECT * FROM form_templates WHERE ${clauses.join(' AND ')}`,
    params,
  );

  return rows[0] ?? null;
}

export async function createFormTemplate(input: CreateFormTemplateInput): Promise<FormTemplate> {
  const rows = await executeQuery<FormTemplate>(
    `INSERT INTO form_templates
       (slug, title, description, category, audience_scope, storage_scope,
        default_target_role, schema_json, ui_schema_json, instructions_markdown,
        is_published, blob_storage_prefix, created_by_user_id, updated_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11, $12, $13, $13)
     RETURNING *`,
    [
      input.slug,
      input.title,
      input.description ?? null,
      input.category ?? 'general',
      input.audience_scope,
      input.storage_scope ?? 'platform',
      input.default_target_role ?? null,
      JSON.stringify(input.schema_json ?? {}),
      JSON.stringify(input.ui_schema_json ?? {}),
      input.instructions_markdown ?? null,
      input.is_published ?? false,
      input.blob_storage_prefix ?? null,
      input.created_by_user_id ?? null,
    ],
  );

  return rows[0]!;
}

export async function listAccessibleFormInstances(
  ctx: AuthContext,
  opts: ListFormInstancesOptions = {},
): Promise<{ instances: FormInstance[]; total: number }> {
  const params: unknown[] = [];
  const clauses = [await buildInstanceAccessWhere(ctx, params)];

  if (opts.status) {
    params.push(opts.status);
    clauses.push(`s.status = $${params.length}`);
  }

  if (opts.templateId) {
    params.push(opts.templateId);
    clauses.push(`fi.template_id = $${params.length}`);
  }

  const where = clauses.join(' AND ');
  const countRows = await executeQuery<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM form_instances fi
       JOIN submissions s ON s.id = fi.submission_id
      WHERE ${where}`,
    params,
  );
  const total = Number.parseInt(countRows[0]?.count ?? '0', 10);

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  params.push(limit, offset);

  const instances = await executeQuery<FormInstance>(
    `${INSTANCE_SELECT}
     WHERE ${where}
     ORDER BY s.priority DESC,
              s.sla_breached DESC,
              s.sla_deadline ASC NULLS LAST,
              s.updated_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { instances, total };
}

export async function getAccessibleFormInstance(
  ctx: AuthContext,
  id: string,
): Promise<FormInstance | null> {
  const params: unknown[] = [];
  const accessWhere = await buildInstanceAccessWhere(ctx, params);
  params.push(id);

  const rows = await executeQuery<FormInstance>(
    `${INSTANCE_SELECT}
     WHERE ${accessWhere}
       AND fi.id = $${params.length}`,
    params,
  );

  return rows[0] ?? null;
}

export async function createFormInstance(input: CreateFormInstanceInput): Promise<FormInstance> {
  return withTransaction(async (client) => {
    if (input.template.storage_scope === 'organization' && !input.ownerOrganizationId) {
      throw new Error('Organization-scoped templates require an owning organization');
    }

    if (input.template.storage_scope === 'community' && !input.coverageZoneId) {
      throw new Error('Community-scoped templates require a coverage zone');
    }

    const routing = extractRoutingConfig(readObject(input.template.schema_json), input.template);
    const recipientRole = input.recipientRole ?? routing.defaultRecipientRole ?? input.template.default_target_role ?? null;
    const recipientUserId = input.recipientUserId ?? routing.autoAssignUserId ?? null;
    const priority = input.priority ?? routing.defaultPriority ?? 0;
    const submissionType = input.submissionType ?? routing.submissionType ?? 'managed_form';
    const targetType = input.targetType ?? routing.targetType ?? 'form_template';
    const targetId = input.targetId ?? (targetType === 'form_template' ? input.template.id : null);

    const submissionRows = await client.query<{ id: string }>(
      `INSERT INTO submissions
         (submission_type, status, target_type, target_id, submitted_by_user_id,
          assigned_to_user_id, title, notes, payload, evidence, priority, service_id)
       VALUES ($1, 'draft', $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
       RETURNING id`,
      [
        submissionType,
        targetType,
        targetId,
        input.submittedByUserId,
        recipientUserId,
        input.title ?? input.template.title,
        input.notes ?? null,
        JSON.stringify({
          template_id: input.template.id,
          template_version: input.template.version,
          storage_scope: input.template.storage_scope,
          routing,
          ...readObject(input.payload),
        }),
        JSON.stringify(input.evidence ?? []),
        priority,
        input.serviceId ?? null,
      ],
    );

    const submissionId = submissionRows.rows[0]!.id;
    const blobStoragePrefix = buildBlobStoragePrefix(
      input.template.storage_scope,
      input.template.id,
      submissionId,
      input.ownerOrganizationId,
      input.coverageZoneId,
    );

    await client.query(
      `INSERT INTO form_instances
         (submission_id, template_id, template_version, storage_scope,
          owner_organization_id, coverage_zone_id, recipient_role, recipient_user_id,
          recipient_organization_id, blob_storage_prefix, form_data, attachment_manifest)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb)`,
      [
        submissionId,
        input.template.id,
        input.template.version,
        input.template.storage_scope,
        input.ownerOrganizationId ?? null,
        input.coverageZoneId ?? null,
        recipientRole,
        recipientUserId,
        input.recipientOrganizationId ?? null,
        blobStoragePrefix,
        JSON.stringify(input.formData ?? {}),
        JSON.stringify(input.attachmentManifest ?? []),
      ],
    );

    const result = await client.query<FormInstance>(
      `${INSTANCE_SELECT}
       WHERE s.id = $1`,
      [submissionId],
    );

    return result.rows[0]!;
  });
}

export async function updateFormInstanceDraft(
  id: string,
  input: UpdateFormInstanceDraftInput,
): Promise<void> {
  await withTransaction(async (client) => {
    const formSetClauses: string[] = ['last_saved_at = NOW()', 'updated_at = NOW()'];
    const formParams: unknown[] = [];

    if (input.formData !== undefined) {
      formParams.push(JSON.stringify(input.formData));
      formSetClauses.push(`form_data = $${formParams.length}::jsonb`);
    }

    if (input.attachmentManifest !== undefined) {
      formParams.push(JSON.stringify(input.attachmentManifest));
      formSetClauses.push(`attachment_manifest = $${formParams.length}::jsonb`);
    }

    if (input.recipientRole !== undefined) {
      formParams.push(input.recipientRole);
      formSetClauses.push(`recipient_role = $${formParams.length}`);
    }

    if (input.recipientUserId !== undefined) {
      formParams.push(input.recipientUserId);
      formSetClauses.push(`recipient_user_id = $${formParams.length}`);
    }

    if (input.recipientOrganizationId !== undefined) {
      formParams.push(input.recipientOrganizationId);
      formSetClauses.push(`recipient_organization_id = $${formParams.length}`);
    }

    formParams.push(id);
    await client.query(
      `UPDATE form_instances
          SET ${formSetClauses.join(', ')}
        WHERE id = $${formParams.length}`,
      formParams,
    );

    const submissionSetClauses: string[] = ['updated_at = NOW()'];
    const submissionParams: unknown[] = [];

    if (input.title !== undefined) {
      submissionParams.push(input.title);
      submissionSetClauses.push(`title = $${submissionParams.length}`);
    }

    if (input.notes !== undefined) {
      submissionParams.push(input.notes);
      submissionSetClauses.push(`notes = $${submissionParams.length}`);
    }

    if (input.recipientUserId !== undefined) {
      submissionParams.push(input.recipientUserId);
      submissionSetClauses.push(`assigned_to_user_id = $${submissionParams.length}`);
    }

    submissionParams.push(id);
    await client.query(
      `UPDATE submissions
          SET ${submissionSetClauses.join(', ')}
        WHERE id = (SELECT submission_id FROM form_instances WHERE id = $${submissionParams.length})`,
      submissionParams,
    );
  });
}

export async function setFormSubmissionReviewerNotes(
  submissionId: string,
  reviewerNotes: string | null,
): Promise<void> {
  await executeQuery(
    `UPDATE submissions
        SET reviewer_notes = $1,
            updated_at = NOW()
      WHERE id = $2`,
    [reviewerNotes, submissionId],
  );
}

export async function updateFormSubmissionOperationalMetadata(
  submissionId: string,
  input: UpdateFormSubmissionOperationalInput,
): Promise<void> {
  const clauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];

  if (input.priority !== undefined) {
    params.push(input.priority);
    clauses.push(`priority = $${params.length}`);
  }

  if (input.assignedToUserId !== undefined) {
    params.push(input.assignedToUserId);
    clauses.push(`assigned_to_user_id = $${params.length}`);
  }

  if (input.slaDeadline !== undefined) {
    params.push(input.slaDeadline);
    clauses.push(`sla_deadline = $${params.length}`);
  }

  if (input.slaBreached !== undefined) {
    params.push(input.slaBreached);
    clauses.push(`sla_breached = $${params.length}`);
  }

  params.push(submissionId);

  await executeQuery(
    `UPDATE submissions
        SET ${clauses.join(', ')}
      WHERE id = $${params.length}`,
    params,
  );
}

// ── Analytics ─────────────────────────────────────────────

interface AnalyticsRow {
  status: string;
  count: string;
}
interface TimingRow {
  avg_review_hours: string | null;
  avg_resolve_hours: string | null;
  sla_compliance_rate: string | null;
  overdue_count: string;
}

export async function getFormAnalytics(
  ctx: AuthContext,
  templateId?: string,
): Promise<import('@/domain/forms').FormAnalytics> {
  const whereFragments: string[] = [`fi.id IS NOT NULL`];
  const params: unknown[] = [];

  if (templateId) {
    params.push(templateId);
    whereFragments.push(`fi.template_id = $${params.length}`);
  }

  // Scope to accessible submissions
  const accessWhere = await buildInstanceAccessWhere(ctx, params);
  whereFragments.push(accessWhere);

  const where = whereFragments.join(' AND ');

  const statusRows = await executeQuery<AnalyticsRow>(
    `SELECT s.status, COUNT(*)::text AS count
       FROM form_instances fi
       JOIN submissions s ON s.id = fi.submission_id
      WHERE ${where}
      GROUP BY s.status`,
    params,
  );

  const byStatus: Record<string, number> = {};
  let totalInstances = 0;
  for (const row of statusRows) {
    const n = parseInt(row.count, 10);
    byStatus[row.status] = n;
    totalInstances += n;
  }

  // Timing + SLA metrics (use same params base — re-bind template/access)
  const timingParams: unknown[] = [];
  const timingFragments: string[] = [`fi.id IS NOT NULL`];
  if (templateId) {
    timingParams.push(templateId);
    timingFragments.push(`fi.template_id = $${timingParams.length}`);
  }
  const timingAccess = await buildInstanceAccessWhere(ctx, timingParams);
  timingFragments.push(timingAccess);
  const tw = timingFragments.join(' AND ');

  const timingRows = await executeQuery<TimingRow>(
    `SELECT
       ROUND(AVG(EXTRACT(EPOCH FROM (s.reviewed_at - s.submitted_at)) / 3600)::numeric, 1)::text AS avg_review_hours,
       ROUND(AVG(EXTRACT(EPOCH FROM (s.resolved_at - s.submitted_at)) / 3600)::numeric, 1)::text AS avg_resolve_hours,
       CASE WHEN COUNT(*) FILTER (WHERE s.sla_deadline IS NOT NULL) = 0 THEN NULL
            ELSE ROUND(
              COUNT(*) FILTER (WHERE s.sla_breached = false AND s.sla_deadline IS NOT NULL)::numeric /
              NULLIF(COUNT(*) FILTER (WHERE s.sla_deadline IS NOT NULL), 0), 3
            )::text
       END AS sla_compliance_rate,
       COUNT(*) FILTER (WHERE s.sla_breached = true)::text AS overdue_count
     FROM form_instances fi
     JOIN submissions s ON s.id = fi.submission_id
    WHERE ${tw}`,
    timingParams,
  );

  const timing = timingRows[0];

  return {
    totalInstances,
    byStatus,
    avgTimeToReview: timing?.avg_review_hours ? parseFloat(timing.avg_review_hours) : null,
    avgTimeToResolve: timing?.avg_resolve_hours ? parseFloat(timing.avg_resolve_hours) : null,
    slaComplianceRate: timing?.sla_compliance_rate ? parseFloat(timing.sla_compliance_rate) : null,
    overdueCount: timing?.overdue_count ? parseInt(timing.overdue_count, 10) : 0,
  };
}

// ── Template Duplication ──────────────────────────────────

export async function duplicateFormTemplate(
  sourceId: string,
  newSlug: string,
  createdByUserId: string,
): Promise<FormTemplate> {
  const [source] = await executeQuery<FormTemplate>(
    `SELECT * FROM form_templates WHERE id = $1`,
    [sourceId],
  );
  if (!source) {
    throw new Error('Source template not found.');
  }

  const result = await executeQuery<FormTemplate>(
    `INSERT INTO form_templates (
       slug, title, description, category, audience_scope, storage_scope,
       default_target_role, schema_json, ui_schema_json,
       instructions_markdown, is_published, blob_storage_prefix,
       created_by_user_id, version
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11, $12, 1
     ) RETURNING *`,
    [
      newSlug,
      `${source.title} (copy)`,
      source.description,
      source.category,
      source.audience_scope,
      source.storage_scope,
      source.default_target_role,
      JSON.stringify(source.schema_json),
      JSON.stringify(source.ui_schema_json),
      source.instructions_markdown,
      source.blob_storage_prefix,
      createdByUserId,
    ],
  );
  return result[0];
}

// ── Template Update ───────────────────────────────────────

export async function updateFormTemplate(
  id: string,
  input: UpdateFormTemplateInput,
): Promise<FormTemplate | null> {
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: unknown[] = [];

  if (input.title !== undefined) {
    params.push(input.title);
    setClauses.push(`title = $${params.length}`);
  }
  if (input.description !== undefined) {
    params.push(input.description);
    setClauses.push(`description = $${params.length}`);
  }
  if (input.category !== undefined) {
    params.push(input.category);
    setClauses.push(`category = $${params.length}`);
  }
  if (input.audience_scope !== undefined) {
    params.push(input.audience_scope);
    setClauses.push(`audience_scope = $${params.length}`);
  }
  if (input.storage_scope !== undefined) {
    params.push(input.storage_scope);
    setClauses.push(`storage_scope = $${params.length}`);
  }
  if (input.default_target_role !== undefined) {
    params.push(input.default_target_role);
    setClauses.push(`default_target_role = $${params.length}`);
  }
  if (input.schema_json !== undefined) {
    params.push(JSON.stringify(input.schema_json));
    setClauses.push(`schema_json = $${params.length}::jsonb`);
    // Bump version when schema changes
    setClauses.push(`version = version + 1`);
  }
  if (input.ui_schema_json !== undefined) {
    params.push(JSON.stringify(input.ui_schema_json));
    setClauses.push(`ui_schema_json = $${params.length}::jsonb`);
  }
  if (input.instructions_markdown !== undefined) {
    params.push(input.instructions_markdown);
    setClauses.push(`instructions_markdown = $${params.length}`);
  }
  if (input.is_published !== undefined) {
    params.push(input.is_published);
    setClauses.push(`is_published = $${params.length}`);
  }
  if (input.blob_storage_prefix !== undefined) {
    params.push(input.blob_storage_prefix);
    setClauses.push(`blob_storage_prefix = $${params.length}`);
  }

  params.push(input.updated_by_user_id);
  setClauses.push(`updated_by_user_id = $${params.length}`);

  params.push(id);
  const rows = await executeQuery<FormTemplate>(
    `UPDATE form_templates
        SET ${setClauses.join(', ')}
      WHERE id = $${params.length}
      RETURNING *`,
    params,
  );

  return rows[0] ?? null;
}

// ── Bulk Instance Status ──────────────────────────────────

export interface BulkActionResult {
  id: string;
  success: boolean;
  error?: string;
}

export async function bulkUpdateInstanceStatus(
  ctx: AuthContext,
  instanceIds: string[],
  action: 'approve' | 'deny' | 'return',
  reviewerNotes: string | null,
): Promise<BulkActionResult[]> {
  const { advance } = await import('@/services/workflow/engine');

  const statusMap = {
    approve: 'approved',
    deny: 'denied',
    return: 'returned',
  } as const;

  const results: BulkActionResult[] = [];

  for (const id of instanceIds) {
    try {
      const instance = await getAccessibleFormInstance(ctx, id);
      if (!instance) {
        results.push({ id, success: false, error: 'Not found or not accessible' });
        continue;
      }

      if (!['needs_review', 'under_review'].includes(instance.status)) {
        results.push({ id, success: false, error: `Cannot ${action} form in status "${instance.status}"` });
        continue;
      }

      if (reviewerNotes) {
        await setFormSubmissionReviewerNotes(instance.submission_id, reviewerNotes);
      }

      const transition = await advance({
        submissionId: instance.submission_id,
        toStatus: statusMap[action],
        actorUserId: ctx.userId,
        actorRole: ctx.role,
        reason: reviewerNotes ?? `Bulk ${action}`,
        metadata: { form_instance_id: id, bulk: true },
      });

      if (transition.success) {
        results.push({ id, success: true });
      } else {
        results.push({ id, success: false, error: transition.error ?? `Transition to ${statusMap[action]} failed` });
      }
    } catch (err) {
      results.push({ id, success: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  return results;
}

export async function deleteFormTemplate(
  id: string,
): Promise<{ deleted: boolean; reason?: string }> {
  const countRows = await executeQuery<{ count: string }>(
    `SELECT COUNT(*)::TEXT AS count FROM form_instances WHERE template_id = $1`,
    [id],
  );
  const instanceCount = Number.parseInt(countRows[0]?.count ?? '0', 10);

  if (instanceCount > 0) {
    return {
      deleted: false,
      reason: `Template has ${instanceCount} instance${instanceCount === 1 ? '' : 's'}. Unpublish it instead or archive all instances first.`,
    };
  }

  const result = await executeQuery<{ id: string }>(
    `DELETE FROM form_templates WHERE id = $1 RETURNING id`,
    [id],
  );

  if (result.length === 0) {
    return { deleted: false, reason: 'Template not found' };
  }

  return { deleted: true };
}
