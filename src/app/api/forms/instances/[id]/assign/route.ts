import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { getAccessibleFormInstance } from '@/services/forms/vault';
import { assignSubmission } from '@/services/workflow/engine';
import { getIp } from '@/services/security/ip';
import {
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';

type RouteContext = { params: Promise<{ id: string }> };

const AssignSchema = z.object({
  assigneeUserId: z.string().min(1).max(200),
}).strict();
/**
 * POST /api/forms/instances/[id]/assign
 *
 * Reassign a form instance to a different reviewer.
 * Requires community_admin or higher.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid form instance ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`forms:instance:assign:${ip}`, {
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
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Reviewer permissions required' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = AssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const instance = await getAccessibleFormInstance(authCtx, id);
    if (!instance) {
      return NextResponse.json({ error: 'Form instance not found' }, { status: 404 });
    }

    const assignableStatuses = ['submitted', 'needs_review', 'under_review'];
    if (!assignableStatuses.includes(instance.status)) {
      return NextResponse.json(
        { error: `Cannot assign a form in status "${instance.status}". Allowed: ${assignableStatuses.join(', ')}` },
        { status: 409 },
      );
    }

    const success = await assignSubmission(
      instance.submission_id,
      parsed.data.assigneeUserId,
      authCtx.userId,
      authCtx.role,
    );

    if (!success) {
      return NextResponse.json({ error: 'Unable to assign form' }, { status: 500 });
    }

    const refreshed = await getAccessibleFormInstance(authCtx, id);
    return NextResponse.json({ instance: refreshed });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_instances_assign' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
