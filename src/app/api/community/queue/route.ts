/**
 * GET  /api/community/queue — List submission entries (universal pipeline).
 * POST /api/community/queue — Claim a submission for review (lock + assign).
 *
 * Replaces the legacy verification_queue with the universal submissions table.
 * Supports filtering by submission_type, status, and pagination.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { buildCommunitySubmissionScope, getCommunityAdminScope } from '@/services/community/scope';
import { advanceInTransaction } from '@/services/workflow/engine';
import { computeTriagePriority } from '@/services/queue/triage';
import { getIp } from '@/services/security/ip';
import {
  RATE_LIMIT_WINDOW_MS,
  COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
  SUBMISSION_STATUSES,
  SUBMISSION_TYPES,
} from '@/domain/constants';

// ============================================================
// SCHEMAS
// ============================================================

const ListParamsSchema = z.object({
  status: z
    .enum(SUBMISSION_STATUSES as unknown as [string, ...string[]])
    .optional(),
  type: z
    .enum(SUBMISSION_TYPES as unknown as [string, ...string[]])
    .optional(),
  assignedToMe: z.enum(['true', 'false']).optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
});

const ClaimSchema = z.object({
  submissionId: z.string().uuid('submissionId must be a valid UUID'),
}).strict();

class QueueMutationConflict extends Error {
  constructor(
    readonly clientMessage: string,
    readonly status: number = 409,
  ) {
    super(clientMessage);
    this.name = 'QueueMutationConflict';
  }
}

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
  const rl = await checkRateLimitShared(`community:queue:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
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

  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => { raw[k] = v; });
  const parsed = ListParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid parameters', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { status, type, assignedToMe, page, limit } = parsed.data;
  const offset = (page - 1) * limit;

  try {
    const scope = await getCommunityAdminScope(authCtx.userId);
    const conditions: string[] = [];
    const params: unknown[] = [];

    const scopeCondition = authCtx.role === 'oran_admin'
      ? null
      : buildCommunitySubmissionScope('sub', scope, params);
    if (scopeCondition) {
      conditions.push(scopeCondition);
    }

    if (status) {
      params.push(status);
      conditions.push(`sub.status = $${params.length}`);
    }

    if (type) {
      params.push(type);
      conditions.push(`sub.submission_type = $${params.length}`);
    }

    if (assignedToMe === 'true') {
      params.push(authCtx.userId);
      conditions.push(`sub.assigned_to_user_id = $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRows = await executeQuery<{ count: number }>(
      `SELECT count(*)::int AS count FROM submissions sub ${where}`,
      params,
    );
    const total = countRows[0]?.count ?? 0;

    params.push(limit, offset);
    const rows = await executeQuery<{
      id: string;
      submission_type: string;
      status: string;
      service_id: string | null;
      target_type: string;
      target_id: string | null;
      submitted_by_user_id: string;
      assigned_to_user_id: string | null;
      title: string | null;
      notes: string | null;
      priority: number;
      is_locked: boolean;
      locked_by_user_id: string | null;
      sla_deadline: string | null;
      sla_breached: boolean;
      created_at: string;
      updated_at: string;
      service_name: string | null;
      service_status: string | null;
      organization_id: string | null;
      organization_name: string | null;
      assigned_to_display_name: string | null;
      requires_structured_freshness_review: boolean;
    }>(
      `SELECT sub.id, sub.submission_type, sub.status,
              sub.service_id, sub.target_type, sub.target_id,
              sub.submitted_by_user_id, sub.assigned_to_user_id,
              sub.title, sub.notes, sub.priority,
              sub.is_locked, sub.locked_by_user_id,
              sub.sla_deadline, sub.sla_breached,
              sub.created_at, sub.updated_at,
              (
                CASE
                  WHEN pg_catalog.jsonb_typeof(sub.payload) = 'object'
                    THEN sub.payload ? 'resourceFreshness'
                  ELSE false
                END
                OR EXISTS (
                  SELECT 1
                  FROM oran_internal.resource_freshness_findings finding
                  WHERE finding.submission_id = sub.id
                    AND finding.status = 'open'
                )
              ) AS requires_structured_freshness_review,
              s.name AS service_name, s.status AS service_status,
              o.id AS organization_id, o.name AS organization_name,
              up_assign.display_name AS assigned_to_display_name
       FROM submissions sub
       LEFT JOIN services s ON s.id = sub.service_id
       LEFT JOIN organizations o ON o.id = s.organization_id
       LEFT JOIN user_profiles up_assign ON up_assign.user_id = sub.assigned_to_user_id
       ${where}
       ORDER BY sub.priority DESC, sub.created_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const enriched = rows.map((row) => {
      const triage = computeTriagePriority({
        dbPriority: row.priority,
        createdAt: row.created_at,
        status: row.status,
        slaDeadline: row.sla_deadline,
        slaBreached: row.sla_breached,
      });
      return { ...row, triage_priority: triage.score, triage_tier: triage.tier, triage_explanations: triage.explanations };
    });

    return NextResponse.json(
      { results: enriched, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_community_queue_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`community:queue:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ClaimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { submissionId } = parsed.data;

  try {
    // Resolve the caller's review scope and authorize the row before taking a
    // lock. Returning the same not-found response for missing and out-of-scope
    // rows avoids disclosing queue entries outside a community admin's remit.
    const scope = await getCommunityAdminScope(authCtx.userId);
    if (authCtx.role !== 'oran_admin' && scope.profileExists && !scope.isActive) {
      return NextResponse.json(
        { error: 'Your community review profile is inactive.' },
        { status: 403 },
      );
    }
    if (authCtx.role !== 'oran_admin' && scope.profileExists && !scope.isAcceptingNew) {
      return NextResponse.json(
        { error: 'Your community review profile is paused and cannot claim new work.' },
        { status: 409 },
      );
    }
    const authorizationParams: unknown[] = [submissionId];
    const authorizationScope = authCtx.role === 'oran_admin'
      ? null
      : buildCommunitySubmissionScope('sub', scope, authorizationParams, {
          requireAcceptingNew: true,
        });
    const authorizedRows = await executeQuery<{
      id: string;
      status: string;
      assigned_to_user_id: string | null;
    }>(
      `SELECT sub.id, sub.status, sub.assigned_to_user_id
       FROM submissions sub
       WHERE sub.id = $1
         ${authorizationScope ? `AND ${authorizationScope}` : ''}
       LIMIT 1`,
      authorizationParams,
    );
    const authorized = authorizedRows[0];

    if (!authorized) {
      return NextResponse.json(
        { error: 'Submission not found in your review scope' },
        { status: 404 },
      );
    }

    const isStandardClaim = authorized.status === 'submitted' || authorized.status === 'needs_review';
    const isEscalatedClaim = authorized.status === 'escalated';
    const isSecondApprovalClaim = authorized.status === 'pending_second_approval';
    const canTakeOverEscalation = isEscalatedClaim && authCtx.role === 'oran_admin';

    if (isEscalatedClaim && authCtx.role !== 'oran_admin') {
      return NextResponse.json(
        { error: 'Escalated submissions can only be claimed by an ORAN admin' },
        { status: 403 },
      );
    }

    if (!isStandardClaim && !isEscalatedClaim && !isSecondApprovalClaim) {
      return NextResponse.json(
        { error: `Submission cannot be claimed from status ${authorized.status}` },
        { status: 409 },
      );
    }

    if (
      authorized.assigned_to_user_id
      && authorized.assigned_to_user_id !== authCtx.userId
      && !canTakeOverEscalation
    ) {
      return NextResponse.json(
        { error: 'Submission is already assigned to another reviewer' },
        { status: 409 },
      );
    }

    const claimed = await withTransaction(async (client) => {
      // Lock and assign in one guarded UPDATE. Re-checking status and scope in
      // the transaction closes the race after the authorization read.
      const claimParams: unknown[] = [authCtx.userId, submissionId, authorized.status];
      const claimScope = authCtx.role === 'oran_admin'
        ? null
        : buildCommunitySubmissionScope('sub', scope, claimParams, {
            requireAcceptingNew: true,
          });
      const claimResult = await client.query<{ id: string }>(
        `UPDATE submissions sub
         SET is_locked = true,
             locked_at = NOW(),
             locked_by_user_id = $1,
             assigned_to_user_id = $1,
             updated_at = NOW()
         WHERE sub.id = $2
           AND sub.status = $3
           ${canTakeOverEscalation ? '' : 'AND (sub.is_locked = false OR sub.locked_by_user_id = $1)'}
           ${canTakeOverEscalation ? '' : 'AND (sub.assigned_to_user_id IS NULL OR sub.assigned_to_user_id = $1)'}
           ${isSecondApprovalClaim ? `AND NOT EXISTS (
             SELECT 1
             FROM submission_transitions prior_review
             WHERE prior_review.submission_id = sub.id
               AND prior_review.actor_user_id = $1
               AND prior_review.gates_passed = true
               AND prior_review.to_status IN ('under_review', 'pending_second_approval')
           )` : ''}
           ${claimScope ? `AND ${claimScope}` : ''}
         RETURNING sub.id`,
        claimParams,
      );

      if (claimResult.rows.length === 0) {
        return false;
      }

      // Submitted work must pass through needs_review because the workflow
      // graph intentionally forbids submitted → under_review.
      if (authorized.status === 'submitted') {
        const queued = await advanceInTransaction(client, {
          submissionId,
          toStatus: 'needs_review',
          actorUserId: authCtx.userId,
          actorRole: authCtx.role,
          reason: 'Claimed for manual review',
        });

        if (!queued.success) {
          throw new QueueMutationConflict(
            queued.error ?? 'Cannot queue this submission for review',
          );
        }
      }

      if (isSecondApprovalClaim) {
        // The handoff status is itself the second approver's review lane. Do
        // not force it through under_review; the guarded claim above establishes
        // reviewer B's assignment and lock while excluding reviewer A.
        return true;
      }

      const result = await advanceInTransaction(client, {
        submissionId,
        toStatus: 'under_review',
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: 'Claimed for review',
      });

      if (!result.success) {
        throw new QueueMutationConflict(result.error ?? 'Cannot claim this submission');
      }

      return true;
    });

    if (!claimed) {
      return NextResponse.json(
        { error: 'Submission not found, already locked, or already assigned' },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, id: submissionId }, { status: 200 });
  } catch (error) {
    if (error instanceof QueueMutationConflict) {
      return NextResponse.json({ error: error.clientMessage }, { status: error.status });
    }
    await captureException(error, { feature: 'api_community_queue_assign' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================
// DELETE — Release a claimed submission (unclaim / release lock)
// ============================================================

const UnclaimSchema = z.object({
  submissionId: z.string().uuid('submissionId must be a valid UUID'),
}).strict();

export async function DELETE(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = await checkRateLimitShared(`community:queue:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UnclaimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { submissionId } = parsed.data;

  try {
    const isAdmin = authCtx.role === 'oran_admin';
    const scope = await getCommunityAdminScope(authCtx.userId);
    const authorizationParams: unknown[] = [submissionId];
    const authorizationScope = isAdmin
      ? null
      : buildCommunitySubmissionScope('sub', scope, authorizationParams);
    const authorizedRows = await executeQuery<{
      id: string;
      status: string;
      assigned_to_user_id: string | null;
      is_locked: boolean;
      locked_by_user_id: string | null;
    }>(
      `SELECT sub.id, sub.status, sub.assigned_to_user_id,
              sub.is_locked, sub.locked_by_user_id
       FROM submissions sub
       WHERE sub.id = $1
         ${authorizationScope ? `AND ${authorizationScope}` : ''}
       LIMIT 1`,
      authorizationParams,
    );
    const authorized = authorizedRows[0];

    if (!authorized) {
      return NextResponse.json(
        { error: 'Submission not found in your review scope' },
        { status: 404 },
      );
    }

    if (
      authorized.status !== 'under_review'
      || authorized.assigned_to_user_id !== authCtx.userId
      || !authorized.is_locked
      || authorized.locked_by_user_id !== authCtx.userId
    ) {
      return NextResponse.json(
        { error: 'Cannot release — submission not found or not locked by you' },
        { status: 409 },
      );
    }
    const released = await withTransaction(async (client) => {
      const releaseParams: unknown[] = [authCtx.userId, submissionId];
      const releaseScope = isAdmin
        ? null
        : buildCommunitySubmissionScope('sub', scope, releaseParams);
      // Keep reviewer ownership intact until advanceInTransaction validates it.
      // The workflow status-exit cleanup releases assignment and lock only
      // after the audited transition succeeds.
      const releaseResult = await client.query<{ id: string }>(
        `SELECT sub.id
         FROM submissions sub
         WHERE sub.id = $2
           AND sub.status = 'under_review'
           AND sub.is_locked = true
           AND sub.locked_by_user_id = $1
           AND sub.assigned_to_user_id = $1
           ${releaseScope ? `AND ${releaseScope}` : ''}
         FOR UPDATE OF sub`,
        releaseParams,
      );

      if (releaseResult.rows.length === 0) {
        return false;
      }

      // Resolve the active review's origin after the guarded UPDATE has locked
      // the submission row. This prevents a concurrent takeover from changing
      // which lane receives the released work.
      const originResult = await client.query<{ from_status: string }>(
        `SELECT st.from_status
         FROM submission_transitions st
         WHERE st.submission_id = $1
           AND st.to_status = 'under_review'
           AND st.gates_passed = true
         ORDER BY st.created_at DESC, st.id DESC
         LIMIT 1`,
        [submissionId],
      );
      const releaseStatus = originResult.rows[0]?.from_status === 'escalated'
        ? 'escalated'
        : 'needs_review';

      const result = await advanceInTransaction(client, {
        submissionId,
        toStatus: releaseStatus,
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: releaseStatus === 'escalated'
          ? 'Released back to the ORAN escalation queue'
          : 'Released back to the review queue',
        metadata: releaseStatus === 'escalated'
          ? { resourceFreshnessEscalationRelease: true }
          : undefined,
      });

      if (!result.success) {
        throw new QueueMutationConflict(
          result.error ?? 'Cannot return this submission to the review queue',
        );
      }

      return true;
    });

    if (!released) {
      return NextResponse.json(
        { error: 'Cannot release — submission changed or is no longer locked by you' },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, id: submissionId }, { status: 200 });
  } catch (error) {
    if (error instanceof QueueMutationConflict) {
      return NextResponse.json({ error: error.clientMessage }, { status: error.status });
    }
    await captureException(error, { feature: 'api_community_queue_unclaim' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
