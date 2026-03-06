/**
 * Admin Templates API route tests.
 *
 * Tests /api/admin/templates (GET/POST) and
 *       /api/admin/templates/[id] (GET/PUT/DELETE).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ============================================================
// MOCKS (vi.hoisted so they are available before imports)
// ============================================================

const dbMocks = vi.hoisted(() => ({
  executeQuery:          vi.fn(),
  isDatabaseConfigured:  vi.fn(),
  withTransaction:       vi.fn(),
}));

const rateLimitMock    = vi.hoisted(() => vi.fn());
const captureExMock    = vi.hoisted(() => vi.fn());
const authMocks        = vi.hoisted(() => ({ getAuthContext: vi.fn() }));
const requireMinRoleMock = vi.hoisted(() => vi.fn());

const templatesMocks = vi.hoisted(() => ({
  listAllTemplates:    vi.fn(),
  createTemplate:      vi.fn(),
  getTemplate:         vi.fn(),
  updateTemplate:      vi.fn(),
  deleteTemplate:      vi.fn(),
}));

vi.mock('@/services/db/postgres', () => dbMocks);
vi.mock('@/services/security/rateLimit', () => ({ checkRateLimit: rateLimitMock }));
vi.mock('@/services/telemetry/sentry', () => ({ captureException: captureExMock }));
vi.mock('@/services/auth/session', () => authMocks);
vi.mock('@/services/auth/guards', () => ({ requireMinRole: requireMinRoleMock }));
vi.mock('@/services/templates/templates', () => templatesMocks);

// ============================================================
// HELPERS
// ============================================================

import type { ContentTemplate } from '@/domain/templates';

function makeTemplate(overrides: Partial<ContentTemplate> = {}): ContentTemplate {
  return {
    id:                'tpl-1',
    title:             'How Verification Works',
    slug:              'how-verification-works',
    role_scope:        'shared',
    category:          'training',
    content_markdown:  '# Content',
    tags:              [],
    language:          'en',
    jurisdiction_scope: null,
    version:           1,
    is_published:      true,
    created_by:        'admin-1',
    updated_by:        'admin-1',
    created_at:        '2025-01-01T00:00:00Z',
    updated_at:        '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeRequest(options: {
  search?:   string;
  jsonBody?: unknown;
  jsonError?: boolean;
  ip?:       string;
} = {}) {
  const url = new URL(`https://oran.test${options.search ?? ''}`);
  const headers = new Headers();
  if (options.ip) headers.set('x-forwarded-for', options.ip);
  return {
    headers,
    nextUrl: url,
    url: url.toString(),
    json: options.jsonError
      ? vi.fn().mockRejectedValue(new Error('invalid json'))
      : vi.fn().mockResolvedValue(options.jsonBody),
  } as never;
}

function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) } as never;
}

// ============================================================
// GLOBAL SETUP
// ============================================================

const ORAN_ADMIN_CTX = { userId: 'admin-1', role: 'oran_admin' as const };

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitMock.mockReturnValue({ exceeded: false });
  authMocks.getAuthContext.mockResolvedValue(ORAN_ADMIN_CTX);
  requireMinRoleMock.mockReturnValue(true);
  templatesMocks.listAllTemplates.mockResolvedValue({ templates: [], total: 0 });
  templatesMocks.createTemplate.mockResolvedValue(makeTemplate());
  templatesMocks.getTemplate.mockResolvedValue(makeTemplate());
  templatesMocks.updateTemplate.mockResolvedValue(makeTemplate());
  templatesMocks.deleteTemplate.mockResolvedValue(true);
});

// ============================================================
// GET /api/admin/templates
// ============================================================

describe('GET /api/admin/templates', () => {
  async function load() {
    return import('../route');
  }

  it('returns 429 when rate-limited', async () => {
    rateLimitMock.mockReturnValueOnce({ exceeded: true, retryAfterSeconds: 30 });
    const { GET } = await load();
    const res = await GET(makeRequest());
    expect(res.status).toBe(429);
  });

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { GET } = await load();
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 403 when not oran_admin', async () => {
    requireMinRoleMock.mockReturnValueOnce(false);
    const { GET } = await load();
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it('returns 200 with template list', async () => {
    const tpl = makeTemplate();
    templatesMocks.listAllTemplates.mockResolvedValueOnce({ templates: [tpl], total: 1 });
    const { GET } = await load();
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const json = await res.json() as { templates: ContentTemplate[]; total: number };
    expect(json.total).toBe(1);
    expect(json.templates[0].id).toBe('tpl-1');
  });

  it('returns 400 for invalid query params', async () => {
    const { GET } = await load();
    const res = await GET(makeRequest({ search: '?limit=NaN' }));
    expect(res.status).toBe(400);
  });

  it('returns 500 on DB error', async () => {
    templatesMocks.listAllTemplates.mockRejectedValueOnce(new Error('DB down'));
    const { GET } = await load();
    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    expect(captureExMock).toHaveBeenCalledOnce();
  });
});

// ============================================================
// POST /api/admin/templates
// ============================================================

describe('POST /api/admin/templates', () => {
  async function load() {
    return import('../route');
  }

  const validBody = {
    title:            'Org Onboarding Guide',
    slug:             'org-onboarding-guide',
    role_scope:       'host_admin',
    category:         'onboarding',
    content_markdown: '# Welcome\n\nOnboarding steps here.',
    is_published:     false,
  };

  it('returns 401 when unauthenticated', async () => {
    authMocks.getAuthContext.mockResolvedValueOnce(null);
    const { POST } = await load();
    const res = await POST(makeRequest({ jsonBody: validBody }));
    expect(res.status).toBe(401);
  });

  it('returns 400 on invalid JSON', async () => {
    const { POST } = await load();
    const res = await POST(makeRequest({ jsonError: true }));
    expect(res.status).toBe(400);
  });

  it('returns 422 when required fields missing', async () => {
    const { POST } = await load();
    const res = await POST(makeRequest({ jsonBody: { title: 'Missing fields' } }));
    expect(res.status).toBe(422);
  });

  it('returns 422 when slug has invalid chars', async () => {
    const { POST } = await load();
    const res = await POST(makeRequest({ jsonBody: { ...validBody, slug: 'Has Spaces!' } }));
    expect(res.status).toBe(422);
  });

  it('returns 201 with new template on success', async () => {
    const { POST } = await load();
    const res = await POST(makeRequest({ jsonBody: validBody }));
    expect(res.status).toBe(201);
    const json = await res.json() as { template: ContentTemplate };
    expect(json.template.id).toBe('tpl-1');
  });

  it('returns 409 on duplicate slug (Postgres unique violation)', async () => {
    templatesMocks.createTemplate.mockRejectedValueOnce({ code: '23505' });
    const { POST } = await load();
    const res = await POST(makeRequest({ jsonBody: validBody }));
    expect(res.status).toBe(409);
  });

  it('returns 500 on unexpected DB error', async () => {
    templatesMocks.createTemplate.mockRejectedValueOnce(new Error('DB error'));
    const { POST } = await load();
    const res = await POST(makeRequest({ jsonBody: validBody }));
    expect(res.status).toBe(500);
  });
});

// ============================================================
// GET /api/admin/templates/[id]
// ============================================================

describe('GET /api/admin/templates/[id]', () => {
  async function load() {
    const mod = await import('../[id]/route');
    return mod;
  }

  it('returns 404 when template not found', async () => {
    templatesMocks.getTemplate.mockResolvedValueOnce(null);
    const { GET } = await load();
    const res = await GET(makeRequest(), makeCtx('missing'));
    expect(res.status).toBe(404);
  });

  it('returns 200 with template', async () => {
    const { GET } = await load();
    const res = await GET(makeRequest(), makeCtx('tpl-1'));
    expect(res.status).toBe(200);
    const json = await res.json() as { template: ContentTemplate };
    expect(json.template.id).toBe('tpl-1');
  });
});

// ============================================================
// PUT /api/admin/templates/[id]
// ============================================================

describe('PUT /api/admin/templates/[id]', () => {
  async function load() {
    return import('../[id]/route');
  }

  it('returns 404 when template not found', async () => {
    templatesMocks.updateTemplate.mockResolvedValueOnce(null);
    const { PUT } = await load();
    const res = await PUT(makeRequest({ jsonBody: { title: 'Updated' } }), makeCtx('missing'));
    expect(res.status).toBe(404);
  });

  it('returns 200 with updated template', async () => {
    const { PUT } = await load();
    const res = await PUT(makeRequest({ jsonBody: { title: 'Updated Title' } }), makeCtx('tpl-1'));
    expect(res.status).toBe(200);
    const json = await res.json() as { template: ContentTemplate };
    expect(json.template.id).toBe('tpl-1');
  });

  it('returns 422 for invalid update body', async () => {
    const { PUT } = await load();
    const res = await PUT(makeRequest({ jsonBody: { language: 'too_long_code' } }), makeCtx('tpl-1'));
    expect(res.status).toBe(422);
  });
});

// ============================================================
// DELETE /api/admin/templates/[id]
// ============================================================

describe('DELETE /api/admin/templates/[id]', () => {
  async function load() {
    return import('../[id]/route');
  }

  it('returns 404 when template not found', async () => {
    templatesMocks.deleteTemplate.mockResolvedValueOnce(false);
    const { DELETE } = await load();
    const res = await DELETE(makeRequest(), makeCtx('missing'));
    expect(res.status).toBe(404);
  });

  it('returns 204 on successful delete', async () => {
    const { DELETE } = await load();
    const res = await DELETE(makeRequest(), makeCtx('tpl-1'));
    expect(res.status).toBe(204);
  });
});
