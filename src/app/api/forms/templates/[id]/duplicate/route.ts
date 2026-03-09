import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { duplicateFormTemplate } from '@/services/forms/vault';
import {
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';

type RouteContext = { params: Promise<{ id: string }> };

const DuplicateSchema = z.object({
  newSlug: z.string().min(3).max(120).regex(/^[a-z0-9-]+$/),
});

/**
 * POST /api/forms/templates/[id]/duplicate
 *
 * Duplicates an existing template with a new slug.
 * Creates an unpublished copy. Only oran_admin can duplicate.
 */
export async function POST(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid template ID' }, { status: 400 });
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const rl = checkRateLimit(`forms_template_dup:${authCtx.userId}`, {
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = DuplicateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const template = await duplicateFormTemplate(id, parsed.data.newSlug, authCtx.userId);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Source template not found.') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    await captureException(error, { feature: 'api_forms_templates_duplicate' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
