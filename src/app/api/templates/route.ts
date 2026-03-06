/**
 * GET /api/templates — List published templates visible to the caller's role.
 *
 * Role visibility:
 *   host_admin      → shared + host_admin
 *   community_admin → shared + host_admin + community_admin
 *   oran_admin      → all scopes
 *
 * seekers and unauthenticated users receive 403.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { listTemplates } from '@/services/templates/templates';
import {
  TEMPLATE_CATEGORIES,
  TEMPLATE_VISIBLE_SCOPES,
  TemplateRoleScope,
} from '@/domain/templates';
import { OranRole } from '@/domain/types';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const ListQuerySchema = z.object({
  category: z.enum(TEMPLATE_CATEGORIES).optional(),
  language: z.string().length(2).optional(),
  tags:     z.string().optional(), // comma-separated
  limit:    z.coerce.number().int().min(1).max(100).default(50),
  offset:   z.coerce.number().int().min(0).default(0),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function visibleScopesForRole(role: OranRole): TemplateRoleScope[] {
  if (role === 'oran_admin' || role === 'community_admin' || role === 'host_admin') {
    return TEMPLATE_VISIBLE_SCOPES[role];
  }
  // seeker / host_member — no access to template library
  return [];
}

// ============================================================
// HANDLER
// ============================================================

export async function GET(req: NextRequest) {
  const ip = getIp(req);
  const rl = checkRateLimit(`templates:list:${ip}`, {
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
  if (!authCtx) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!requireMinRole(authCtx, 'host_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const visibleScopes = visibleScopesForRole(authCtx.role);
  if (visibleScopes.length === 0) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const rawParams = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = ListQuerySchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { category, language, tags: tagsRaw, limit, offset } = parsed.data;
  const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : undefined;

  try {
    const result = await listTemplates({
      visibleScopes,
      category,
      language,
      tags,
      publishedOnly: true,
      limit,
      offset,
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_templates_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
