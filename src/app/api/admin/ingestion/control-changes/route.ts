import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  DEFAULT_PAGE_SIZE,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import { requireMinRole } from '@/services/auth/guards';
import { getAuthContext } from '@/services/auth/session';
import { isDatabaseConfigured } from '@/services/db/postgres';
import {
  decideIngestionControlChange,
  listPendingIngestionControlChanges,
} from '@/services/ingestion/controlChanges';
import { getIp } from '@/services/security/ip';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';

const ListSchema = z.object({
  status: z.enum(['pending_second_approval', 'approved', 'denied', 'archived']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const DecisionSchema = z.object({
  submissionId: z.string().uuid(),
  decision: z.enum(['approved', 'denied']),
  notes: z.string().trim().max(5_000).optional(),
}).strict();

async function authorizeOranAdmin() {
  const auth = await getAuthContext();
  if (!auth) return { response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  if (!requireMinRole(auth, 'oran_admin')) {
    return { response: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) };
  }
  return { auth };
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }
  const rateLimit = await checkRateLimitShared(
    `admin:ingestion:control-changes:read:${getIp(req)}`,
    {
      maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    },
  );
  if (rateLimit.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      {
        status: 503,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    );
  }
  if (rateLimit.exceeded === true) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const authorization = await authorizeOranAdmin();
  if ('response' in authorization) return authorization.response;

  const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
  const parsed = ListSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters.', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { status, page, limit } = parsed.data;
    const items = await listPendingIngestionControlChanges(status, limit, (page - 1) * limit);
    return NextResponse.json({ items, page, limit });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }
  const rateLimit = await checkRateLimitShared(
    `admin:ingestion:control-changes:write:${getIp(req)}`,
    {
      maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
      windowMs: RATE_LIMIT_WINDOW_MS,
    },
  );
  if (rateLimit.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      {
        status: 503,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    );
  }
  if (rateLimit.exceeded === true) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
      },
    );
  }

  const authorization = await authorizeOranAdmin();
  if ('response' in authorization) return authorization.response;

  try {
    const parsed = DecisionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid decision.', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await decideIngestionControlChange({
      ...parsed.data,
      actorUserId: authorization.auth.userId,
      actorRole: authorization.auth.role,
    });
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
