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
  getFormTemplateById: vi.fn(),
  updateFormTemplate: vi.fn(),
  deleteFormTemplate: vi.fn(),
}));
const formsMocks = vi.hoisted(() => ({
  getVisibleFormTemplateAudiences: vi.fn(),
  FORM_RECIPIENT_ROLES: ['host_member', 'host_admin', 'community_admin', 'oran_admin'] as const,
  FORM_STORAGE_SCOPES: ['platform', 'organization', 'community'] as const,
  FORM_TEMPLATE_AUDIENCES: ['shared', 'host_member', 'host_admin', 'community_admin', 'oran_admin'] as const,
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
vi.mock('@/domain/forms', () => formsMocks);

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user-admin-1';

function makeTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: TEMPLATE_ID,
    slug: 'host-intake',
    title: 'Host Intake',
    description: 'Collect host intake.',
    category: 'operations',
    audience_scope: 'host_member',
    storage_scope: 'organization',
    default_target_role: 'community_admin',
    schema_json: {},
    ui_schema_json: {},
    instructions_markdown: null,
    version: 1,
    is_published: true,
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

function makeGetRequest() {
  return {
    headers: new Headers(),
    nextUrl: { searchParams: new URLSearchParams() },
  } as never;
}

function makePutRequest(body: unknown) {
  return {
    headers: new Headers(),
    json: vi.fn().mockResolvedValue(body),
  } as never;
}

function makeDeleteRequest() {
  return {
    headers: new Headers(),
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
  formsMocks.getVisibleFormTemplateAudiences.mockReturnValue(['shared', 'host_member', 'host_admin', 'community_admin', 'oran_admin']);
  vaultMocks.getFormTemplateById.mockResolvedValue(makeTemplate());
  vaultMocks.updateFormTemplate.mockResolvedValue(makeTemplate({ title: 'Updated Title', version: 2 }));
  vaultMocks.deleteFormTemplate.mockResolvedValue({ deleted: true });
});

// ── GET tests ─────────────────────────────────────────

describe('GET /api/forms/templates/[id]', () => {
  it('returns template on success', async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.template.id).toBe(TEMPLATE_ID);
    expect(json.template.title).toBe('Host Intake');
  });

  it('returns 400 for invalid UUID', async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when template not found', async () => {
    vaultMocks.getFormTemplateById.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(404);
  });

  it('returns 503 when database not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(503);
  });

  it('returns 401 when not authenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(401);
  });

  it('returns 403 when insufficient role', async () => {
    guardMocks.requireMinRole.mockReturnValue(false);
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(403);
  });

  it('returns 429 on rate limit', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 42 });
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(429);
  });

  it('returns 500 on internal error', async () => {
    vaultMocks.getFormTemplateById.mockRejectedValue(new Error('DB fail'));
    const { GET } = await loadRoute();
    const res = await GET(makeGetRequest(), makeRouteContext());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});

// ── PUT tests ─────────────────────────────────────────

