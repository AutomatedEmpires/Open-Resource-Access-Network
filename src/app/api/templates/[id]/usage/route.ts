/**
 * POST /api/templates/[id]/usage — Record a usage event (view / copy / use).
 *
 * No user PII stored — only the caller's role is recorded.
 * host_admin+.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { recordTemplateUsage } from '@/services/templates/templates';
import {
  TEMPLATE_USAGE_ACTIONS,
  TEMPLATE_VISIBLE_SCOPES,
  TemplateRoleScope,
} from '@/domain/templates';
import { OranRole } from '@/domain/types';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

const RecordUsageSchema = z.object({
  action: z.enum(TEMPLATE_USAGE_ACTIONS),
}).strict();
function visibleScopesForRole(role: OranRole): TemplateRoleScope[] {
  if (role === 'oran_admin' || role === 'community_admin' || role === 'host_admin') {
    return TEMPLATE_VISIBLE_SCOPES[role];
  }
  return [];
}

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const ip = getIp(req);
  const rl = checkRateLimit(`templates:usage:${ip}`, {
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
  if (!authCtx) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!requireMinRole(authCtx, 'host_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const visibleScopes = visibleScopesForRole(authCtx.role);
  if (visibleScopes.length === 0) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = RecordUsageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 422 });
  }

  // Fire-and-forget — usage tracking must not block the caller
  void recordTemplateUsage(id, parsed.data.action, authCtx.role);

  return new NextResponse(null, { status: 204 });
}
