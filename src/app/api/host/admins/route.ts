/**
 * @file /api/host/admins
 * @description Team Management API - List and invite organization members.
 *
 * Auth Rules:
 * - Only host_admin of the same org OR oran_admin can list/invite members.
 * - Must provide organizationId query param to scope team.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { OranRole } from '@/domain/types';
import { getAuthContext, shouldEnforceAuth, requireOrgRole, isOranAdmin } from '@/services/auth';
import { isDatabaseConfigured, executeQuery, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { getIp } from '@/services/security/ip';
import { captureException } from '@/services/telemetry/sentry';

const RATE_LIMIT_WINDOW_MS = 60_000;
const HOST_READ_RATE_LIMIT_MAX_REQUESTS = 60;
const HOST_WRITE_RATE_LIMIT_MAX_REQUESTS = 20;

// Schema for POST body (invite)
const InviteMemberSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(['host_member', 'host_admin'] as const),
});

interface OrganizationMember {
  id: string;
  user_id: string;
  organization_id: string;
  role: OranRole;
  status: string | null;
  created_at: string;
  updated_at: string | null;
}

/**
 * GET /api/host/admins?organizationId=<uuid>
 * List organization members for a specific org.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:admins:read:${ip}`, {
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

  // Auth check - required for team management
  const auth = await getAuthContext();
  if (shouldEnforceAuth() && !auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Get organizationId from query
  const url = new URL(req.url);
  const organizationId = url.searchParams.get('organizationId');
  if (!organizationId || !z.string().uuid().safeParse(organizationId).success) {
    return NextResponse.json(
      { error: 'organizationId query parameter is required and must be a valid UUID' },
      { status: 400 },
    );
  }

  // Only host_admin of this org or oran_admin can list team
  if (!requireOrgRole(auth, organizationId, 'host_admin') && !isOranAdmin(auth)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Check if organization_members table exists
    const tableCheck = await executeQuery<{ exists: boolean }>(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'organization_members'
      ) as exists`,
      [],
    );

    if (!tableCheck[0]?.exists) {
      // Table doesn't exist yet - return empty list
      return NextResponse.json({ members: [], total: 0 });
    }

    const rows = await executeQuery<OrganizationMember>(
      `SELECT id, user_id, organization_id, role, status, created_at, updated_at
       FROM organization_members
       WHERE organization_id = $1 AND (status IS NULL OR status != 'deactivated')
       ORDER BY created_at DESC`,
      [organizationId],
    );

    return NextResponse.json({
      members: rows,
      total: rows.length,
    });
  } catch (error) {
    await captureException(error, { feature: 'api_host_admins_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/host/admins
 * Invite/add a user to an organization.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:admins:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
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

  // Auth check - required for team management
  const auth = await getAuthContext();
  if (shouldEnforceAuth() && !auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = InviteMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { organizationId, userId, role } = parsed.data;

  // Only host_admin of this org or oran_admin can invite members
  if (!requireOrgRole(auth, organizationId, 'host_admin') && !isOranAdmin(auth)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const result = await withTransaction(async (client) => {
      // Verify organization exists
      const orgCheck = await client.query<{ id: string }>(
        `SELECT id FROM organizations WHERE id = $1 AND (status IS NULL OR status != 'defunct')`,
        [organizationId],
      );
      if (orgCheck.rows.length === 0) {
        return { error: 'Organization not found', status: 404 };
      }

      // Check if user is already a member
      const existingMember = await client.query<{ id: string; status: string | null }>(
        `SELECT id, status FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
        [organizationId, userId],
      );

      if (existingMember.rows.length > 0) {
        const existing = existingMember.rows[0];
        if (existing.status !== 'deactivated') {
          return { error: 'User is already a member of this organization', status: 409 };
        }
        // Reactivate deactivated member
        const reactivated = await client.query<OrganizationMember>(
          `UPDATE organization_members
           SET role = $1, status = NULL, updated_at = NOW()
           WHERE id = $2
           RETURNING id, user_id, organization_id, role, status, created_at, updated_at`,
          [role, existing.id],
        );
        return { member: reactivated.rows[0] };
      }

      // Insert new member
      const inserted = await client.query<OrganizationMember>(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, $3)
         RETURNING id, user_id, organization_id, role, status, created_at, updated_at`,
        [organizationId, userId, role],
      );

      return { member: inserted.rows[0] };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.member, { status: 201 });
  } catch (error) {
    await captureException(error, { feature: 'api_host_admins_invite' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
