import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  isDatabaseConfigured: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getAuthContext: vi.fn(),
}));

const guardMocks = vi.hoisted(() => ({
  requireMinRole: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => vi.fn());
const captureExceptionMock = vi.hoisted(() => vi.fn());
const vaultMocks = vi.hoisted(() => ({
  getAccessibleFormInstance: vi.fn(),
  setFormSubmissionReviewerNotes: vi.fn(),
  updateFormSubmissionOperationalMetadata: vi.fn(),
  updateFormInstanceDraft: vi.fn(),
}));
const workflowMocks = vi.hoisted(() => ({
  advance: vi.fn(),
  applySla: vi.fn(),
  assignSubmission: vi.fn(),
}));
const notificationMocks = vi.hoisted(() => ({
  send: vi.fn(),
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
vi.mock('@/services/workflow/engine', () => workflowMocks);
vi.mock('@/services/notifications/service', () => notificationMocks);

const INSTANCE_ID = '1f0e8400-e29b-41d4-a716-446655440001';
const SUBMISSION_ID = '2f0e8400-e29b-41d4-a716-446655440002';

async function loadRoute() {
  return import('../route');
}

function createRequest(body: unknown) {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
  } as never;
}

function createParams(id = INSTANCE_ID) {
  return { params: Promise.resolve({ id }) };
}

function makeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTANCE_ID,
    submission_id: SUBMISSION_ID,
    template_id: '3f0e8400-e29b-41d4-a716-446655440003',
    template_slug: 'host-intake',
    template_title: 'Host intake',
    template_description: null,
    template_category: 'operations',
    template_default_target_role: 'community_admin',
    template_schema_json: {},
    template_version: 1,
    storage_scope: 'platform',
    owner_organization_id: null,
    coverage_zone_id: null,
    recipient_role: 'community_admin',
    recipient_user_id: null,
    recipient_organization_id: null,
    blob_storage_prefix: null,
    form_data: {},
    attachment_manifest: [],
    last_saved_at: '2026-03-08T00:00:00.000Z',
    submission_type: 'managed_form',
    status: 'draft',
    target_type: 'form_template',
    target_id: null,
    submitted_by_user_id: 'user-1',
    assigned_to_user_id: null,
    title: 'Host intake',
    notes: null,
    reviewer_notes: null,
    priority: 0,
    sla_deadline: null,
    sla_breached: false,
    submitted_at: null,
    reviewed_at: null,
    resolved_at: null,
    created_at: '2026-03-08T00:00:00.000Z',
    updated_at: '2026-03-08T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'user-1',
    role: 'community_admin',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
});

describe('PUT /api/forms/instances/[id] — archive action', () => {
  it('archives an approved instance', async () => {
    const instance = makeInstance({ status: 'approved' });
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(instance);
    workflowMocks.advance.mockResolvedValue({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'approved',
      toStatus: 'archived',
      transitionId: 'tr-1',
      gateResults: [],
    });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(instance)
      .mockResolvedValueOnce({ ...instance, status: 'archived' });

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'archive' }), createParams());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.instance.status).toBe('archived');
    expect(workflowMocks.advance).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: SUBMISSION_ID,
        toStatus: 'archived',
      }),
    );
  });

  it('archives a denied instance', async () => {
    const instance = makeInstance({ status: 'denied' });
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(instance);
    workflowMocks.advance.mockResolvedValue({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'denied',
      toStatus: 'archived',
      transitionId: 'tr-2',
      gateResults: [],
    });

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'archive' }), createParams());

    expect(response.status).toBe(200);
  });

  it('archives a withdrawn instance', async () => {
    const instance = makeInstance({ status: 'withdrawn' });
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(instance);
    workflowMocks.advance.mockResolvedValue({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'withdrawn',
      toStatus: 'archived',
      transitionId: 'tr-3',
      gateResults: [],
    });

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'archive' }), createParams());

    expect(response.status).toBe(200);
  });

  it('rejects archiving a draft instance', async () => {
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance({ status: 'draft' }));

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'archive' }), createParams());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain('Cannot archive');
  });

  it('rejects archiving when under review', async () => {
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance({ status: 'under_review' }));

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'archive' }), createParams());

    expect(response.status).toBe(409);
  });

  it('returns 403 when caller lacks community_admin role for archive', async () => {
    guardMocks.requireMinRole.mockReset();
    guardMocks.requireMinRole.mockImplementation((_ctx: unknown, role: string) => {
      return role === 'host_member'; // host_member passes, community_admin fails
    });

    vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance({ status: 'approved' }));

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'archive' }), createParams());

    expect(response.status).toBe(403);
  });

  it('returns 409 when advance fails', async () => {
    guardMocks.requireMinRole.mockReturnValue(true);
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance({ status: 'approved' }));
    workflowMocks.advance.mockResolvedValue({
      success: false,
      error: 'Transition blocked',
    });

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'archive' }), createParams());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('Transition blocked');
  });
});

