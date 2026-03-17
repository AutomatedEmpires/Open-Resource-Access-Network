import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import { normalizeResourceSubmissionDraft } from '@/domain/resourceSubmission';
import { isDatabaseConfigured } from '@/services/db/postgres';
import {
  ResourceSubmissionAssistError,
  assistResourceSubmissionFromSource,
} from '@/services/resourceSubmissions/assist';
import {
  getResourceSubmissionDetailForActor,
  getResourceSubmissionDetailForPublic,
  type ResourceSubmissionDetail,
} from '@/services/resourceSubmissions/service';
import { checkRateLimit } from '@/services/security/rateLimit';
import { getAuthContext } from '@/services/auth/session';
import { captureException } from '@/services/telemetry/sentry';
import { getIp } from '@/services/security/ip';

type RouteContext = { params: Promise<{ id: string }> };

const AssistSchema = z.object({
  sourceUrl: z.string().trim().url().max(2000),
  draft: z.unknown().optional(),
}).strict();
function getPublicAccessToken(req: NextRequest): string | null {
  return req.headers.get('x-resource-submission-token')?.trim()
    || req.nextUrl.searchParams.get('token')?.trim()
    || null;
}

async function loadDetail(
  req: NextRequest,
  identifier: string,
): Promise<{ detail: ResourceSubmissionDetail | null }> {
  const authCtx = await getAuthContext();
  if (authCtx) {
    const detail = await getResourceSubmissionDetailForActor(authCtx, identifier);
    if (detail) {
      return { detail };
    }
  }

  const token = getPublicAccessToken(req);
  if (!token) {
    return { detail: null };
  }

  return {
    detail: await getResourceSubmissionDetailForPublic(identifier, token),
  };
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid resource submission ID' }, { status: 400 });
  }

  const rl = checkRateLimit(`resource-submissions:item:assist:${getIp(req)}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = AssistSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { detail } = await loadDetail(req, id);
    if (!detail) {
      return NextResponse.json({ error: 'Resource submission not found.' }, { status: 404 });
    }

    const workingDraft = normalizeResourceSubmissionDraft(
      parsed.data.draft ?? detail.draft,
      detail.draft.variant,
      detail.draft.channel,
    );
    const assist = await assistResourceSubmissionFromSource({
      draft: workingDraft,
      sourceUrl: parsed.data.sourceUrl,
    });

    return NextResponse.json({ assist }, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof ResourceSubmissionAssistError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    await captureException(error, { feature: 'api_resource_submissions_assist' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
