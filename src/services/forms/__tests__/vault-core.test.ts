import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormTemplate } from '@/domain/forms';
import type { OranRole } from '@/domain/types';

/* ──────────────────────────────────────────────────────
   Hoisted mocks
   ────────────────────────────────────────────────────── */

const dbMocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  withTransaction: vi.fn(),
}));

const communityMocks = vi.hoisted(() => ({
  getCommunityAdminScope: vi.fn(),
  buildCommunitySubmissionScope: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/community/scope', () => communityMocks);

/* ──────────────────────────────────────────────────────
   Helpers
   ────────────────────────────────────────────────────── */

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const INSTANCE_ID = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';

function makeAuthCtx(role: OranRole = 'oran_admin', userId = 'user-admin-1') {
  return {
    userId,
    role,
    accountStatus: 'active' as const,
    orgIds: [] as string[],
    orgRoles: new Map<string, 'host_member' | 'host_admin'>(),
  };
}

function makeTemplate(overrides: Record<string, unknown> = {}): FormTemplate {
  return {
    id: TEMPLATE_ID,
    slug: 'host-intake',
    title: 'Host intake',
    description: 'Collect host intake details.',
    category: 'operations',
    audience_scope: 'host_member',
    storage_scope: 'organization',
    default_target_role: 'community_admin',
    schema_json: { fields: [{ key: 'summary', label: 'Summary', type: 'textarea' }] },
    ui_schema_json: {},
    instructions_markdown: 'Complete the intake details.',
    version: 1,
    is_published: true,
    blob_storage_prefix: null,
    created_by_user_id: 'user-1',
    updated_by_user_id: 'user-1',
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

function makeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTANCE_ID,
    submission_id: SUBMISSION_ID,
    template_id: TEMPLATE_ID,
    template_slug: 'host-intake',
    template_title: 'Host intake',
    template_description: null,
    template_category: 'operations',
    template_version: 1,
    storage_scope: 'organization',
    owner_organization_id: null,
    coverage_zone_id: null,
    recipient_role: 'community_admin',
    recipient_user_id: null,
    recipient_organization_id: null,
    blob_storage_prefix: 'forms/platform/template-1/sub-1',
    form_data: {},
    attachment_manifest: [],
    last_saved_at: '2026-03-09T00:00:00.000Z',
    submission_type: 'managed_form',
    status: 'draft',
    target_type: 'form_template',
    target_id: TEMPLATE_ID,
    submitted_by_user_id: 'user-submitter',
    assigned_to_user_id: null,
    title: 'Test form',
    notes: null,
    reviewer_notes: null,
    priority: 0,
    sla_deadline: null,
    sla_breached: false,
    submitted_at: null,
    reviewed_at: null,
    resolved_at: null,
    created_at: '2026-03-09T00:00:00.000Z',
    updated_at: '2026-03-09T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  communityMocks.getCommunityAdminScope.mockResolvedValue({ zoneIds: [] });
  communityMocks.buildCommunitySubmissionScope.mockReturnValue('');
});

async function loadVault() {
  return import('../vault');
}

/* ──────────────────────────────────────────────────────
   createFormTemplate
   ────────────────────────────────────────────────────── */

describe('createFormTemplate', () => {
  it('inserts a template and returns it', async () => {
    const template = makeTemplate();
    dbMocks.executeQuery.mockResolvedValueOnce([template]);

    const { createFormTemplate } = await loadVault();
    const result = await createFormTemplate({
      slug: 'host-intake',
      title: 'Host intake',
      description: 'Collect host intake details.',
      audience_scope: 'host_member',
      storage_scope: 'organization',
      schema_json: { fields: [{ key: 'summary', label: 'Summary', type: 'textarea' }] },
      created_by_user_id: 'user-1',
    });

    expect(result.slug).toBe('host-intake');
    expect(result.audience_scope).toBe('host_member');
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1);
    const [sql] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO form_templates');
    expect(sql).toContain('RETURNING *');
  });

  it('uses defaults for optional fields', async () => {
    const template = makeTemplate({ category: 'general', storage_scope: 'platform', is_published: false });
    dbMocks.executeQuery.mockResolvedValueOnce([template]);

    const { createFormTemplate } = await loadVault();
    const result = await createFormTemplate({
      slug: 'basic-form',
      title: 'Basic',
      audience_scope: 'shared',
    });

    expect(result).toBeDefined();
    const [, params] = dbMocks.executeQuery.mock.calls[0];
    expect(params).toContain('general'); // default category
    expect(params).toContain('platform'); // default storage_scope
    expect(params).toContain(false); // default is_published
  });

  it('stringifies schema_json and ui_schema_json', async () => {
    const schema = { fields: [{ key: 'a', label: 'A', type: 'text' }] };
    const uiSchema = { layout: 'horizontal' };
    dbMocks.executeQuery.mockResolvedValueOnce([makeTemplate()]);

    const { createFormTemplate } = await loadVault();
    await createFormTemplate({
      slug: 'test',
      title: 'Test',
      audience_scope: 'shared',
      schema_json: schema,
      ui_schema_json: uiSchema,
    });

    const [, params] = dbMocks.executeQuery.mock.calls[0];
    expect(params).toContain(JSON.stringify(schema));
    expect(params).toContain(JSON.stringify(uiSchema));
  });
});

/* ──────────────────────────────────────────────────────
   getFormTemplateById
   ────────────────────────────────────────────────────── */

describe('getFormTemplateById', () => {
  it('returns template when found', async () => {
    const template = makeTemplate();
    dbMocks.executeQuery.mockResolvedValueOnce([template]);

    const { getFormTemplateById } = await loadVault();
    const result = await getFormTemplateById(TEMPLATE_ID, ['host_member', 'shared']);

    expect(result).toEqual(template);
    const [sql, params] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('id = $1');
    expect(params).toContain(TEMPLATE_ID);
  });

  it('returns null when not found', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { getFormTemplateById } = await loadVault();
    const result = await getFormTemplateById(TEMPLATE_ID, ['shared']);

    expect(result).toBeNull();
  });

  it('returns null when visible audiences is empty', async () => {
    const { getFormTemplateById } = await loadVault();
    const result = await getFormTemplateById(TEMPLATE_ID, []);

    expect(result).toBeNull();
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
  });

  it('filters unpublished by default', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([makeTemplate({ is_published: true })]);

    const { getFormTemplateById } = await loadVault();
    await getFormTemplateById(TEMPLATE_ID, ['shared']);

    const [sql] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('is_published = true');
  });

  it('includes unpublished when flag is set', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([makeTemplate({ is_published: false })]);

    const { getFormTemplateById } = await loadVault();
    await getFormTemplateById(TEMPLATE_ID, ['shared'], true);

    const [sql] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).not.toContain('is_published = true');
  });
});

