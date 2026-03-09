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
  bulkUpdateInstanceStatus: vi.fn(),
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

const USER_ID = 'user-admin-1';
const INSTANCE_ID_1 = '11111111-1111-4111-8111-111111111111';
const INSTANCE_ID_2 = '22222222-2222-4222-8222-222222222222';

async function loadRoute() {
  return import('../route');
}

function createPostRequest(body: unknown) {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
  } as never;
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
  vaultMocks.bulkUpdateInstanceStatus.mockResolvedValue([
    { id: INSTANCE_ID_1, success: true },
    { id: INSTANCE_ID_2, success: true },
  ]);
});

describe('POST /api/forms/instances/bulk', () => {
  it('approves multiple instances and returns summary', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({
        instanceIds: [INSTANCE_ID_1, INSTANCE_ID_2],
        action: 'approve',
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary).toEqual({ total: 2, succeeded: 2, failed: 0 });
    expect(json.results).toHaveLength(2);
  });

  it('reports partial failures in summary', async () => {
    vaultMocks.bulkUpdateInstanceStatus.mockResolvedValue([
      { id: INSTANCE_ID_1, success: true },
      { id: INSTANCE_ID_2, success: false, error: 'Not found' },
    ]);
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({
        instanceIds: [INSTANCE_ID_1, INSTANCE_ID_2],
        action: 'approve',
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
  });

  it('requires reviewer notes for deny action', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({
        instanceIds: [INSTANCE_ID_1],
        action: 'deny',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('requires reviewer notes for return action', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({
        instanceIds: [INSTANCE_ID_1],
        action: 'return',
        reviewerNotes: '',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts deny with reviewer notes', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({
        instanceIds: [INSTANCE_ID_1],
        action: 'deny',
        reviewerNotes: 'Missing required documents.',
      }),
    );
    expect(res.status).toBe(200);
  });

  it('rejects empty instanceIds', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({
        instanceIds: [],
        action: 'approve',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects non-UUID instanceIds', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({
        instanceIds: ['not-a-uuid'],
        action: 'approve',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects invalid action', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({
        instanceIds: [INSTANCE_ID_1],
        action: 'delete',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 503 when database not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();
    const res = await POST(createPostRequest({}));
    expect(res.status).toBe(503);
  });

  it('returns 401 when not authenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ instanceIds: [INSTANCE_ID_1], action: 'approve' }),
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for insufficient role', async () => {
    guardMocks.requireMinRole.mockReturnValue(false);
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ instanceIds: [INSTANCE_ID_1], action: 'approve' }),
    );
    expect(res.status).toBe(403);
  });

  it('returns 429 on rate limit', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { POST } = await loadRoute();
    const res = await POST(createPostRequest({}));
    expect(res.status).toBe(429);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = {
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new SyntaxError('bad')),
    } as never;
    const { POST } = await loadRoute();
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 500 on internal error', async () => {
    vaultMocks.bulkUpdateInstanceStatus.mockRejectedValue(new Error('DB fail'));
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({
        instanceIds: [INSTANCE_ID_1],
        action: 'approve',
      }),
    );
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it('passes correct arguments to vault', async () => {
    const { POST } = await loadRoute();
    await POST(
      createPostRequest({
        instanceIds: [INSTANCE_ID_1, INSTANCE_ID_2],
        action: 'return',
        reviewerNotes: 'Needs more info.',
      }),
    );
    expect(vaultMocks.bulkUpdateInstanceStatus).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, role: 'community_admin' }),
      [INSTANCE_ID_1, INSTANCE_ID_2],
      'return',
      'Needs more info.',
    );
  });
});
