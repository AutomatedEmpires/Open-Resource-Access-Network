import { NextRequest, NextResponse } from 'next/server';

import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getIp } from '@/services/security/ip';
import {
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const rl = await checkRateLimitShared(`admin:operations:read:${getIp(req)}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } });
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    const [summaryRows, recentActivity] = await Promise.all([
      executeQuery<{
        approvals_pending: number;
        appeals_open: number;
        reports_open: number;
        high_risk_reports_open: number;
        scopes_pending: number;
        integrity_held_services: number;
      }>(
        `SELECT
           (SELECT COUNT(*)::int FROM submissions
             WHERE submission_type IN ('org_claim', 'removal_request', 'managed_form')
               AND status IN ('submitted', 'under_review', 'pending_second_approval')) AS approvals_pending,
           (SELECT COUNT(*)::int FROM submissions
             WHERE submission_type = 'appeal'
               AND status IN ('submitted', 'under_review', 'returned')) AS appeals_open,
           (SELECT COUNT(*)::int FROM submissions
             WHERE submission_type = 'community_report'
               AND status IN ('submitted', 'under_review', 'escalated', 'returned')) AS reports_open,
           (SELECT COUNT(*)::int FROM submissions
             WHERE submission_type = 'community_report'
               AND status IN ('submitted', 'under_review', 'escalated', 'returned')
               AND payload->>'reason' = 'suspected_fraud') AS high_risk_reports_open,
           (SELECT COUNT(*)::int FROM pending_scope_grants WHERE status = 'pending') AS scopes_pending,
           (SELECT COUNT(*)::int FROM services WHERE integrity_hold_at IS NOT NULL AND status = 'active') AS integrity_held_services`,
        [],
      ),
      executeQuery<{
        id: string;
        submission_type: string;
        status: string;
        title: string | null;
        updated_at: string;
      }>(
        `SELECT id, submission_type, status, title, updated_at
         FROM submissions
         WHERE submission_type IN ('org_claim', 'removal_request', 'managed_form', 'appeal', 'community_report')
         ORDER BY updated_at DESC
         LIMIT 8`,
        [],
      ),
    ]);

    return NextResponse.json(
      {
        summary: summaryRows[0] ?? {
          approvals_pending: 0,
          appeals_open: 0,
          reports_open: 0,
          high_risk_reports_open: 0,
          scopes_pending: 0,
          integrity_held_services: 0,
        },
        recentActivity,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_operations_summary' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
