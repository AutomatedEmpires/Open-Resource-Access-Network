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
import { advance, acquireLock, releaseLock } from '@/services/workflow/engine';
import {
  RATE_LIMIT_WINDOW_MS,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_PAGE_SIZE,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';

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
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

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
    // Acquire lock to prevent concurrent decisions
    const locked = await acquireLock(submissionId, authCtx.userId);
    if (!locked) {
      return NextResponse.json(
        { error: 'Submission is currently being reviewed by another admin' },
        { status: 409 },
      );
    }

    if (decision === 'approved') {
      const submitterRows = await executeQuery<{ account_status: 'active' | 'frozen' | null }>(
        `SELECT up.account_status
         FROM submissions sub
         LEFT JOIN user_profiles up ON up.user_id = sub.submitted_by_user_id
         WHERE sub.id = $1 AND sub.submission_type = 'org_claim'
         LIMIT 1`,
        [submissionId],
      );

      if ((submitterRows[0]?.account_status ?? 'active') !== 'active') {
        await releaseLock(submissionId, authCtx.userId, false);
        return NextResponse.json(
          { error: 'Cannot approve an organization claim for a frozen account' },
          { status: 409 },
        );
      }
    }

    // Save reviewer notes before advancing
    if (notes) {
      await executeQuery(
        `UPDATE submissions SET reviewer_notes = $1, updated_at = NOW() WHERE id = $2`,
        [notes, submissionId],
      );
    }

    // Use workflow engine to advance the submission
    const result = await advance({
      submissionId,
      toStatus: decision as SubmissionStatus,
      actorUserId: authCtx.userId,
      actorRole: authCtx.role,
      reason: notes ?? `Admin decision: ${decision}`,
    });

    if (!result.success) {
      // Release lock so the submission doesn't remain stuck
      await releaseLock(submissionId, authCtx.userId, false);
      return NextResponse.json(
        { error: result.error ?? 'Cannot apply this decision' },
        { status: 409 },
      );
    }

    // If approved, activate the service + promote user + create org membership
    if (decision === 'approved') {
      await withTransaction(async (client) => {
        // Look up both the service and the submitter for this claim
        const subRows = await client.query<{
          service_id: string | null;
          target_id: string | null;
          submitted_by_user_id: string;
        }>(
          `SELECT service_id, target_id, submitted_by_user_id
           FROM submissions WHERE id = $1`,
          [submissionId],
        );
        const sub = subRows.rows[0];
        if (!sub) return;

        // Activate the placeholder service
        if (sub.service_id) {
          await client.query(
            `UPDATE services SET status = 'active', updated_at = NOW()
             WHERE id = $1`,
            [sub.service_id],
          );
        }

        // Create org membership for the submitter (host_admin of the claimed org)
        if (sub.target_id && sub.submitted_by_user_id) {
          await client.query(
            `INSERT INTO organization_members (organization_id, user_id, role, status)
             VALUES ($1, $2, 'host_admin', 'active')
             ON CONFLICT (organization_id, user_id) DO UPDATE
               SET role = 'host_admin', status = 'active', updated_at = NOW()`,
            [sub.target_id, sub.submitted_by_user_id],
          );

          // Promote user role to host_admin if currently lower
          // Role hierarchy: seeker(0) < host_member(1) < host_admin(2)
          await client.query(
            `UPDATE user_profiles
             SET role = 'host_admin', updated_at = NOW()
             WHERE user_id = $1
               AND role IN ('seeker', 'host_member')`,
            [sub.submitted_by_user_id],
          );

          // Ensure user_profiles row exists (upsert for OAuth users who haven't visited /profile yet)
          await client.query(
            `INSERT INTO user_profiles (user_id, role)
             VALUES ($1, 'host_admin')
             ON CONFLICT (user_id) DO NOTHING`,
            [sub.submitted_by_user_id],
          );
        }
      });
    }

    // If denied, clean up the orphaned org + placeholder service
    if (decision === 'denied') {
      await withTransaction(async (client) => {
        const subRows = await client.query<{ service_id: string; target_id: string }>(
          `SELECT service_id, target_id FROM submissions
           WHERE id = $1 AND submission_type = 'org_claim'
             AND service_id IS NOT NULL AND target_id IS NOT NULL`,
          [submissionId],
        );
        if (subRows.rows.length > 0) {
          const { service_id, target_id: orgId } = subRows.rows[0];
          // Mark the placeholder service as defunct
          await client.query(
            `UPDATE services SET status = 'defunct', updated_at = NOW() WHERE id = $1`,
            [service_id],
          );
          // Mark the organization as defunct (soft-delete via description)
          await client.query(
            `UPDATE organizations SET description = '[DENIED] ' || COALESCE(description, ''), updated_at = NOW()
             WHERE id = $1`,
            [orgId],
          );
        }
      });
    }

    return NextResponse.json({
      success: true,
      id: submissionId,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      transitionId: result.transitionId,
      message: decision === 'approved'
        ? 'Claim approved. Organization is now active.'
        : 'Claim denied.',
    });
  } catch (error) {
    // Best-effort lock release on unexpected failure
    try {
      await releaseLock(submissionId, authCtx.userId, false);
    } catch { /* lock release is best-effort */ }
    await captureException(error, { feature: 'api_admin_approvals_decide' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
