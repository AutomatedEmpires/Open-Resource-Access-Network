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
  duplicateFormTemplate: vi.fn(),
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
const USER_ID = 'user-admin-1';

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'host-intake-copy',
    title: 'Host intake (copy)',
    description: 'Collect host intake details.',
    category: 'operations',
    audience_scope: 'host_member',
    storage_scope: 'organization',
    default_target_role: 'community_admin',
    schema_json: {},
    ui_schema_json: {},
    instructions_markdown: null,
    version: 1,
    is_published: false,
    blob_storage_prefix: null,
    created_by_user_id: USER_ID,
    updated_by_user_id: USER_ID,
    created_at: '2026-03-09T00:00:00.000Z',
    updated_at: '2026-03-09T00:00:00.000Z',
    ...overrides,
  };
}

async function loadRoute() {
  return import('../route');
}

function createPostRequest(body: unknown) {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
  } as never;
}

function makeRouteContext(id = TEMPLATE_ID) {
  return { params: Promise.resolve({ id }) } as never;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  authMocks.getAuthContext.mockResolvedValue({
    userId: USER_ID,
    role: 'oran_admin',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  vaultMocks.duplicateFormTemplate.mockResolvedValue(makeTemplate());
});

describe('POST /api/forms/templates/[id]/duplicate', () => {
  it('duplicates a template and returns 201', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ newSlug: 'my-new-template' }),
      makeRouteContext(),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.template.slug).toBe('host-intake-copy');
    expect(body.template.is_published).toBe(false);
    expect(vaultMocks.duplicateFormTemplate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      'my-new-template',
      USER_ID,
    );
  });

  it('returns 400 for invalid template id', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ newSlug: 'test-copy' }),
      makeRouteContext('not-a-uuid'),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid slug format', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ newSlug: 'INVALID SLUG!' }),
      makeRouteContext(),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for slug too short', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ newSlug: 'ab' }),
      makeRouteContext(),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    } as never;
    const { POST } = await loadRoute();
    const res = await POST(req, makeRouteContext());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns 503 when database is not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ newSlug: 'test-copy' }),
      makeRouteContext(),
    );
    expect(res.status).toBe(503);
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ newSlug: 'test-copy' }),
      makeRouteContext(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when role is insufficient', async () => {
    guardMocks.requireMinRole.mockReturnValue(false);
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ newSlug: 'test-copy' }),
      makeRouteContext(),
    );
    expect(res.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ newSlug: 'test-copy' }),
      makeRouteContext(),
    );
    expect(res.status).toBe(429);
  });

  it('returns 404 when source template does not exist', async () => {
    vaultMocks.duplicateFormTemplate.mockRejectedValueOnce(
      new Error('Source template not found.'),
    );
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ newSlug: 'test-copy' }),
      makeRouteContext(),
    );
    expect(res.status).toBe(404);
  });

  it('returns 500 on unexpected errors', async () => {
    vaultMocks.duplicateFormTemplate.mockRejectedValueOnce(
      new Error('DB connection lost'),
    );
    const { POST } = await loadRoute();
    const res = await POST(
      createPostRequest({ newSlug: 'test-copy' }),
      makeRouteContext(),
    );
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
