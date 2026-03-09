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
}));
const workflowMocks = vi.hoisted(() => ({
  assignSubmission: vi.fn(),
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
vi.mock('@/domain/constants', () => ({
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS: 50,
  RATE_LIMIT_WINDOW_MS: 60_000,
}));

const INSTANCE_ID = '22222222-2222-4222-8222-222222222222';
const SUBMISSION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = 'user-admin-1';
const ASSIGNEE_ID = 'user-reviewer-1';

function makeInstance(overrides: Record<string, unknown> = {}) {
  return {
    id: INSTANCE_ID,
    submission_id: SUBMISSION_ID,
    template_id: '11111111-1111-4111-8111-111111111111',
    title: 'Test Instance',
    status: 'submitted',
    ...overrides,
  };
}

async function loadRoute() {
  return import('../route');
}

function makePostRequest(body: unknown) {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
  } as never;
}

function makeRouteContext(id = INSTANCE_ID) {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  authMocks.getAuthContext.mockResolvedValue({
    userId: USER_ID,
    role: 'community_admin',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance());
  workflowMocks.assignSubmission.mockResolvedValue(true);
});

describe('POST /api/forms/instances/[id]/assign', () => {
  it('assigns reviewer on success', async () => {
    const refreshed = makeInstance({ assigned_to_user_id: ASSIGNEE_ID });
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance())
      .mockResolvedValueOnce(refreshed);
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.instance.assigned_to_user_id).toBe(ASSIGNEE_ID);
    expect(workflowMocks.assignSubmission).toHaveBeenCalledWith(
      SUBMISSION_ID,
      ASSIGNEE_ID,
      USER_ID,
      'community_admin',
    );
  });

  it('returns 400 for invalid UUID', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext('not-valid'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new SyntaxError('bad json')),
    } as never;
    const { POST } = await loadRoute();
    const res = await POST(req, makeRouteContext());
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing assigneeUserId', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({}), makeRouteContext());
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty assigneeUserId', async () => {
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: '' }), makeRouteContext());
    expect(res.status).toBe(400);
  });

  it('returns 503 when database not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(503);
  });

  it('returns 401 when not authenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(401);
  });

  it('returns 403 when insufficient role', async () => {
    guardMocks.requireMinRole.mockReturnValue(false);
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(403);
  });

  it('returns 404 when instance not found', async () => {
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(null);
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(404);
  });

  it('returns 409 when instance is in non-assignable status', async () => {
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance({ status: 'draft' }));
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('Cannot assign');
  });

  it('returns 409 for approved status', async () => {
    vaultMocks.getAccessibleFormInstance.mockResolvedValue(makeInstance({ status: 'approved' }));
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(409);
  });

  it('allows assignment for needs_review status', async () => {
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'needs_review' }))
      .mockResolvedValueOnce(makeInstance({ status: 'needs_review', assigned_to_user_id: ASSIGNEE_ID }));
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(200);
  });

  it('allows assignment for under_review status', async () => {
    vaultMocks.getAccessibleFormInstance
      .mockResolvedValueOnce(makeInstance({ status: 'under_review' }))
      .mockResolvedValueOnce(makeInstance({ status: 'under_review', assigned_to_user_id: ASSIGNEE_ID }));
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(200);
  });

  it('returns 500 when assignSubmission fails', async () => {
    workflowMocks.assignSubmission.mockResolvedValue(false);
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(500);
  });

  it('returns 429 on rate limit', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(429);
  });

  it('returns 500 on internal error', async () => {
    vaultMocks.getAccessibleFormInstance.mockRejectedValue(new Error('DB fail'));
    const { POST } = await loadRoute();
    const res = await POST(makePostRequest({ assigneeUserId: ASSIGNEE_ID }), makeRouteContext());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
