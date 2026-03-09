import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { bulkUpdateInstanceStatus } from '@/services/forms/vault';
import {
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';

const BulkActionSchema = z.object({
  instanceIds: z.array(z.string().uuid()).min(1).max(50),
  action: z.enum(['approve', 'deny', 'return']),
  reviewerNotes: z.string().max(5000).nullable().optional(),
}).superRefine((value, ctx) => {
  if ((value.action === 'deny' || value.action === 'return') && !value.reviewerNotes?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewerNotes'],
      message: 'Reviewer notes are required when denying or returning forms',
    });
  }
});

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`forms:bulk:write:${ip}`, {
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
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = BulkActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const results = await bulkUpdateInstanceStatus(
      authCtx,
      parsed.data.instanceIds,
      parsed.data.action,
      parsed.data.reviewerNotes ?? null,
    );

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    return NextResponse.json({
      results,
      summary: { total: results.length, succeeded: successCount, failed: failureCount },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_instances_bulk' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
