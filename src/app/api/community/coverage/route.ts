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
import { buildCommunitySubmissionScope, getCommunityAdminScope } from '@/services/community/scope';
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
    const scope = await getCommunityAdminScope(authCtx.userId);

    // 1. Counts by submission status
    const statusParams: unknown[] = [];
    const statusScope = buildCommunitySubmissionScope('sub', scope, statusParams);
    const statusWhere = statusScope ? `WHERE ${statusScope}` : '';
    const statusCounts = await executeQuery<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count
       FROM submissions sub
       ${statusWhere}
       GROUP BY status
       ORDER BY status`,
      statusParams,
    );

    // 2. Counts by submission type
    const typeParams: unknown[] = [];
    const typeScope = buildCommunitySubmissionScope('sub', scope, typeParams);
    const typeWhere = typeScope ? `WHERE ${typeScope}` : '';
    const typeCounts = await executeQuery<{ submission_type: string; count: number }>(
      `SELECT submission_type, count(*)::int AS count
       FROM submissions sub
       ${typeWhere}
       GROUP BY submission_type
       ORDER BY submission_type`,
      typeParams,
    );

    // 3. Recent activity (last 30 days)
    const recentParams: unknown[] = [];
    const recentScope = buildCommunitySubmissionScope('sub', scope, recentParams);
    const recentWhere = [
      recentScope,
      `sub.updated_at >= now() - interval '30 days'`,
      `sub.status IN ('approved', 'denied', 'escalated')`,
    ].filter(Boolean).join(' AND ');
    const recentActivity = await executeQuery<{
      date: string;
      approved: number;
      denied: number;
      escalated: number;
    }>(
      `SELECT
         to_char(sub.updated_at, 'YYYY-MM-DD') AS date,
         count(*) FILTER (WHERE sub.status = 'approved')::int  AS approved,
         count(*) FILTER (WHERE sub.status = 'denied')::int    AS denied,
         count(*) FILTER (WHERE sub.status = 'escalated')::int AS escalated
       FROM submissions sub
       WHERE ${recentWhere}
       GROUP BY to_char(sub.updated_at, 'YYYY-MM-DD')
       ORDER BY date DESC
       LIMIT 30`,
      recentParams,
    );

    // 4. Stale entries — submitted entries older than 14 days
    const staleParams: unknown[] = [];
    const staleScope = buildCommunitySubmissionScope('sub', scope, staleParams);
    const staleWhere = [
      staleScope,
      `sub.status = 'submitted'`,
      `sub.created_at < now() - interval '14 days'`,
    ].filter(Boolean).join(' AND ');
    const staleRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM submissions sub
       WHERE ${staleWhere}`,
      staleParams,
    );

    // 5. SLA breached entries
    const slaParams: unknown[] = [];
    const slaScope = buildCommunitySubmissionScope('sub', scope, slaParams);
    const slaWhere = [
      slaScope,
      `sub.sla_breached = true`,
      `sub.status NOT IN ('approved', 'denied', 'withdrawn', 'archived')`,
    ].filter(Boolean).join(' AND ');
    const slaBreachedRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM submissions sub
       WHERE ${slaWhere}`,
      slaParams,
    );

    // 6. Top organizations with pending/in-review entries
    const topOrgParams: unknown[] = [];
    const topOrgScope = buildCommunitySubmissionScope('sub', scope, topOrgParams);
    const topOrgWhere = [
      topOrgScope,
      `sub.status IN ('submitted', 'under_review', 'pending_second_approval')`,
      `o.id IS NOT NULL`,
    ].filter(Boolean).join(' AND ');
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
       WHERE ${topOrgWhere}
       GROUP BY o.id, o.name
       ORDER BY pending_count DESC
       LIMIT 10`,
      topOrgParams,
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
        zone: {
          id: scope.coverageZoneId,
          name: scope.coverageZoneName,
          description: scope.coverageZoneDescription,
          states: scope.coverageStates,
          counties: scope.coverageCounties,
          hasGeometry: scope.hasGeometry,
          hasExplicitScope: scope.hasExplicitScope,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_community_coverage_stats' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
