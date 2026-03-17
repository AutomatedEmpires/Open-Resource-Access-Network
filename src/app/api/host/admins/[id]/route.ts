/**
 * @file /api/host/admins/[id]
 * @description Team Management API - Update role or remove organization members.
 *
 * Auth Rules:
 * - Only host_admin of the same org OR oran_admin can modify/remove members.
 * - Cannot remove the last host_admin from an organization.
 * - DELETE uses soft-delete (status='deactivated').
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
const HOST_WRITE_RATE_LIMIT_MAX_REQUESTS = 20;

type RouteContext = { params: Promise<{ id: string }> };

// Schema for PUT body (update role)
const UpdateMemberSchema = z.object({
  role: z.enum(['host_member', 'host_admin'] as const),
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

/**
 * GET /api/host/admins/[id]
 * Get a specific organization member by ID.
 */
export async function GET(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid member ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:admins:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: 60,
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

  // Auth check
  const auth = await getAuthContext();
  if (shouldEnforceAuth() && !auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const rows = await executeQuery<OrganizationMember>(
      `SELECT id, user_id, organization_id, role, status, created_at, updated_at
       FROM organization_members
       WHERE id = $1 AND (status IS NULL OR status != 'deactivated')`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    const member = rows[0];

    // Only host_admin of this org or oran_admin can view member details
    if (!requireOrgRole(auth, member.organization_id, 'host_admin') && !isOranAdmin(auth)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.json(member);
  } catch (error) {
    await captureException(error, { feature: 'api_host_admins_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PUT /api/host/admins/[id]
 * Update a member's role.
 */
export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid member ID' }, { status: 400 });
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

  // Auth check
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

  const parsed = UpdateMemberSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { role: newRole } = parsed.data;

  try {
    const result = await withTransaction(async (client) => {
      // Get existing member
      const memberResult = await client.query<OrganizationMember>(
        `SELECT id, user_id, organization_id, role, status, created_at, updated_at
         FROM organization_members
         WHERE id = $1 AND (status IS NULL OR status != 'deactivated')`,
        [id],
      );

      if (memberResult.rows.length === 0) {
        return { error: 'Member not found', status: 404 };
      }

      const member = memberResult.rows[0];

      // Only host_admin of this org or oran_admin can update roles
      if (!requireOrgRole(auth, member.organization_id, 'host_admin') && !isOranAdmin(auth)) {
        return { error: 'Forbidden', status: 403 };
      }

      // If demoting from host_admin, ensure there's at least one other host_admin
      if (member.role === 'host_admin' && newRole !== 'host_admin') {
        const adminCount = await client.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM organization_members
           WHERE organization_id = $1 AND role = 'host_admin' AND (status IS NULL OR status != 'deactivated')`,
          [member.organization_id],
        );

        if (parseInt(adminCount.rows[0].count, 10) <= 1) {
          return { error: 'Cannot demote the last host_admin of an organization', status: 400 };
        }
      }

      // Update role
      const updated = await client.query<OrganizationMember>(
        `UPDATE organization_members
         SET role = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, user_id, organization_id, role, status, created_at, updated_at`,
        [newRole, id],
      );

      return { member: updated.rows[0] };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.member);
  } catch (error) {
    await captureException(error, { feature: 'api_host_admins_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/host/admins/[id]
 * Soft-delete a member (set status='deactivated').
 */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid member ID' }, { status: 400 });
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

  // Auth check
  const auth = await getAuthContext();
  if (shouldEnforceAuth() && !auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!auth) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const result = await withTransaction(async (client) => {
      // Get existing member
      const memberResult = await client.query<OrganizationMember>(
        `SELECT id, user_id, organization_id, role, status, created_at, updated_at
         FROM organization_members
         WHERE id = $1 AND (status IS NULL OR status != 'deactivated')`,
        [id],
      );

      if (memberResult.rows.length === 0) {
        return { error: 'Member not found', status: 404 };
      }

      const member = memberResult.rows[0];

      // Only host_admin of this org or oran_admin can remove members
      if (!requireOrgRole(auth, member.organization_id, 'host_admin') && !isOranAdmin(auth)) {
        return { error: 'Forbidden', status: 403 };
      }

      // If removing a host_admin, ensure there's at least one other host_admin
      if (member.role === 'host_admin') {
        const adminCount = await client.query<{ count: string }>(
          `SELECT COUNT(*) as count FROM organization_members
           WHERE organization_id = $1 AND role = 'host_admin' AND (status IS NULL OR status != 'deactivated')`,
          [member.organization_id],
        );

        if (parseInt(adminCount.rows[0].count, 10) <= 1) {
          return { error: 'Cannot remove the last host_admin of an organization', status: 400 };
        }
      }

      // Soft-delete: set status to 'deactivated'
      await client.query(
        `UPDATE organization_members SET status = 'deactivated', updated_at = NOW() WHERE id = $1`,
        [id],
      );

      return { deleted: true, id };
    });

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ deleted: true, id: result.id });
  } catch (error) {
    await captureException(error, { feature: 'api_host_admins_delete' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
