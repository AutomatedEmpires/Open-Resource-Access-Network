import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { getFormAnalytics } from '@/services/forms/vault';
import {
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';

/**
 * GET /api/forms/analytics
 *
 * Returns aggregate analytics for form instances visible to the caller.
 * Optional query param: templateId — scope to a specific template.
 *
 * Available to community_admin+ roles.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(ctx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const rl = checkRateLimit(`forms_analytics:${ctx.userId}`, {
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const templateId = req.nextUrl.searchParams.get('templateId') ?? undefined;

  try {
    const analytics = await getFormAnalytics(ctx, templateId);
    return NextResponse.json({ analytics }, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_analytics' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