/* ──────────────────────────────────────────────────────
   listAccessibleFormInstances
   ────────────────────────────────────────────────────── */

describe('listAccessibleFormInstances', () => {
  it('returns paginated instances for oran_admin', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: '2' }])
      .mockResolvedValueOnce([makeInstance(), makeInstance({ id: '44444444-4444-4444-8444-444444444444' })]);

    const { listAccessibleFormInstances } = await loadVault();
    const result = await listAccessibleFormInstances(makeAuthCtx());

    expect(result.total).toBe(2);
    expect(result.instances).toHaveLength(2);
  });

  it('filters by status when specified', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([makeInstance({ status: 'submitted' })]);

    const { listAccessibleFormInstances } = await loadVault();
    const result = await listAccessibleFormInstances(makeAuthCtx(), { status: 'submitted' });

    expect(result.total).toBe(1);
    const [countSql, countParams] = dbMocks.executeQuery.mock.calls[0];
    expect(countSql).toContain('s.status');
    expect(countParams).toContain('submitted');
  });

  it('filters by templateId when specified', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: '1' }])
      .mockResolvedValueOnce([makeInstance()]);

    const { listAccessibleFormInstances } = await loadVault();
    await listAccessibleFormInstances(makeAuthCtx(), { templateId: TEMPLATE_ID });

    const [, countParams] = dbMocks.executeQuery.mock.calls[0];
    expect(countParams).toContain(TEMPLATE_ID);
  });

  it('applies limit and offset', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: '100' }])
      .mockResolvedValueOnce([makeInstance()]);

    const { listAccessibleFormInstances } = await loadVault();
    const result = await listAccessibleFormInstances(makeAuthCtx(), { limit: 10, offset: 20 });

    expect(result.total).toBe(100);
    const [, queryParams] = dbMocks.executeQuery.mock.calls[1];
    expect(queryParams).toContain(10);
    expect(queryParams).toContain(20);
  });

  it('scopes access for community_admin', async () => {
    communityMocks.getCommunityAdminScope.mockResolvedValue({ zoneIds: ['zone-1'] });
    communityMocks.buildCommunitySubmissionScope.mockReturnValue(`s.coverage_zone_id = ANY($2::uuid[])`);

    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: '3' }])
      .mockResolvedValueOnce([makeInstance()]);

    const { listAccessibleFormInstances } = await loadVault();
    await listAccessibleFormInstances(makeAuthCtx('community_admin', 'ca-user'));

    expect(communityMocks.getCommunityAdminScope).toHaveBeenCalledWith('ca-user');
  });

  it('returns empty when no results', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: '0' }])
      .mockResolvedValueOnce([]);

    const { listAccessibleFormInstances } = await loadVault();
    const result = await listAccessibleFormInstances(makeAuthCtx());

    expect(result.total).toBe(0);
    expect(result.instances).toHaveLength(0);
  });
});

