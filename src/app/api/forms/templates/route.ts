import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import {
  createFormTemplate,
  listFormTemplates,
} from '@/services/forms/vault';
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

const ListQuerySchema = z.object({
  category: z.string().min(1).max(100).optional(),
  search: z.string().min(1).max(200).optional(),
  includeUnpublished: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const CreateTemplateSchema = z.object({
  slug: z.string().min(3).max(120).regex(/^[a-z0-9-]+$/),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().min(1).max(100).default('general'),
  audience_scope: z.enum(FORM_TEMPLATE_AUDIENCES),
  storage_scope: z.enum(FORM_STORAGE_SCOPES).default('platform'),
  default_target_role: z.enum(FORM_RECIPIENT_ROLES).nullable().optional(),
  schema_json: z.record(z.string(), z.unknown()).default({}),
  ui_schema_json: z.record(z.string(), z.unknown()).default({}),
  instructions_markdown: z.string().max(20000).nullable().optional(),
  is_published: z.boolean().default(false),
  blob_storage_prefix: z.string().max(500).nullable().optional(),
}).strict();
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
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

  const parsed = ListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const visibleAudiences = getVisibleFormTemplateAudiences(authCtx.role);
    const result = await listFormTemplates({
      visibleAudiences,
      category: parsed.data.category,
      search: parsed.data.search,
      includeUnpublished: authCtx.role === 'oran_admin' && parsed.data.includeUnpublished,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_templates_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
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

  const parsed = CreateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const template = await createFormTemplate({
      ...parsed.data,
      created_by_user_id: authCtx.userId,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_templates_create' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
