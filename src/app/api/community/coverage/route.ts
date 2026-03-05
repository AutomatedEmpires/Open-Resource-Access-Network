/**
 * GET /api/community/coverage — Aggregate submission stats for coverage zone dashboard.
 *
 * Returns counts by status, recent activity, staleness metrics, and SLA breach info.
 * Queries the universal submissions table (migration 0022).
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  RATE_LIMIT_WINDOW_MS,
  COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// HANDLER
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`community:coverage:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rl.retryAfterSeconds) },
      },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    // 1. Counts by submission status
    const statusCounts = await executeQuery<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count
       FROM submissions
       GROUP BY status
       ORDER BY status`,
      [],
    );

    // 2. Counts by submission type
    const typeCounts = await executeQuery<{ submission_type: string; count: number }>(
      `SELECT submission_type, count(*)::int AS count
       FROM submissions
       GROUP BY submission_type
       ORDER BY submission_type`,
      [],
    );

    // 3. Recent activity (last 30 days)
    const recentActivity = await executeQuery<{
      date: string;
      approved: number;
      denied: number;
      escalated: number;
    }>(
      `SELECT
         to_char(updated_at, 'YYYY-MM-DD') AS date,
         count(*) FILTER (WHERE status = 'approved')::int  AS approved,
         count(*) FILTER (WHERE status = 'denied')::int    AS denied,
         count(*) FILTER (WHERE status = 'escalated')::int AS escalated
       FROM submissions
       WHERE updated_at >= now() - interval '30 days'
         AND status IN ('approved', 'denied', 'escalated')
       GROUP BY to_char(updated_at, 'YYYY-MM-DD')
       ORDER BY date DESC
       LIMIT 30`,
      [],
    );

    // 4. Stale entries — submitted entries older than 14 days
    const staleRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM submissions
       WHERE status = 'submitted'
         AND created_at < now() - interval '14 days'`,
      [],
    );

    // 5. SLA breached entries
    const slaBreachedRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM submissions
       WHERE sla_breached = true
         AND status NOT IN ('approved', 'denied', 'withdrawn', 'archived')`,
      [],
    );

    // 6. Top organizations with pending/in-review entries
    const topOrgs = await executeQuery<{
      organization_id: string;
      organization_name: string;
      pending_count: number;
    }>(
      `SELECT o.id AS organization_id, o.name AS organization_name,
              count(*)::int AS pending_count
       FROM submissions sub
       LEFT JOIN services s ON s.id = sub.service_id
       LEFT JOIN organizations o ON o.id = s.organization_id
       WHERE sub.status IN ('submitted', 'under_review', 'pending_second_approval')
         AND o.id IS NOT NULL
       GROUP BY o.id, o.name
       ORDER BY pending_count DESC
       LIMIT 10`,
      [],
    );

    // Build summary
    const byStatus: Record<string, number> = {};
    for (const row of statusCounts) {
      byStatus[row.status] = row.count;
    }

    const byType: Record<string, number> = {};
    for (const row of typeCounts) {
      byType[row.submission_type] = row.count;
    }

    return NextResponse.json(
      {
        summary: {
          submitted:              byStatus['submitted'] ?? 0,
          underReview:            byStatus['under_review'] ?? 0,
          pendingSecondApproval:  byStatus['pending_second_approval'] ?? 0,
          approved:               byStatus['approved'] ?? 0,
          denied:                 byStatus['denied'] ?? 0,
          escalated:              byStatus['escalated'] ?? 0,
          returned:               byStatus['returned'] ?? 0,
          withdrawn:              byStatus['withdrawn'] ?? 0,
          total:                  Object.values(byStatus).reduce((a, b) => a + b, 0),
          stale:                  staleRows[0]?.count ?? 0,
          slaBreached:            slaBreachedRows[0]?.count ?? 0,
        },
        byType,
        recentActivity,
        topOrganizations: topOrgs,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_community_coverage_stats' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
