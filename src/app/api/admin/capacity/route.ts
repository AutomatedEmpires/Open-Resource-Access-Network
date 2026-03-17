/**
 * GET /api/admin/capacity
 *
 * Returns the requesting admin's capacity dashboard: current queue counts,
 * effective limits (with auto-scaling), performance metrics, and coverage zone.
 *
 * Accessible to community_admin and above.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isDatabaseConfigured, executeQuery } from '@/services/db/postgres';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { captureException } from '@/services/telemetry/sentry';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import { getIp } from '@/services/security/ip';
import {
  computeEffectiveMaxPending,
  type AdminCapacity,
} from '@/agents/ingestion/routing';

// ============================================================
// TYPES
// ============================================================

interface CapacityDashboard {
  userId: string;
  pendingCount: number;
  inReviewCount: number;
  maxPending: number;
  effectiveMaxPending: number;
  maxInReview: number;
  totalVerified: number;
  totalRejected: number;
  avgReviewHours: number | null;
  lastReviewAt: string | null;
  coverageStates: string[];
  coverageCounties: string[];
  isActive: boolean;
  isAcceptingNew: boolean;
  scalingApplied: boolean;
}

// ============================================================
// HANDLER
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const authCtx = await getAuthContext();
  if (!authCtx || !requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const ip = getIp(req);
  const rateLimit = await checkRateLimitShared(`admin_capacity:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rateLimit.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } },
    );
  }

  try {
    const rows = await executeQuery<{
      id: string;
      user_id: string;
      pending_count: number;
      in_review_count: number;
      max_pending: number;
      max_in_review: number;
      total_verified: number;
      total_rejected: number;
      avg_review_hours: number | null;
      last_review_at: string | null;
      coverage_states: string[];
      coverage_counties: string[];
      coverage_zone_id: string | null;
      is_active: boolean;
      is_accepting_new: boolean;
    }>(
      `SELECT
         id, user_id, pending_count, in_review_count,
         max_pending, max_in_review,
         total_verified, total_rejected,
         avg_review_hours, last_review_at,
         coverage_states, coverage_counties,
         coverage_zone_id,
         is_active, is_accepting_new
       FROM admin_review_profiles
       WHERE user_id = $1`,
      [authCtx.userId],
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No admin review profile found for this user.' },
        { status: 404 },
      );
    }

    const row = rows[0];

    // Build AdminCapacity for scaling calculation
    const adminCapacity: AdminCapacity = {
      id: row.id,
      userId: row.user_id,
      pendingCount: row.pending_count,
      inReviewCount: row.in_review_count,
      maxPending: row.max_pending,
      maxInReview: row.max_in_review,
      totalVerified: row.total_verified,
      totalRejected: row.total_rejected,
      avgReviewHours: row.avg_review_hours,
      lastReviewAt: row.last_review_at ? new Date(row.last_review_at) : null,
      coverageZoneId: row.coverage_zone_id,
      coverageStates: row.coverage_states ?? [],
      coverageCounties: row.coverage_counties ?? [],
      isActive: row.is_active,
      isAcceptingNew: row.is_accepting_new,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const effectiveMax = computeEffectiveMaxPending(adminCapacity);

    const dashboard: CapacityDashboard = {
      userId: row.user_id,
      pendingCount: row.pending_count,
      inReviewCount: row.in_review_count,
      maxPending: row.max_pending,
      effectiveMaxPending: effectiveMax,
      maxInReview: row.max_in_review,
      totalVerified: row.total_verified,
      totalRejected: row.total_rejected,
      avgReviewHours: row.avg_review_hours,
      lastReviewAt: row.last_review_at,
      coverageStates: row.coverage_states ?? [],
      coverageCounties: row.coverage_counties ?? [],
      isActive: row.is_active,
      isAcceptingNew: row.is_accepting_new,
      scalingApplied: effectiveMax !== row.max_pending,
    };

    return NextResponse.json(dashboard, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    await captureException(error, { feature: 'admin_capacity_dashboard' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
