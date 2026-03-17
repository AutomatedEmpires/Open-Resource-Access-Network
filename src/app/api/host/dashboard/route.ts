import { NextRequest, NextResponse } from 'next/server';

import { getAuthContext, isOranAdmin, shouldEnforceAuth } from '@/services/auth';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getIp } from '@/services/security/ip';
import {
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';

interface DashboardSummary {
  organizations: number;
  incompleteOrganizations: number;
  services: number;
  staleServices: number;
  locations: number;
  staleLocations: number;
  teamMembers: number;
  pendingInvites: number;
  pendingReviews: number;
  claimsInFlight: number;
}

interface RecentSubmission {
  id: string;
  title: string | null;
  submission_type: string;
  status: string;
  organization_name: string | null;
  created_at: string;
}
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const authCtx = await getAuthContext();
  if (!authCtx && shouldEnforceAuth()) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:dashboard:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
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

  try {
    const orgIds = authCtx?.orgIds ?? [];
    const isAdmin = authCtx ? isOranAdmin(authCtx) : false;

    if (!isAdmin && orgIds.length === 0) {
      return NextResponse.json(
        {
          summary: {
            organizations: 0,
            incompleteOrganizations: 0,
            services: 0,
            staleServices: 0,
            locations: 0,
            staleLocations: 0,
            teamMembers: 0,
            pendingInvites: 0,
            pendingReviews: 0,
            claimsInFlight: 0,
          } satisfies DashboardSummary,
          recentSubmissions: [] satisfies RecentSubmission[],
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const orgFilter = isAdmin ? '' : 'WHERE o.id = ANY($1::uuid[])';
    const serviceFilter = isAdmin ? "WHERE s.status != 'defunct'" : "WHERE s.organization_id = ANY($1::uuid[]) AND s.status != 'defunct'";
    const locationFilter = isAdmin ? '' : 'WHERE l.organization_id = ANY($1::uuid[])';

    const organizationRows = await executeQuery<{ total: number; incomplete: number }>(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (
           WHERE coalesce(o.description, '') = ''
              OR coalesce(o.url, '') = ''
              OR coalesce(o.email, '') = ''
         )::int AS incomplete
       FROM organizations o
       ${orgFilter}`,
      isAdmin ? [] : [orgIds],
    );

    const serviceRows = await executeQuery<{ total: number; stale: number }>(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE s.updated_at < now() - interval '90 days')::int AS stale
       FROM services s
       ${serviceFilter}`,
      isAdmin ? [] : [orgIds],
    );

    const locationRows = await executeQuery<{ total: number; stale: number }>(
      `SELECT
         count(*)::int AS total,
         count(*) FILTER (WHERE l.updated_at < now() - interval '90 days')::int AS stale
       FROM locations l
       ${locationFilter}`,
      isAdmin ? [] : [orgIds],
    );

    const membershipTableRows = await executeQuery<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'organization_members'
       ) AS exists`,
      [],
    );

    let teamMembers = 0;
    let pendingInvites = 0;

    if (membershipTableRows[0]?.exists) {
      const teamRows = await executeQuery<{ total: number; pending: number }>(
        `SELECT
           count(*) FILTER (WHERE coalesce(om.status, 'active') != 'deactivated')::int AS total,
           count(*) FILTER (WHERE om.status = 'pending')::int AS pending
         FROM organization_members om
         ${isAdmin ? '' : 'WHERE om.organization_id = ANY($1::uuid[])'}`,
        isAdmin ? [] : [orgIds],
      );
      teamMembers = teamRows[0]?.total ?? 0;
      pendingInvites = teamRows[0]?.pending ?? 0;
    }

    const submissionScopeClause = isAdmin
      ? `sub.status IN ('submitted', 'under_review', 'pending_second_approval')`
      : `(sub.submitted_by_user_id = $2 OR s.organization_id = ANY($1::uuid[]) OR (sub.submission_type = 'org_claim' AND sub.target_id = ANY($1::uuid[])))
         AND sub.status IN ('submitted', 'under_review', 'pending_second_approval')`;
    const submissionScopeParams = isAdmin ? [] : [orgIds, authCtx?.userId ?? null];

    const pendingRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM submissions sub
       LEFT JOIN services s ON s.id = sub.service_id
       WHERE ${submissionScopeClause}`,
      submissionScopeParams,
    );

    const claimsRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM submissions sub
       WHERE sub.submission_type = 'org_claim'
         AND sub.status NOT IN ('approved', 'denied', 'withdrawn', 'archived')
         AND ${isAdmin ? 'true' : '(sub.submitted_by_user_id = $1 OR sub.target_id = ANY($2::uuid[]))'}`,
      isAdmin ? [] : [authCtx?.userId ?? null, orgIds],
    );

    const recentSubmissions = await executeQuery<RecentSubmission>(
      `SELECT
         sub.id,
         sub.title,
         sub.submission_type,
         sub.status,
         o.name AS organization_name,
         sub.created_at
       FROM submissions sub
       LEFT JOIN services s ON s.id = sub.service_id
       LEFT JOIN organizations o ON o.id = coalesce(s.organization_id, sub.target_id::uuid)
       WHERE ${submissionScopeClause}
       ORDER BY sub.created_at DESC
       LIMIT 5`,
      submissionScopeParams,
    );

    return NextResponse.json(
      {
        summary: {
          organizations: organizationRows[0]?.total ?? 0,
          incompleteOrganizations: organizationRows[0]?.incomplete ?? 0,
          services: serviceRows[0]?.total ?? 0,
          staleServices: serviceRows[0]?.stale ?? 0,
          locations: locationRows[0]?.total ?? 0,
          staleLocations: locationRows[0]?.stale ?? 0,
          teamMembers,
          pendingInvites,
          pendingReviews: pendingRows[0]?.count ?? 0,
          claimsInFlight: claimsRows[0]?.count ?? 0,
        } satisfies DashboardSummary,
        recentSubmissions,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_host_dashboard' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
