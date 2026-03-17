import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured, executeQuery } from '@/services/db/postgres';
import { getAccessibleFormInstance } from '@/services/forms/vault';
import {
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import type { FormTimelineEntry } from '@/domain/forms';
import { getIp } from '@/services/security/ip';

type RouteContext = { params: Promise<{ id: string }> };

interface TransitionRow {
  id: string;
  from_status: string;
  to_status: string;
  actor_role: string | null;
  reason: string | null;
  gates_passed: boolean;
  created_at: string;
}

/**
 * GET /api/forms/instances/[id]/timeline
 *
 * Returns the full audit trail of status transitions for a form instance.
 * Only accessible to users who can view the form instance itself.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid form instance ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`forms:timeline:get:${ip}`, {
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
    // Verify the user can access this form instance
    const instance = await getAccessibleFormInstance(authCtx, id);
    if (!instance) {
      return NextResponse.json({ error: 'Form instance not found' }, { status: 404 });
    }

    // Fetch transitions ordered chronologically
    const rows = await executeQuery<TransitionRow>(
      `SELECT id, from_status, to_status, actor_role, reason, gates_passed, created_at
       FROM submission_transitions
       WHERE submission_id = $1
       ORDER BY created_at ASC`,
      [instance.submission_id],
    );

    const timeline: FormTimelineEntry[] = rows.map((row) => ({
      id: row.id,
      timestamp: row.created_at,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      actorRole: row.actor_role,
      reason: row.reason,
      gatesPassed: row.gates_passed,
    }));

    return NextResponse.json(
      { timeline, submissionId: instance.submission_id },
      { headers: { 'Cache-Control': 'private, max-age=15' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_forms_timeline' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
