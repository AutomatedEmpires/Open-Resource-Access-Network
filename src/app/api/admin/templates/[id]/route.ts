/**
 * GET    /api/admin/templates/[id] — Get one template (any status).
 * PUT    /api/admin/templates/[id] — Update a template.
 * DELETE /api/admin/templates/[id] — Hard-delete a template.
 *
 * oran_admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import {
  getTemplate,
  updateTemplate,
  deleteTemplate,
} from '@/services/templates/templates';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_ROLE_SCOPES,
} from '@/domain/templates';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const UpdateTemplateSchema = z.object({
  title:             z.string().min(1).max(300).optional(),
  role_scope:        z.enum(TEMPLATE_ROLE_SCOPES).optional(),
  category:          z.enum(TEMPLATE_CATEGORIES).optional(),
  content_markdown:  z.string().min(1).optional(),
  tags:              z.array(z.string().max(100)).optional(),
  language:          z.string().length(2).optional(),
  jurisdiction_scope: z.string().max(200).nullable().optional(),
  is_published:      z.boolean().optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// Admin can see all scopes
const ALL_SCOPES = TEMPLATE_ROLE_SCOPES;

type Params = { params: Promise<{ id: string }> };

// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:templates:get:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    const template = await getTemplate(id, [...ALL_SCOPES]);
    if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ template }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_templates_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:templates:put:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  try {
    const template = await updateTemplate(id, {
      ...parsed.data,
      updated_by: authCtx.userId ?? null,
    });
    if (!template) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ template });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_templates_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:templates:delete:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    const deleted = await deleteTemplate(id);
    if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_templates_delete' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
