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
  listFormTemplates: vi.fn(),
  createFormTemplate: vi.fn(),
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

async function loadRoute() {
  return import('../route');
}

function createGetRequest(url = 'http://localhost/api/forms/templates?limit=10') {
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
    id: '11111111-1111-4111-8111-111111111111',
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

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  dbMocks.isDatabaseConfigured.mockReturnValue(true);
  authMocks.getAuthContext.mockResolvedValue({
    userId: 'user-1',
    role: 'host_member',
    orgIds: [],
    orgRoles: new Map(),
  });
  guardMocks.requireMinRole.mockReturnValue(true);
  rateLimitMock.mockReturnValue({ exceeded: false, retryAfterSeconds: 0 });
  captureExceptionMock.mockResolvedValue(undefined);
  vaultMocks.listFormTemplates.mockResolvedValue({
    templates: [makeTemplate()],
    total: 1,
  });
  vaultMocks.createFormTemplate.mockResolvedValue(makeTemplate());
});

describe('GET /api/forms/templates', () => {
  it('lists templates for the caller visibility scope', async () => {
    const { GET } = await loadRoute();
    const response = await GET(createGetRequest());

    expect(response.status).toBe(200);
    expect(vaultMocks.listFormTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        visibleAudiences: ['shared', 'host_member'],
        includeUnpublished: false,
        limit: 10,
      }),
    );
  });

  it('allows ORAN admins to request unpublished templates', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'oran-1',
      role: 'oran_admin',
      orgIds: [],
      orgRoles: new Map(),
    });

    const { GET } = await loadRoute();
    const response = await GET(createGetRequest('http://localhost/api/forms/templates?includeUnpublished=true'));

    expect(response.status).toBe(200);
    expect(vaultMocks.listFormTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        includeUnpublished: true,
        visibleAudiences: ['shared', 'host_member', 'host_admin', 'community_admin', 'oran_admin'],
      }),
    );
  });
});

describe('POST /api/forms/templates', () => {
  it('rejects non-ORAN callers', async () => {
    guardMocks.requireMinRole.mockReturnValueOnce(false);

    const { POST } = await loadRoute();
    const response = await POST(createPostRequest(makeTemplate()));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Insufficient permissions' });
  });

  it('creates a template with the authenticated creator id', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce({
      userId: 'oran-1',
      role: 'oran_admin',
      orgIds: [],
      orgRoles: new Map(),
    });

    const { POST } = await loadRoute();
    const response = await POST(
      createPostRequest({
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
        is_published: true,
      }),
    );

    expect(response.status).toBe(201);
    expect(vaultMocks.createFormTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'host-intake',
        created_by_user_id: 'oran-1',
      }),
    );
  });
});