describe('createFormInstance', () => {
  it('rejects explicit recipient targets without a recipient role', async () => {
    dbMocks.withTransaction.mockImplementation(async (callback) => {
      const query = vi.fn();
      return callback({ query });
    });

    const { createFormInstance } = await loadVault();

    await expect(
      createFormInstance({
        template: makeTemplate(),
        submittedByUserId: 'user-1',
        ownerOrganizationId: 'org-1',
        recipientUserId: 'reviewer-1',
        formData: {},
      }),
    ).rejects.toThrow('Recipient role is required when routing to a specific user or organization');
  });
});

/* ──────────────────────────────────────────────────────
   getAccessibleFormInstance
   ────────────────────────────────────────────────────── */

describe('getAccessibleFormInstance', () => {
  it('returns instance when found', async () => {
    const instance = makeInstance();
    dbMocks.executeQuery.mockResolvedValueOnce([instance]);

    const { getAccessibleFormInstance } = await loadVault();
    const result = await getAccessibleFormInstance(makeAuthCtx(), INSTANCE_ID);

    expect(result).toEqual(instance);
    const [, params] = dbMocks.executeQuery.mock.calls[0];
    expect(params).toContain(INSTANCE_ID);
  });

  it('returns null when not found', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { getAccessibleFormInstance } = await loadVault();
    const result = await getAccessibleFormInstance(makeAuthCtx(), INSTANCE_ID);

    expect(result).toBeNull();
  });

  it('applies access scope for non-admin roles', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([makeInstance()]);

    const ctx = makeAuthCtx('host_member', 'host-user-1');
    const { getAccessibleFormInstance } = await loadVault();
    await getAccessibleFormInstance(ctx, INSTANCE_ID);

    const [sql] = dbMocks.executeQuery.mock.calls[0];
    // host_member sees submitted_by, recipient, or org-scoped
    expect(sql).toContain('submitted_by_user_id');
  });
});

/* ──────────────────────────────────────────────────────
   createFormInstance
   ────────────────────────────────────────────────────── */

