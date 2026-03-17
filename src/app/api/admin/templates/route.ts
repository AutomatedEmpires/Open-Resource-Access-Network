/**
 * GET  /api/admin/templates   — List all templates (including unpublished).
 * POST /api/admin/templates   — Create a new template.
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
  listAllTemplates,
  createTemplate,
} from '@/services/templates/templates';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_ROLE_SCOPES,
} from '@/domain/templates';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const CreateTemplateSchema = z.object({
  title:             z.string().min(1).max(300),
  slug:              z.string().min(1).max(200).regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with hyphens'),
  role_scope:        z.enum(TEMPLATE_ROLE_SCOPES),
  category:          z.enum(TEMPLATE_CATEGORIES),
  content_markdown:  z.string().min(1),
  tags:              z.array(z.string().max(100)).default([]),
  language:          z.string().length(2).default('en'),
  jurisdiction_scope: z.string().max(200).nullable().default(null),
  is_published:      z.boolean().default(false),
}).strict();

const ListQuerySchema = z.object({
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  limit:    z.coerce.number().int().min(1).max(200).default(100),
  offset:   z.coerce.number().int().min(0).default(0),
});

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest) {
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

  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = ListQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await listAllTemplates(parsed.data);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_admin_templates_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:templates:post:${ip}`, {
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

  const parsed = CreateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  try {
    const template = await createTemplate({
      ...parsed.data,
      created_by: authCtx.userId ?? null,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (error: unknown) {
    // Postgres unique violation on slug
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === '23505'
    ) {
      return NextResponse.json({ error: 'A template with this slug already exists.' }, { status: 409 });
    }
    await captureException(error, { feature: 'api_admin_templates_create' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
