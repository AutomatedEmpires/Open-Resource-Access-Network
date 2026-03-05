/**
 * GET  /api/admin/appeals        — List all appeals for review.
 * POST /api/admin/appeals        — Decide (approve/deny) an appeal.
 *
 * ORAN-admin + community_admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
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
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['submitted', 'under_review', 'approved', 'denied', 'returned', '']).default(''),
});

const DecisionSchema = z.object({
  appealId:  z.string().uuid('appealId must be a valid UUID'),
  decision:  z.enum(['approved', 'denied', 'returned']),
  notes:     z.string().max(5000).optional(),
}).refine(
  (data) => data.decision === 'approved' || (data.notes && data.notes.trim().length > 0),
  { message: 'Notes are required when denying or returning an appeal', path: ['notes'] },
);

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// GET — List appeals
// ============================================================

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`admin:appeals:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
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

  try {
    const { page, limit, status } = parsed.data;
    const offset = (page - 1) * limit;

    const conditions = [`s.submission_type = 'appeal'`];
    const params: (string | number)[] = [];
    let paramIdx = 1;

    if (status) {
      conditions.push(`s.status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }

    const where = conditions.join(' AND ');

    const [rows, countResult] = await Promise.all([
      executeQuery<{
        id: string;
        status: SubmissionStatus;
        title: string | null;
        notes: string | null;
        reviewer_notes: string | null;
        submitted_by_user_id: string;
        assigned_to_user_id: string | null;
        priority: number;
        original_submission_id: string | null;
        original_submission_type: string | null;
        created_at: string;
        updated_at: string;
        service_id: string | null;
      }>(
        `SELECT s.id, s.status, s.title, s.notes, s.reviewer_notes,
                s.submitted_by_user_id, s.assigned_to_user_id, s.priority,
                s.payload->>'original_submission_id' AS original_submission_id,
                s.payload->>'original_submission_type' AS original_submission_type,
                s.created_at, s.updated_at, s.service_id
         FROM submissions s
         WHERE ${where}
         ORDER BY s.priority DESC, s.created_at ASC
         LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
        [...params, limit, offset],
      ),
      executeQuery<{ count: string }>(
        `SELECT COUNT(*) AS count FROM submissions s WHERE ${where}`,
        [...params],
      ),
    ]);

    const total = parseInt(countResult[0]?.count ?? '0', 10);

    return NextResponse.json(
      { results: rows, total, page, hasMore: offset + rows.length < total },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_appeals_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ============================================================
// POST — Decide an appeal
// ============================================================

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`admin:appeals:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
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

  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { appealId, decision, notes } = parsed.data;

  try {
    // Acquire lock to prevent concurrent decisions
    const locked = await acquireLock(appealId, authCtx.userId);
    if (!locked) {
      return NextResponse.json(
        { error: 'Appeal is currently being reviewed by another admin' },
        { status: 409 },
      );
    }

    // Save reviewer notes before advancing (like admin/approvals pattern)
    if (notes) {
      await executeQuery(
        `UPDATE submissions SET reviewer_notes = $1, updated_at = NOW() WHERE id = $2`,
        [notes, appealId],
      );
    }

    // Use WorkflowEngine for full gate checks, transition validation, and notifications
    const result = await advance({
      submissionId: appealId,
      toStatus: decision as SubmissionStatus,
      actorUserId: authCtx.userId,
      actorRole: authCtx.role,
      reason: notes ?? `Appeal ${decision}`,
      metadata: { decision },
    });

    if (!result.success) {
      // Release lock so the appeal doesn't remain stuck
      await releaseLock(appealId, authCtx.userId, false);
      return NextResponse.json(
        { error: result.error ?? 'Cannot apply this decision' },
        { status: 409 },
      );
    }

    // Appeal-specific side effect: re-open original submission on approval
    if (decision === 'approved') {
      await withTransaction(async (client) => {
        const appealRow = await client.query<{ payload: Record<string, unknown> }>(
          `SELECT payload FROM submissions WHERE id = $1`,
          [appealId],
        );
        const originalId = appealRow.rows[0]?.payload?.original_submission_id;
        if (typeof originalId === 'string') {
          await client.query(
            `UPDATE submissions
             SET status = 'needs_review', reviewer_notes = 'Re-opened after successful appeal',
                 updated_at = NOW()
             WHERE id = $1 AND status = 'denied'`,
            [originalId],
          );

          await client.query(
            `INSERT INTO submission_transitions
               (submission_id, from_status, to_status, actor_user_id, actor_role,
                reason, gates_checked, gates_passed, metadata)
             VALUES ($1, 'denied', 'needs_review', $2, $3, $4, '[]', true, $5)`,
            [
              originalId,
              authCtx.userId,
              authCtx.role,
              'Re-opened after appeal approved',
              JSON.stringify({ appeal_id: appealId }),
            ],
          );
        }
      });
    }

    return NextResponse.json(
      {
        success: true,
        appealId,
        decision,
        fromStatus: result.fromStatus,
        toStatus: result.toStatus,
        transitionId: result.transitionId,
        message: `Appeal ${decision} successfully`,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    // Best-effort lock release on unexpected failure
    try {
      await releaseLock(appealId, authCtx.userId, false);
    } catch { /* lock release is best-effort */ }
    await captureException(error, { feature: 'api_admin_appeals_decide' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
