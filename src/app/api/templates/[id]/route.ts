/**
 * GET  /api/templates/[id] — Get a single published template by ID.
 * POST /api/templates/[id]/usage — Record a usage event (view/copy/use).
 *
 * Role-gated: host_admin+. Seekers receive 403.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import {
  getTemplate,
} from '@/services/templates/templates';
import {
  TEMPLATE_VISIBLE_SCOPES,
  TemplateRoleScope,
} from '@/domain/templates';
import { OranRole } from '@/domain/types';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

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
  return [];
}

type Params = { params: Promise<{ id: string }> };

// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ip = getIp(req);
  const rl = checkRateLimit(`templates:get:${ip}`, {
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

  try {
    const template = await getTemplate(id, visibleScopes);
    if (!template || !template.is_published) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ template }, {
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_templates_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/templates/[id]/usage  ← note: this is a combined file but usage
 * lives at /api/templates/[id]/usage/route.ts — see that file.
 *
 * Exposed here only for usage summary on the detail view.
 * (Usage tracking endpoint is in /api/templates/[id]/usage/route.ts)
 */
