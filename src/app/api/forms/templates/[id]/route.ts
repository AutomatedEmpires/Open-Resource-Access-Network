import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { getFormTemplateById, updateFormTemplate, deleteFormTemplate } from '@/services/forms/vault';
import {
  FORM_RECIPIENT_ROLES,
  FORM_STORAGE_SCOPES,
  FORM_TEMPLATE_AUDIENCES,
  getVisibleFormTemplateAudiences,
} from '@/domain/forms';
import { getIp } from '@/services/security/ip';
import {
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';

type RouteContext = { params: Promise<{ id: string }> };

const UpdateTemplateSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().min(1).max(100).optional(),
  audience_scope: z.enum(FORM_TEMPLATE_AUDIENCES).optional(),
  storage_scope: z.enum(FORM_STORAGE_SCOPES).optional(),
  default_target_role: z.enum(FORM_RECIPIENT_ROLES).nullable().optional(),
  schema_json: z.record(z.string(), z.unknown()).optional(),
  ui_schema_json: z.record(z.string(), z.unknown()).optional(),
  instructions_markdown: z.string().max(20000).nullable().optional(),
  is_published: z.boolean().optional(),
  blob_storage_prefix: z.string().max(500).nullable().optional(),
}).strict();
export async function GET(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`forms:templates:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'host_member')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    const visibleAudiences = getVisibleFormTemplateAudiences(authCtx.role);
    const includeUnpublished = authCtx.role === 'oran_admin';
    const template = await getFormTemplateById(id, visibleAudiences, includeUnpublished);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json({ template }, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_templates_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`forms:templates:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
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
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  try {
    const template = await updateFormTemplate(id, {
      ...parsed.data,
      updated_by_user_id: authCtx.userId,
    });
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json({ template });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_templates_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`forms:templates:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    const result = await deleteFormTemplate(id);
    if (!result.deleted) {
      return NextResponse.json({ error: result.reason }, { status: 409 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_templates_delete' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