describe('createFormInstance', () => {
  const mockClient = {
    query: vi.fn(),
  };

  beforeEach(() => {
    mockClient.query.mockReset();
    dbMocks.withTransaction.mockImplementation(async (fn: (client: typeof mockClient) => Promise<unknown>) => fn(mockClient));
  });

  it('creates submission and form_instances records', async () => {
    const template = makeTemplate();
    const instanceResult = makeInstance();

    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing draft lookup
      .mockResolvedValueOnce({ rows: [{ id: SUBMISSION_ID }] }) // INSERT submission
      .mockResolvedValueOnce({ rows: [] }) // INSERT form_instance
      .mockResolvedValueOnce({ rows: [instanceResult] }); // SELECT joined

    const { createFormInstance } = await loadVault();
    const result = await createFormInstance({
      template: template as import('@/domain/forms').FormTemplate,
      submittedByUserId: 'user-1',
      ownerOrganizationId: 'org-1',
      title: 'Test form',
    });

    expect(result).toEqual({ instance: instanceResult, reusedExistingDraft: false });
    expect(mockClient.query).toHaveBeenCalledTimes(5);

    const [lockSql] = mockClient.query.mock.calls[0];
    expect(lockSql).toContain('pg_advisory_xact_lock');

    const [lookupSql] = mockClient.query.mock.calls[1];
    expect(lookupSql).toContain("WHERE s.status = 'draft'");

    // Third call: INSERT submissions
    const [subSql] = mockClient.query.mock.calls[2];
    expect(subSql).toContain('INSERT INTO submissions');

    // Fourth call: INSERT form_instances
    const [fiSql] = mockClient.query.mock.calls[3];
    expect(fiSql).toContain('INSERT INTO form_instances');
  });

  it('reuses an existing matching draft when the same create request is retried', async () => {
    const template = makeTemplate();
    const existingInstance = makeInstance({ title: 'Retried draft' });

    mockClient.query
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [existingInstance] }); // existing draft lookup

    const { createFormInstance } = await loadVault();
    const result = await createFormInstance({
      template: template as import('@/domain/forms').FormTemplate,
      submittedByUserId: 'user-1',
      ownerOrganizationId: 'org-1',
      title: 'Retried draft',
      formData: {},
      attachmentManifest: [],
    });

    expect(result).toEqual({ instance: existingInstance, reusedExistingDraft: true });
    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });

  it('throws when organization-scoped template has no owner org', async () => {
    const template = makeTemplate({ storage_scope: 'organization' });

    const { createFormInstance } = await loadVault();
    await expect(
      createFormInstance({
        template: template as import('@/domain/forms').FormTemplate,
        submittedByUserId: 'user-1',
      }),
    ).rejects.toThrow('Organization-scoped templates require an owning organization');
  });

  it('throws when community-scoped template has no coverage zone', async () => {
    const template = makeTemplate({ storage_scope: 'community' });

    const { createFormInstance } = await loadVault();
    await expect(
      createFormInstance({
        template: template as import('@/domain/forms').FormTemplate,
        submittedByUserId: 'user-1',
      }),
    ).rejects.toThrow('Community-scoped templates require a coverage zone');
  });

  it('extracts default priority from routing config', async () => {
    const template = makeTemplate({
      schema_json: {
        fields: [],
        routing: { defaultPriority: 2 },
      },
    });
    const instanceResult = makeInstance({ priority: 2 });

    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SUBMISSION_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [instanceResult] });

    const { createFormInstance } = await loadVault();
    await createFormInstance({
      template: template as import('@/domain/forms').FormTemplate,
      submittedByUserId: 'user-1',
      ownerOrganizationId: 'org-1',
    });

    const [, subParams] = mockClient.query.mock.calls[2];
    expect(subParams).toContain(2); // routing.defaultPriority
  });

  it('allows overriding priority in input', async () => {
    const template = makeTemplate({ schema_json: { fields: [] } });
    const instanceResult = makeInstance({ priority: 3 });

    mockClient.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: SUBMISSION_ID }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [instanceResult] });

    const { createFormInstance } = await loadVault();
    await createFormInstance({
      template: template as import('@/domain/forms').FormTemplate,
      submittedByUserId: 'user-1',
      ownerOrganizationId: 'org-1',
      priority: 3,
    });

    const [, subParams] = mockClient.query.mock.calls[2];
    expect(subParams).toContain(3);
  });
});

/* ──────────────────────────────────────────────────────
   updateFormSubmissionOperationalMetadata
   ────────────────────────────────────────────────────── */

