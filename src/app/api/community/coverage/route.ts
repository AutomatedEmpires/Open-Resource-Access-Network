/**
 * GET /api/community/coverage — Aggregate verification stats for coverage zone dashboard.
 *
 * Returns counts by status, recent activity, and staleness metrics.
 * No write operations — community admins manage zone assignment via ORAN admin.
 */

import { NextRequest, NextResponse } from 'next/server';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
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
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429 });
  }

  try {
    // 1. Counts by verification status
    const statusCounts = await executeQuery<{ status: string; count: number }>(
      `SELECT status, count(*)::int AS count
       FROM verification_queue
       GROUP BY status
       ORDER BY status`,
      [],
    );

    // 2. Recent activity (last 30 days)
    const recentActivity = await executeQuery<{
      date: string;
      verified: number;
      rejected: number;
      escalated: number;
    }>(
      `SELECT
         to_char(updated_at, 'YYYY-MM-DD') AS date,
         count(*) FILTER (WHERE status = 'verified')::int  AS verified,
         count(*) FILTER (WHERE status = 'rejected')::int  AS rejected,
         count(*) FILTER (WHERE status = 'escalated')::int AS escalated
       FROM verification_queue
       WHERE updated_at >= now() - interval '30 days'
         AND status IN ('verified', 'rejected', 'escalated')
       GROUP BY to_char(updated_at, 'YYYY-MM-DD')
       ORDER BY date DESC
       LIMIT 30`,
      [],
    );

    // 3. Stale entries — pending entries older than 14 days
    const staleRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM verification_queue
       WHERE status = 'pending'
         AND created_at < now() - interval '14 days'`,
      [],
    );

    // 4. Top organizations with pending entries
    const topOrgs = await executeQuery<{
      organization_id: string;
      organization_name: string;
      pending_count: number;
    }>(
      `SELECT o.id AS organization_id, o.name AS organization_name,
              count(*)::int AS pending_count
       FROM verification_queue vq
       JOIN services s ON s.id = vq.service_id
       JOIN organizations o ON o.id = s.organization_id
       WHERE vq.status IN ('pending', 'in_review')
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

    return NextResponse.json(
      {
        summary: {
          pending:   byStatus['pending'] ?? 0,
          inReview:  byStatus['in_review'] ?? 0,
          verified:  byStatus['verified'] ?? 0,
          rejected:  byStatus['rejected'] ?? 0,
          escalated: byStatus['escalated'] ?? 0,
          total:     Object.values(byStatus).reduce((a, b) => a + b, 0),
          stale:     staleRows[0]?.count ?? 0,
        },
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
