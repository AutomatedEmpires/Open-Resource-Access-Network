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
const ORGANIZATION_ID = '4f0e8400-e29b-41d4-a716-446655440004';

async function loadRoute() {
  return import('../route');
}

function createRequest(options: {
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?: string;
} = {}) {
  const headers = new Headers();
  if (options.ip) {
    headers.set('x-forwarded-for', options.ip);
  }

  return {
    headers,
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
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
    template_schema_json: {
      routing: {
        defaultPriority: 2,
        slaReviewHours: 24,
      },
    },
    template_version: 1,
    storage_scope: 'platform',
    owner_organization_id: ORGANIZATION_ID,
    coverage_zone_id: null,
    recipient_role: 'community_admin',
    recipient_user_id: null,
    recipient_organization_id: null,
    blob_storage_prefix: 'forms/platform/demo',
    form_data: {},
    attachment_manifest: [],
    last_saved_at: '2026-03-08T00:00:00.000Z',
    submission_type: 'managed_form',
    status: 'draft',
    target_type: 'form_template',
    target_id: '3f0e8400-e29b-41d4-a716-446655440003',
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
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'user-1',
    role: 'host_admin',
    orgIds: [ORGANIZATION_ID],
    orgRoles: new Map([[ORGANIZATION_ID, 'host_admin']]),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance());
  vaultMocks.updateFormInstanceDraft.mockResolvedValue(undefined);
  vaultMocks.updateFormSubmissionOperationalMetadata.mockResolvedValue(undefined);
  vaultMocks.setFormSubmissionReviewerNotes.mockResolvedValue(undefined);
  workflowMocks.advance.mockResolvedValue({
    success: true,
    submissionId: SUBMISSION_ID,
    fromStatus: 'draft',
    toStatus: 'submitted',
    transitionId: 'transition-1',
    gateResults: [],
  });
  workflowMocks.applySla.mockResolvedValue(undefined);
  workflowMocks.assignSubmission.mockResolvedValue(true);
  notificationMocks.send.mockResolvedValue('notification-1');
});

