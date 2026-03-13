/**
 * GET /api/submissions/denied — List the current user's denied submissions.
 *
 * Used by the appeal form to offer a picker of denied submissions
 * so the seeker doesn't need to know the UUID.
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`user:denied:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: 60,
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

  try {
    const submissions = await executeQuery<{
      id: string;
      title: string | null;
      submission_type: string;
      created_at: string;
    }>(
      `SELECT s.id, s.title, s.submission_type, s.created_at
       FROM submissions s
       WHERE s.submitted_by_user_id = $1
         AND s.status = 'denied'
         AND s.submission_type != 'appeal'
         AND NOT EXISTS (
           SELECT 1 FROM submissions a
           WHERE a.submission_type = 'appeal'
             AND a.payload->>'original_submission_id' = s.id
             AND a.status NOT IN ('denied', 'withdrawn', 'archived')
         )
       ORDER BY s.created_at DESC
       LIMIT 50`,
      [authCtx.userId],
    );

    return NextResponse.json(
      { submissions },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_submissions_denied_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
