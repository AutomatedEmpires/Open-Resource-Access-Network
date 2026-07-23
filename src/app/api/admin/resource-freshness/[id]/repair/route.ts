import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import { requireMinRole } from '@/services/auth/guards';
import { getAuthContext } from '@/services/auth/session';
import { isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import {
  RESOURCE_FRESHNESS_REPAIR_REASON_MAX_LENGTH,
  RESOURCE_FRESHNESS_REPAIR_REASON_MIN_LENGTH,
  ResourceFreshnessRepairConflictError,
  repairResourceFreshnessPacketInTransaction,
} from '@/services/freshness/resourceFreshnessRepair';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { getIp } from '@/services/security/ip';
import { captureException } from '@/services/telemetry/sentry';

const RepairRequestSchema = z.object({
  reason: z.string().trim()
    .min(RESOURCE_FRESHNESS_REPAIR_REASON_MIN_LENGTH)
    .max(RESOURCE_FRESHNESS_REPAIR_REASON_MAX_LENGTH),
}).strict();

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid submission ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rateLimit = await checkRateLimitShared(`admin:resource-freshness:repair:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rateLimit.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable.' },
      {
        status: 503,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    );
  }
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
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
  const parsed = RepairRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await withTransaction((client) => (
      repairResourceFreshnessPacketInTransaction(client, {
        submissionId: id,
        actorUserId: authCtx.userId,
        actorRole: 'oran_admin',
        reason: parsed.data.reason,
      })
    ));

    if (result.kind === 'conflict') {
      return NextResponse.json(
        { error: 'Resource freshness packet cannot be safely reconstructed' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        id: result.submissionId,
        findingId: result.findingId,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    if (error instanceof ResourceFreshnessRepairConflictError) {
      return NextResponse.json(
        { error: 'Resource freshness packet cannot be safely reconstructed' },
        { status: 409 },
      );
    }
    await captureException(error, { feature: 'api_admin_resource_freshness_repair' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