describe('PUT /api/forms/instances/[id]', () => {
  it('queues a submitted managed form for review after submission', async () => {
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'draft' }))
      .mockResolvedValueOnce(makeInstance({ status: 'needs_review' }));
    workflowMocks.advance
      .mockResolvedValueOnce({
        success: true,
        submissionId: SUBMISSION_ID,
        fromStatus: 'draft',
        toStatus: 'submitted',
        transitionId: 'transition-submit',
        gateResults: [],
      })
      .mockResolvedValueOnce({
        success: true,
        submissionId: SUBMISSION_ID,
        fromStatus: 'submitted',
        toStatus: 'needs_review',
        transitionId: 'transition-review',
        gateResults: [],
      });

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'submit', formData: { field: 'value' } } }),
      createParams(),
    );

    expect(response.status).toBe(200);
    expect(vaultMocks.updateFormInstanceDraft).toHaveBeenCalledWith(
      INSTANCE_ID,
      expect.objectContaining({ formData: { field: 'value' } }),
    );
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ submissionId: SUBMISSION_ID, toStatus: 'submitted' }),
    );
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ submissionId: SUBMISSION_ID, toStatus: 'needs_review' }),
    );
    expect(vaultMocks.updateFormSubmissionOperationalMetadata).toHaveBeenCalledWith(
      SUBMISSION_ID,
      expect.objectContaining({ priority: 2, slaBreached: false }),
    );
    expect(workflowMocks.applySla).not.toHaveBeenCalled();
    expect(notificationMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'user-1',
        eventType: 'submission_status_changed',
      }),
    );
    await expect(response.json()).resolves.toEqual({
      instance: expect.objectContaining({ status: 'needs_review' }),
      transition: expect.objectContaining({ toStatus: 'needs_review' }),
      submittedTransition: expect.objectContaining({ toStatus: 'submitted' }),
    });
  });

  it('stops at submitted when the template disables auto queueing', async () => {
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'draft', template_schema_json: { routing: { autoQueueForReview: false } } }))
      .mockResolvedValueOnce(makeInstance({ status: 'submitted', template_schema_json: { routing: { autoQueueForReview: false } } }));
    workflowMocks.advance.mockResolvedValueOnce({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'draft',
      toStatus: 'submitted',
      transitionId: 'transition-submit',
      gateResults: [],
    });

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'submit', formData: { field: 'value' } } }),
      createParams(),
    );

    expect(response.status).toBe(200);
    expect(workflowMocks.advance).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toEqual({
      instance: expect.objectContaining({ status: 'submitted' }),
      transition: expect.objectContaining({ toStatus: 'submitted' }),
      submittedTransition: expect.objectContaining({ toStatus: 'submitted' }),
    });
  });

  it('allows a reviewer to start review when the form is waiting in needs_review', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'reviewer-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'needs_review' }))
      .mockResolvedValueOnce(makeInstance({ status: 'under_review' }));
    workflowMocks.advance.mockResolvedValueOnce({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'needs_review',
      toStatus: 'under_review',
      transitionId: 'transition-start-review',
      gateResults: [],
    });

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'start_review', reviewerNotes: 'Reviewing now' } }),
      createParams(),
    );

    expect(response.status).toBe(200);
    expect(vaultMocks.setFormSubmissionReviewerNotes).toHaveBeenCalledWith(
      SUBMISSION_ID,
      'Reviewing now',
    );
    expect(workflowMocks.assignSubmission).toHaveBeenCalledWith(
      SUBMISSION_ID,
      'reviewer-1',
      'reviewer-1',
      'community_admin',
    );
    expect(workflowMocks.advance).toHaveBeenCalledWith(
      expect.objectContaining({ submissionId: SUBMISSION_ID, toStatus: 'under_review' }),
    );
  });

  it('lets a reviewer queue a submitted form before starting review', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'reviewer-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'submitted' }))
      .mockResolvedValueOnce(makeInstance({ status: 'needs_review', assigned_to_user_id: null }))
      .mockResolvedValueOnce(makeInstance({ status: 'under_review', assigned_to_user_id: 'reviewer-1' }));
    workflowMocks.advance
      .mockResolvedValueOnce({
        success: true,
        submissionId: SUBMISSION_ID,
        fromStatus: 'submitted',
        toStatus: 'needs_review',
        transitionId: 'transition-queue',
        gateResults: [],
      })
      .mockResolvedValueOnce({
        success: true,
        submissionId: SUBMISSION_ID,
        fromStatus: 'needs_review',
        toStatus: 'under_review',
        transitionId: 'transition-start-review',
        gateResults: [],
      });

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'start_review', reviewerNotes: 'Taking ownership' } }),
      createParams(),
    );

    expect(response.status).toBe(200);
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ submissionId: SUBMISSION_ID, toStatus: 'needs_review' }),
    );
    expect(workflowMocks.advance).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ submissionId: SUBMISSION_ID, toStatus: 'under_review' }),
    );
  });

  it('rejects reviewer actions for non-reviewer roles', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'host-1',
      role: 'host_admin',
      orgIds: [ORGANIZATION_ID],
      orgRoles: new Map([[ORGANIZATION_ID, 'host_admin']]),
    });
    guardMocks.requireMinRole
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'approve', reviewerNotes: 'Looks good' } }),
      createParams(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Reviewer permissions required' });
  });

  // ── update_metadata tests ─────────────────────────────────

  it('updates priority and sla via update_metadata', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'reviewer-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    const refreshed = makeInstance({ priority: 3, sla_deadline: '2026-06-01T00:00:00.000Z' });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'under_review' }))
      .mockResolvedValueOnce(refreshed);

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'update_metadata', priority: 3, slaDeadline: '2026-06-01T00:00:00.000Z' } }),
      createParams(),
    );

    expect(response.status).toBe(200);
    expect(vaultMocks.updateFormSubmissionOperationalMetadata).toHaveBeenCalledWith(
      SUBMISSION_ID,
      expect.objectContaining({ priority: 3, slaDeadline: '2026-06-01T00:00:00.000Z', slaBreached: false }),
    );
    await expect(response.json()).resolves.toEqual({ instance: refreshed });
  });

  it('rejects update_metadata for non-reviewer roles', async () => {
    guardMocks.requireMinRole
      .mockReturnValueOnce(true)   // route-level DB check
      .mockReturnValueOnce(false); // community_admin check in handler

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'update_metadata', priority: 1 } }),
      createParams(),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Reviewer permissions required to update metadata' });
  });

  it('blocks update_metadata on terminal statuses', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'reviewer-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    vaultMocks.getAccessibleFormInstance.mockResolvedValueOnce(
      makeInstance({ status: 'approved' }),
    );

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'update_metadata', priority: 2 } }),
      createParams(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Cannot update metadata for form in terminal status "approved"',
    });
  });

  it('returns 400 when update_metadata has no fields', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'reviewer-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    vaultMocks.getAccessibleFormInstance.mockResolvedValueOnce(
      makeInstance({ status: 'under_review' }),
    );

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'update_metadata' } }),
      createParams(),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'No metadata fields provided to update' });
  });

  it('auto-computes slaBreached when slaDeadline is in the past', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'reviewer-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'needs_review' }))
      .mockResolvedValueOnce(makeInstance({ sla_breached: true }));

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'update_metadata', slaDeadline: '2020-01-01T00:00:00.000Z' } }),
      createParams(),
    );

    expect(response.status).toBe(200);
    expect(vaultMocks.updateFormSubmissionOperationalMetadata).toHaveBeenCalledWith(
      SUBMISSION_ID,
      expect.objectContaining({ slaBreached: true }),
    );
  });

  // ── Lifecycle notification tests ──────────────────────────

  it('sends notification to submitter on approve', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'reviewer-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'under_review' }))
      .mockResolvedValueOnce(makeInstance({ status: 'approved' }));
    workflowMocks.advance.mockResolvedValueOnce({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'under_review',
      toStatus: 'approved',
      transitionId: 'transition-approve',
      gateResults: [],
    });

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'approve', reviewerNotes: 'All good' } }),
      createParams(),
    );

    expect(response.status).toBe(200);
    expect(notificationMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'user-1',
        eventType: 'submission_status_changed',
        title: 'Form approved',
      }),
    );
  });

  it('sends notification to submitter on deny', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'reviewer-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'under_review' }))
      .mockResolvedValueOnce(makeInstance({ status: 'denied' }));
    workflowMocks.advance.mockResolvedValueOnce({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'under_review',
      toStatus: 'denied',
      transitionId: 'transition-deny',
      gateResults: [],
    });

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'deny', reviewerNotes: 'Missing info' } }),
      createParams(),
    );

    expect(response.status).toBe(200);
    expect(notificationMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'user-1',
        eventType: 'submission_status_changed',
        title: 'Form denied',
      }),
    );
  });

  it('sends notification to submitter on return', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'reviewer-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'under_review' }))
      .mockResolvedValueOnce(makeInstance({ status: 'returned' }));
    workflowMocks.advance.mockResolvedValueOnce({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'under_review',
      toStatus: 'returned',
      transitionId: 'transition-return',
      gateResults: [],
    });

    const { PUT } = await loadRoute();
    const response = await PUT(
      createRequest({ jsonBody: { action: 'return', reviewerNotes: 'Please fix section 2' } }),
      createParams(),
    );

    expect(response.status).toBe(200);
    expect(notificationMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: 'user-1',
        eventType: 'submission_status_changed',
        title: 'Form returned for revision',
      }),
    );
  });

  it('does not send lifecycle notification on start_review', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'reviewer-1',
      role: 'community_admin',
      orgIds: [],
      orgRoles: new Map(),
    });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'needs_review' }))
      .mockResolvedValueOnce(makeInstance({ status: 'under_review' }));
    workflowMocks.advance.mockResolvedValueOnce({
      success: true,
      submissionId: SUBMISSION_ID,
      fromStatus: 'needs_review',
      toStatus: 'under_review',
      transitionId: 'transition-start-review',
      gateResults: [],
    });

    const { PUT } = await loadRoute();
    await PUT(
      createRequest({ jsonBody: { action: 'start_review' } }),
      createParams(),
    );

    expect(notificationMocks.send).not.toHaveBeenCalled();
  });
});
