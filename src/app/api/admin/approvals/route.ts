/**
 * GET  /api/admin/approvals — List pending organization claims.
 * POST /api/admin/approvals — Approve or deny a claim.
 *
 * ORAN-admin only. Lists submissions with submission_type='org_claim'.
 * POST uses WorkflowEngine to advance the submission and (on approve) activates the organization.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
  advanceInTransaction,
  sendTerminalStatusEmail,
} from '@/services/workflow/engine';
import {
  acquireAuthoritativeMutationGatesShared,
  assertAuthoritativeEntitiesMutable,
  ProtectedAuthoritativeMutationConflict,
} from '@/services/publication/protectedAuthoritativeMutation';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';
import { getIp } from '@/services/security/ip';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  status: z
    .enum(['submitted', 'under_review', 'approved', 'denied', 'escalated', 'pending_second_approval'])
    .optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const DecisionSchema = z.object({
  submissionId: z.string().uuid('submissionId must be a valid UUID'),
  decision:     z.enum(['approved', 'denied'], {
    message: 'decision must be approved or denied',
  }),
  notes:        z.string().max(5000).optional(),
}).strict();

// ============================================================
// HELPERS
// ============================================================
// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:approvals:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
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
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => { raw[k] = v; });
  const parsed = ListParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { status, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  try {
    const conditions: string[] = [`sub.submission_type = 'org_claim'`];
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      conditions.push(`sub.status = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;

    const countRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count FROM submissions sub ${where}`,
      params,
    );
    const total = countRows[0]?.count ?? 0;

    params.push(limit, offset);
    const rows = await executeQuery<{
      id: string;
      service_id: string | null;
      status: string;
      submission_type: string;
      submitted_by_user_id: string;
      assigned_to_user_id: string | null;
      title: string | null;
      notes: string | null;
      reviewer_notes: string | null;
      priority: number;
      is_locked: boolean;
      sla_deadline: string | null;
      sla_breached: boolean;
      created_at: string;
      updated_at: string;
      service_name: string | null;
      organization_id: string | null;
      organization_name: string | null;
      organization_url: string | null;
      organization_email: string | null;
      organization_phone: string | null;
    }>(
      `SELECT sub.id, sub.service_id, sub.status, sub.submission_type,
              sub.submitted_by_user_id, sub.assigned_to_user_id,
              sub.title, sub.notes, sub.reviewer_notes,
              sub.priority, sub.is_locked, sub.sla_deadline, sub.sla_breached,
              sub.created_at, sub.updated_at,
              s.name AS service_name,
              o.id AS organization_id, o.name AS organization_name,
              o.url AS organization_url, o.email AS organization_email,
              o.phone AS organization_phone
       FROM submissions sub
       LEFT JOIN services s ON s.id = sub.service_id
       LEFT JOIN organizations o ON o.id = s.organization_id
       ${where}
       ORDER BY sub.priority DESC, sub.created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_approvals_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`admin:approvals:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
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
  if (!requireMinRole(authCtx, 'oran_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { submissionId, decision, notes } = parsed.data;

  try {
    const atomicResult = await withTransaction(async (client) => {
      // Global order: publication gate before submission/entity row locks.
      // A completed merge permanently retires the source identity, so an
      // approval that arrives afterward must not reactivate it.
      await acquireAuthoritativeMutationGatesShared(client);

      // Establish the resource type under a row lock before changing the
      // workflow lock, reviewer notes, status, or any live projection. A UUID
      // from another submission lane must be indistinguishable from a miss.
      const claimRows = await client.query<{
        service_id: string | null;
        target_id: string | null;
        submitted_by_user_id: string;
        account_status: 'active' | 'frozen' | null;
      }>(
        `SELECT sub.service_id, sub.target_id, sub.submitted_by_user_id,
                up.account_status
         FROM submissions sub
         LEFT JOIN user_profiles up ON up.user_id = sub.submitted_by_user_id
         WHERE sub.id = $1
           AND sub.submission_type = 'org_claim'
         FOR UPDATE OF sub`,
        [submissionId],
      );
      const claim = claimRows.rows[0];
      if (!claim) return { kind: 'not_found' } as const;

      if (decision === 'approved' && (claim.account_status ?? 'active') !== 'active') {
        return { kind: 'frozen_submitter' } as const;
      }

      if (decision === 'approved') {
        await assertAuthoritativeEntitiesMutable(client, {
          organizationIds: [claim.target_id],
          serviceIds: [claim.service_id],
        });
      }

      // Standard live-entity row order is organization -> service.
      if (decision === 'approved' && claim.target_id) {
        const organizationRows = await client.query<{ id: string; status: string | null }>(
          `SELECT id, status
           FROM organizations
           WHERE id = $1
           FOR UPDATE`,
          [claim.target_id],
        );
        if (!organizationRows.rows[0] || organizationRows.rows[0].status === 'defunct') {
          return { kind: 'retired_projection' } as const;
        }
      }

      if (decision === 'approved' && claim.service_id) {
        const serviceRows = await client.query<{
          id: string;
          status: string | null;
          integrity_hold_at: string | null;
        }>(
          `SELECT id, status, integrity_hold_at
           FROM services
           WHERE id = $1
           FOR UPDATE`,
          [claim.service_id],
        );
        const service = serviceRows.rows[0];
        if (!service || service.status === 'defunct' || service.integrity_hold_at) {
          return { kind: 'retired_projection' } as const;
        }
      }

      const lockRows = await client.query<{ id: string }>(
        `UPDATE submissions
         SET is_locked = true, locked_at = NOW(), locked_by_user_id = $1,
             updated_at = NOW()
         WHERE id = $2
           AND submission_type = 'org_claim'
           AND (is_locked = false OR locked_by_user_id = $1)
         RETURNING id`,
        [authCtx.userId, submissionId],
      );
      if (lockRows.rows.length === 0) return { kind: 'locked' } as const;

      if (notes) {
        await client.query(
          `UPDATE submissions
           SET reviewer_notes = $1, updated_at = NOW()
           WHERE id = $2 AND submission_type = 'org_claim'`,
          [notes, submissionId],
        );
      }

      const result = await advanceInTransaction(client, {
        submissionId,
        toStatus: decision as SubmissionStatus,
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: notes ?? `Admin decision: ${decision}`,
      });

      if (!result.success) {
        await client.query(
          `UPDATE submissions
           SET is_locked = false, locked_at = NULL, locked_by_user_id = NULL,
               updated_at = NOW()
           WHERE id = $1
             AND submission_type = 'org_claim'
             AND locked_by_user_id = $2`,
          [submissionId, authCtx.userId],
        );
        return { kind: 'transition_failed', result } as const;
      }

      // Workflow and live projections share this transaction. Any projection
      // error rolls the terminal decision and its audit transition back too.
      if (decision === 'approved') {
        if (claim.target_id && claim.submitted_by_user_id) {
          await client.query(
            `INSERT INTO organization_members (organization_id, user_id, role, status)
             VALUES ($1, $2, 'host_admin', 'active')
             ON CONFLICT (organization_id, user_id) DO UPDATE
               SET role = 'host_admin', status = 'active', updated_at = NOW()`,
            [claim.target_id, claim.submitted_by_user_id],
          );

          await client.query(
            `UPDATE user_profiles
             SET role = 'host_admin', updated_at = NOW()
             WHERE user_id = $1
               AND role IN ('seeker', 'host_member')`,
            [claim.submitted_by_user_id],
          );

          await client.query(
            `INSERT INTO user_profiles (user_id, role)
             VALUES ($1, 'host_admin')
             ON CONFLICT (user_id) DO NOTHING`,
            [claim.submitted_by_user_id],
          );
        }
      }

      return { kind: 'success', result } as const;
    });

    if (atomicResult.kind === 'not_found') {
      return NextResponse.json({ error: 'Organization claim not found' }, { status: 404 });
    }
    if (atomicResult.kind === 'frozen_submitter') {
      return NextResponse.json(
        { error: 'Cannot approve an organization claim for a frozen account' },
        { status: 409 },
      );
    }
    if (atomicResult.kind === 'retired_projection') {
      return NextResponse.json(
        { error: 'The linked organization or service has been retired and cannot be reactivated.' },
        { status: 409 },
      );
    }
    if (atomicResult.kind === 'locked') {
      return NextResponse.json(
        { error: 'Submission is currently being reviewed by another admin' },
        { status: 409 },
      );
    }
    if (atomicResult.kind === 'transition_failed') {
      return NextResponse.json(
        { error: atomicResult.result.error ?? 'Cannot apply this decision' },
        { status: 409 },
      );
    }

    const { result } = atomicResult;
    await sendTerminalStatusEmail(result.submissionId, result.toStatus);

    return NextResponse.json({
      success: true,
      id: submissionId,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      transitionId: result.transitionId,
      message: decision === 'approved'
        ? 'Claim approved. Ownership access was granted without changing listing status.'
        : 'Claim denied.',
    });
  } catch (error) {
    if (error instanceof ProtectedAuthoritativeMutationConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    await captureException(error, { feature: 'api_admin_approvals_decide' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