describe('PUT /api/forms/instances/[id] — withdraw action', () => {
  it('withdraws a draft instance', async () => {
    const instance = makeInstance({ status: 'draft' });
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(instance);
    workflowMocks.advance.mockResolvedValue({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'draft',
      toStatus: 'withdrawn',
      transitionId: 'tr-4',
      gateResults: [],
    });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(instance)
      .mockResolvedValueOnce({ ...instance, status: 'withdrawn' });

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'withdraw' }), createParams());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.instance.status).toBe('withdrawn');
    expect(workflowMocks.advance).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: SUBMISSION_ID,
        toStatus: 'withdrawn',
      }),
    );
  });

  it('withdraws a returned instance', async () => {
    const instance = makeInstance({ status: 'returned' });
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(instance);
    workflowMocks.advance.mockResolvedValue({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'returned',
      toStatus: 'withdrawn',
      transitionId: 'tr-5',
      gateResults: [],
    });

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'withdraw' }), createParams());

    expect(response.status).toBe(200);
  });

  it('rejects withdrawing an approved instance', async () => {
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance({ status: 'approved' }));

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'withdraw' }), createParams());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain('Cannot withdraw');
  });

  it('rejects withdrawing a submitted instance', async () => {
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance({ status: 'submitted' }));

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'withdraw' }), createParams());

    expect(response.status).toBe(409);
  });

  it('allows owner to withdraw their own form', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'user-1',
      role: 'host_member',
      orgIds: [],
      orgRoles: new Map(),
    });
    guardMocks.requireMinRole.mockReset();
    guardMocks.requireMinRole.mockImplementation((_ctx: unknown, role: string) => {
      return role === 'host_member'; // host_member passes, community_admin fails — but owner check short-circuits
    });

    const instance = makeInstance({ status: 'draft', submitted_by_user_id: 'user-1' });
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(instance);
    workflowMocks.advance.mockResolvedValue({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'draft',
      toStatus: 'withdrawn',
      transitionId: 'tr-6',
      gateResults: [],
    });

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'withdraw' }), createParams());

    expect(response.status).toBe(200);
  });

  it('rejects non-owner non-admin from withdrawing', async () => {
    authMocks.getAuthContext.mockResolvedValue({
      userId: 'other-user',
      role: 'host_member',
      orgIds: [],
      orgRoles: new Map(),
    });
    guardMocks.requireMinRole.mockReset();
    guardMocks.requireMinRole.mockImplementation((_ctx: unknown, role: string) => {
      return role === 'host_member';
    });

    const instance = makeInstance({ status: 'draft', submitted_by_user_id: 'user-1' });
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(instance);

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'withdraw' }), createParams());

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toContain('Only the submitter');
  });

  it('returns 409 when advance fails for withdraw', async () => {
    guardMocks.requireMinRole.mockReturnValue(true);
    const instance = makeInstance({ status: 'draft' });
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(instance);
    workflowMocks.advance.mockResolvedValue({
      success: false,
      error: 'Transition not allowed',
    });

    const { PUT } = await loadRoute();
    const response = await PUT(createRequest({ action: 'withdraw' }), createParams());

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe('Transition not allowed');
  });
});