describe('updateFormSubmissionOperationalMetadata', () => {
  it('updates priority', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { updateFormSubmissionOperationalMetadata } = await loadVault();
    await updateFormSubmissionOperationalMetadata(SUBMISSION_ID, { priority: 2 });

    const [sql, params] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('priority');
    expect(params).toContain(2);
    expect(params).toContain(SUBMISSION_ID);
  });

  it('updates SLA deadline', async () => {
    const deadline = '2026-04-01T12:00:00.000Z';
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { updateFormSubmissionOperationalMetadata } = await loadVault();
    await updateFormSubmissionOperationalMetadata(SUBMISSION_ID, { slaDeadline: deadline });

    const [sql, params] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('sla_deadline');
    expect(params).toContain(deadline);
  });

  it('updates assigned user', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { updateFormSubmissionOperationalMetadata } = await loadVault();
    await updateFormSubmissionOperationalMetadata(SUBMISSION_ID, { assignedToUserId: 'reviewer-1' });

    const [sql, params] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('assigned_to_user_id');
    expect(params).toContain('reviewer-1');
  });

  it('updates sla_breached flag', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { updateFormSubmissionOperationalMetadata } = await loadVault();
    await updateFormSubmissionOperationalMetadata(SUBMISSION_ID, { slaBreached: true });

    const [sql, params] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('sla_breached');
    expect(params).toContain(true);
  });

  it('updates multiple fields at once', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { updateFormSubmissionOperationalMetadata } = await loadVault();
    await updateFormSubmissionOperationalMetadata(SUBMISSION_ID, {
      priority: 3,
      slaDeadline: '2026-05-01T00:00:00.000Z',
      slaBreached: false,
    });

    const [sql, params] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('priority');
    expect(sql).toContain('sla_deadline');
    expect(sql).toContain('sla_breached');
    expect(params).toContain(3);
    expect(params).toContain(false);
  });

  it('always includes updated_at = NOW()', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { updateFormSubmissionOperationalMetadata } = await loadVault();
    await updateFormSubmissionOperationalMetadata(SUBMISSION_ID, { priority: 1 });

    const [sql] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('updated_at = NOW()');
  });
});

/* ──────────────────────────────────────────────────────
   deleteFormTemplate
   ────────────────────────────────────────────────────── */

describe('deleteFormTemplate', () => {
  it('deletes template with no instances', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: '0' }]) // count check
      .mockResolvedValueOnce([{ id: TEMPLATE_ID }]); // DELETE RETURNING

    const { deleteFormTemplate } = await loadVault();
    const result = await deleteFormTemplate(TEMPLATE_ID);

    expect(result.deleted).toBe(true);
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(2);
  });

  it('refuses to delete template with instances', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ count: '3' }]);

    const { deleteFormTemplate } = await loadVault();
    const result = await deleteFormTemplate(TEMPLATE_ID);

    expect(result.deleted).toBe(false);
    expect(result.reason).toContain('3 instances');
    expect(dbMocks.executeQuery).toHaveBeenCalledTimes(1); // only count, no DELETE
  });

  it('returns not found when template does not exist', async () => {
    dbMocks.executeQuery
      .mockResolvedValueOnce([{ count: '0' }]) // count
      .mockResolvedValueOnce([]); // DELETE returns nothing

    const { deleteFormTemplate } = await loadVault();
    const result = await deleteFormTemplate(TEMPLATE_ID);

    expect(result.deleted).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('handles single instance with correct grammar', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([{ count: '1' }]);

    const { deleteFormTemplate } = await loadVault();
    const result = await deleteFormTemplate(TEMPLATE_ID);

    expect(result.deleted).toBe(false);
    expect(result.reason).toContain('1 instance.');
    expect(result.reason).not.toContain('1 instances');
  });
});

/* ──────────────────────────────────────────────────────
   setFormSubmissionReviewerNotes
   ────────────────────────────────────────────────────── */

describe('setFormSubmissionReviewerNotes', () => {
  it('sets reviewer notes', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { setFormSubmissionReviewerNotes } = await loadVault();
    await setFormSubmissionReviewerNotes(SUBMISSION_ID, 'Looks good');

    const [sql, params] = dbMocks.executeQuery.mock.calls[0];
    expect(sql).toContain('reviewer_notes');
    expect(sql).toContain('updated_at = NOW()');
    expect(params).toContain('Looks good');
    expect(params).toContain(SUBMISSION_ID);
  });

  it('clears reviewer notes when null', async () => {
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { setFormSubmissionReviewerNotes } = await loadVault();
    await setFormSubmissionReviewerNotes(SUBMISSION_ID, null);

    const [, params] = dbMocks.executeQuery.mock.calls[0];
    expect(params).toContain(null);
  });
});
