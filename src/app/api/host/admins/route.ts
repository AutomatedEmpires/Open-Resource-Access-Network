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
import { send as sendNotification } from '@/services/notifications/service';

const RATE_LIMIT_WINDOW_MS = 60_000;
const HOST_READ_RATE_LIMIT_MAX_REQUESTS = 60;
const HOST_WRITE_RATE_LIMIT_MAX_REQUESTS = 20;

// Schema for POST body (invite) — accepts userId OR email (at least one required)
const InviteMemberSchema = z.object({
  organizationId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  email: z.string().email().max(320).optional(),
  role: z.enum(['host_member', 'host_admin'] as const),
  inviteMode: z.boolean().default(false),
}).strict().refine(
  (data) => data.userId || data.email,
  { message: 'Either userId or email must be provided' },
);

// Schema for PATCH body (accept/decline invite)
const InviteResponseSchema = z.object({
  membershipId: z.string().uuid(),
  action: z.enum(['accept', 'decline']),
}).strict();

interface OrganizationMember {
  id: string;
  user_id: string;
  organization_id: string;
  role: OranRole;
  status: string | null;
  created_at: string;
  updated_at: string | null;
}

interface UserSecurityRow {
  user_id: string;
  account_status: 'active' | 'frozen' | null;
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

  const { organizationId, role, inviteMode } = parsed.data;
  let { userId } = parsed.data;
  const { email } = parsed.data;

  // Only host_admin of this org or oran_admin can invite members
  if (!requireOrgRole(auth, organizationId, 'host_admin') && !isOranAdmin(auth)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Resolve email to userId if only email was provided
    if (!userId && email) {
      const userRows = await executeQuery<{ user_id: string }>(
        `SELECT user_id FROM user_profiles WHERE email = $1 LIMIT 1`,
        [email],
      );
      if (userRows.length === 0) {
        return NextResponse.json(
          { error: 'No user found with that email address' },
          { status: 404 },
        );
      }
      userId = userRows[0].user_id;
    }

    if (!userId) {
      return NextResponse.json({ error: 'Could not resolve user' }, { status: 400 });
    }

    const result = await withTransaction(async (client) => {
      // Verify organization exists
      const orgCheck = await client.query<{ id: string }>(
        `SELECT id FROM organizations WHERE id = $1 AND (status IS NULL OR status != 'defunct')`,
        [organizationId],
      );
      if (orgCheck.rows.length === 0) {
        return { error: 'Organization not found', status: 404 };
      }

      const userSecurity = await client.query<UserSecurityRow>(
        `SELECT user_id, account_status
         FROM user_profiles
         WHERE user_id = $1
         LIMIT 1`,
        [userId],
      );

      if ((userSecurity.rows[0]?.account_status ?? 'active') === 'frozen') {
        return { error: 'Cannot invite or restore access for a frozen account', status: 409 };
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

      // Insert new member (pending_invite if inviteMode, otherwise active immediately)
      const memberStatus = inviteMode ? 'pending_invite' : null;
      const inserted = await client.query<OrganizationMember>(
        `INSERT INTO organization_members (organization_id, user_id, role, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, organization_id, role, status, created_at, updated_at`,
        [organizationId, userId, role, memberStatus],
      );

      return { member: inserted.rows[0] };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Send invite notification to the invited user
    if (inviteMode && result.member) {
      const orgRows = await executeQuery<{ name: string }>(
        `SELECT name FROM organizations WHERE id = $1`,
        [organizationId],
      );
      const orgName = orgRows[0]?.name ?? 'an organization';
      await sendNotification({
        recipientUserId: result.member.user_id,
        eventType: 'system_alert',
        title: `You've been invited to join ${orgName}`,
        body: `You have been invited as ${role.replace('_', ' ')} for ${orgName}. Visit your invitations page to accept or decline.`,
        resourceType: 'organization',
        resourceId: organizationId,
        actionUrl: '/invitations',
      }).catch(() => { /* best-effort */ });
    }

    return NextResponse.json(result.member, { status: 201 });
  } catch (error) {
    await captureException(error, { feature: 'api_host_admins_invite' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/host/admins
 * Accept or decline an organization invite. The invited user themselves
 * calls this endpoint — they can only act on their own pending invites.
 */
export async function PATCH(req: NextRequest) {
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
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

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

  const parsed = InviteResponseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { membershipId, action } = parsed.data;

  try {
    // Only allow the invited user to accept/decline their own invite
    const newStatus = action === 'accept' ? null : 'declined';
    const result = await executeQuery<OrganizationMember>(
      `UPDATE organization_members
       SET status = $1, updated_at = NOW()
       WHERE id = $2 AND user_id = $3 AND status = 'pending_invite'
       RETURNING id, user_id, organization_id, role, status, created_at, updated_at`,
      [newStatus, membershipId, auth.userId],
    );

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Invite not found or already actioned' },
        { status: 404 },
      );
    }

    return NextResponse.json(result[0]);
  } catch (error) {
    await captureException(error, { feature: 'api_host_admins_respond_invite' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
