import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
  executeQuery: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

const guardMocks = vi.hoisted(() => ({
  requireMinRole: vi.fn(),
  requireOrgAccess: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const vaultMocks = vi.hoisted(() => ({
  listAccessibleFormInstances: vi.fn(),
  getFormTemplateById: vi.fn(),
  createFormInstance: vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => guardMocks);
vi.mock('@/services/security/rateLimit', () => ({
  checkRateLimit: rateLimitMock,
}));
vi.mock('@/services/telemetry/sentry', () => ({
  captureException: captureExceptionMock,
}));
vi.mock('@/services/forms/vault', () => vaultMocks);

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const INSTANCE_ID = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444';

async function loadRoute() {
  return import('../route');
}

function createGetRequest(url = 'http://localhost/api/forms/instances?status=draft&limit=10') {
  return {
    headers: new Headers(),
    nextUrl: new URL(url),
  } as never;
}

function createPostRequest(body: unknown) {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
  } as never;
}

function makeTemplate(overrides: Record<string, unknown> = {}) {
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
    template_description: 'Collect host intake details.',
    template_category: 'operations',
    template_default_target_role: 'community_admin',
    template_schema_json: { routing: { defaultPriority: 1, slaReviewHours: 48 } },
    template_version: 1,
    storage_scope: 'organization',
    owner_organization_id: ORGANIZATION_ID,
    coverage_zone_id: null,
    recipient_role: 'community_admin',
    recipient_user_id: null,
    recipient_organization_id: null,
    blob_storage_prefix: 'forms/organization/demo',
    form_data: { summary: 'Need approval.' },
    attachment_manifest: [],
    last_saved_at: '2026-03-08T00:00:00.000Z',
    submission_type: 'managed_form',
    status: 'draft',
    target_type: 'form_template',
    target_id: TEMPLATE_ID,
    submitted_by_user_id: 'user-1',
    assigned_to_user_id: null,
    title: 'Host intake',
    notes: null,
    reviewer_notes: null,
    priority: 1,
    sla_deadline: '2026-03-10T00:00:00.000Z',
    sla_breached: false,
    submitted_at: '2026-03-08T01:00:00.000Z',
    reviewed_at: null,
    resolved_at: null,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  dbMocks.executeQuery.mockResolvedValue([]);
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'user-1',
    role: 'host_admin',
    orgIds: [ORGANIZATION_ID],
    orgRoles: new Map([[ORGANIZATION_ID, 'host_admin']]),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  guardMocks.requireOrgAccess.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  vaultMocks.listAccessibleFormInstances.mockResolvedValue({
    instances: [makeInstance()],
    total: 1,
  });
  vaultMocks.getFormTemplateById.mockResolvedValue(makeTemplate());
  vaultMocks.createFormInstance.mockResolvedValue(makeInstance());
});

describe('GET /api/forms/instances', () => {
  it('lists accessible instances for the caller', async () => {
    const { GET } = await loadRoute();
    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    expect(vaultMocks.listAccessibleFormInstances).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', role: 'host_admin' }),
      expect.objectContaining({ status: 'draft', limit: 10 }),
    );
  });
});

describe('POST /api/forms/instances', () => {
  it('rejects organization scopes outside the caller access', async () => {
    guardMocks.requireOrgAccess.mockReturnValueOnce(false);

    const { POST } = await loadRoute();
    const response = await POST(
      createPostRequest({
        templateId: TEMPLATE_ID,
        ownerOrganizationId: ORGANIZATION_ID,
        formData: {},
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Access denied to organization scope' });
  });

  it('returns not found when the requested template is not visible', async () => {
    vaultMocks.getFormTemplateById.mockResolvedValueOnce(null);

    const { POST } = await loadRoute();
    const response = await POST(
      createPostRequest({
        templateId: TEMPLATE_ID,
        ownerOrganizationId: ORGANIZATION_ID,
        formData: {},
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Template not found' });
  });

  it('rejects community-scoped templates without a coverage zone anchor', async () => {
    vaultMocks.getFormTemplateById.mockResolvedValueOnce(makeTemplate({ storage_scope: 'community' }));

    const { POST } = await loadRoute();
    const response = await POST(
      createPostRequest({
        templateId: TEMPLATE_ID,
        formData: {},
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Community-scoped templates require a coverage zone',
    });
  });

  it('rejects inactive coverage zones for community-scoped templates', async () => {
    vaultMocks.getFormTemplateById.mockResolvedValueOnce(makeTemplate({ storage_scope: 'community' }));
    dbMocks.executeQuery.mockResolvedValueOnce([]);

    const { POST } = await loadRoute();
    const response = await POST(
      createPostRequest({
        templateId: TEMPLATE_ID,
        coverageZoneId: '55555555-5555-4555-8555-555555555555',
        formData: {},
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Coverage zone not found or inactive' });
  });

  it('creates a managed-form instance with the resolved template and caller id', async () => {
    const { POST } = await loadRoute();
    const response = await POST(
      createPostRequest({
        templateId: TEMPLATE_ID,
        ownerOrganizationId: ORGANIZATION_ID,
        recipientRole: 'community_admin',
        title: 'Host intake',
        notes: 'Needs review',
        formData: { summary: 'Need approval.' },
        attachmentManifest: [],
      }),
    );

    expect(response.status).toBe(201);
    expect(dbMocks.executeQuery).not.toHaveBeenCalled();
    expect(vaultMocks.createFormInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        template: expect.objectContaining({ id: TEMPLATE_ID }),
        submittedByUserId: 'user-1',
        ownerOrganizationId: ORGANIZATION_ID,
        recipientRole: 'community_admin',
      }),
    );
  });
});