describe('PUT /api/forms/templates/[id]', () => {
  it('updates template on success', async () => {
    const { PUT } = await loadRoute();
    const res = await PUT(makePutRequest({ title: 'Updated Title' }), makeRouteContext());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.template.title).toBe('Updated Title');
    expect(json.template.version).toBe(2);
  });

  it('returns 400 for invalid UUID', async () => {
    const { PUT } = await loadRoute();
    const res = await PUT(makePutRequest({ title: 'X' }), makeRouteContext('not-valid'));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const req = {
      headers: new Headers(),
      json: vi.fn().mockRejectedValue(new SyntaxError('bad json')),
    } as never;
    const { PUT } = await loadRoute();
    const res = await PUT(req, makeRouteContext());
    expect(res.status).toBe(400);
  });

  it('returns 400 when no fields provided', async () => {
    const { PUT } = await loadRoute();
    const res = await PUT(makePutRequest({}), makeRouteContext());
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('No fields to update');
  });

  it('returns 400 for validation failures (title too short)', async () => {
    const { PUT } = await loadRoute();
    const res = await PUT(makePutRequest({ title: 'ab' }), makeRouteContext());
    expect(res.status).toBe(400);
  });

  it('returns 404 when template not found', async () => {
    vaultMocks.updateFormTemplate.mockResolvedValue(null);
    const { PUT } = await loadRoute();
    const res = await PUT(makePutRequest({ title: 'New Name' }), makeRouteContext());
    expect(res.status).toBe(404);
  });

  it('returns 503 when database not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { PUT } = await loadRoute();
    const res = await PUT(makePutRequest({ title: 'X' }), makeRouteContext());
    expect(res.status).toBe(503);
  });

  it('returns 401 when not authenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { PUT } = await loadRoute();
    const res = await PUT(makePutRequest({ title: 'X' }), makeRouteContext());
    expect(res.status).toBe(401);
  });

  it('returns 403 when not oran_admin', async () => {
    guardMocks.requireMinRole.mockReturnValue(false);
    const { PUT } = await loadRoute();
    const res = await PUT(makePutRequest({ title: 'X' }), makeRouteContext());
    expect(res.status).toBe(403);
  });

  it('returns 429 on rate limit', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 30 });
    const { PUT } = await loadRoute();
    const res = await PUT(makePutRequest({ title: 'X' }), makeRouteContext());
    expect(res.status).toBe(429);
  });

  it('returns 500 on internal error', async () => {
    vaultMocks.updateFormTemplate.mockRejectedValue(new Error('DB error'));
    const { PUT } = await loadRoute();
    const res = await PUT(makePutRequest({ title: 'Updated' }), makeRouteContext());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it('passes correct input to vault including updated_by_user_id', async () => {
    const { PUT } = await loadRoute();
    await PUT(
      makePutRequest({ title: 'My New Title', category: 'intake', is_published: true }),
      makeRouteContext(),
    );
    expect(vaultMocks.updateFormTemplate).toHaveBeenCalledWith(
      TEMPLATE_ID,
      expect.objectContaining({
        title: 'My New Title',
        category: 'intake',
        is_published: true,
        updated_by_user_id: USER_ID,
      }),
    );
  });
});

// ── DELETE tests ──────────────────────────────────────

describe('DELETE /api/forms/templates/[id]', () => {
  it('deletes template on success', async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE(makeDeleteRequest(), makeRouteContext());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deleted).toBe(true);
    expect(vaultMocks.deleteFormTemplate).toHaveBeenCalledWith(TEMPLATE_ID);
  });

  it('returns 409 when template has instances', async () => {
    vaultMocks.deleteFormTemplate.mockResolvedValue({ deleted: false, reason: 'Template has 3 instances.' });
    const { DELETE } = await loadRoute();
    const res = await DELETE(makeDeleteRequest(), makeRouteContext());
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('3 instances');
  });

  it('returns 400 for invalid UUID', async () => {
    const { DELETE } = await loadRoute();
    const res = await DELETE(makeDeleteRequest(), makeRouteContext('not-valid'));
    expect(res.status).toBe(400);
  });

  it('returns 503 when database not configured', async () => {
    dbMocks.isDatabaseConfigured.mockReturnValue(false);
    const { DELETE } = await loadRoute();
    const res = await DELETE(makeDeleteRequest(), makeRouteContext());
    expect(res.status).toBe(503);
  });

  it('returns 401 when not authenticated', async () => {
    authMocks.getAuthContext.mockResolvedValue(null);
    const { DELETE } = await loadRoute();
    const res = await DELETE(makeDeleteRequest(), makeRouteContext());
    expect(res.status).toBe(401);
  });

  it('returns 403 when not oran_admin', async () => {
    guardMocks.requireMinRole.mockReturnValue(false);
    const { DELETE } = await loadRoute();
    const res = await DELETE(makeDeleteRequest(), makeRouteContext());
    expect(res.status).toBe(403);
  });

  it('returns 429 on rate limit', async () => {
    rateLimitMock.mockReturnValue({ exceeded: true, retryAfterSeconds: 15 });
    const { DELETE } = await loadRoute();
    const res = await DELETE(makeDeleteRequest(), makeRouteContext());
    expect(res.status).toBe(429);
  });

  it('returns 500 on internal error', async () => {
    vaultMocks.deleteFormTemplate.mockRejectedValue(new Error('DB error'));
    const { DELETE } = await loadRoute();
    const res = await DELETE(makeDeleteRequest(), makeRouteContext());
    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalled();
  });
});
