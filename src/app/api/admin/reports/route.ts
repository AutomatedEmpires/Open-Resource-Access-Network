import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import {
  acquireLock,
  advanceInTransaction,
  releaseLock,
  sendTerminalStatusEmail,
} from '@/services/workflow/engine';
import {
  acquireFreshnessSensitiveAuthoritativeMutationGates,
  findProtectedAuthoritativeEntities,
} from '@/services/publication/protectedAuthoritativeMutation';
import {
  DEFAULT_PAGE_SIZE,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';
import { getIp } from '@/services/security/ip';

const HIGH_RISK_REASONS = new Set(['suspected_fraud', 'permanently_closed', 'wrong_location']);

class ReportDecisionConflictError extends Error {}

const ListParamsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(DEFAULT_PAGE_SIZE),
  status: z.enum(['submitted', 'under_review', 'approved', 'denied', 'returned', 'escalated', '']).default(''),
  reason: z.enum([
    'incorrect_info',
    'permanently_closed',
    'temporarily_closed',
    'wrong_location',
    'wrong_phone',
    'wrong_hours',
    'wrong_eligibility',
    'suspected_fraud',
    'duplicate_listing',
    'other',
    '',
  ]).default(''),
});

const DecisionSchema = z.object({
  reportId: z.string().uuid('reportId must be a valid UUID'),
  decision: z.enum(['approved', 'denied', 'escalated', 'returned']),
  notes: z.string().trim().max(5000).optional(),
}).strict().refine(
  (data) => data.decision === 'approved' || Boolean(data.notes?.trim()),
  { path: ['notes'], message: 'Notes are required when denying, escalating, or returning a report' },
);
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const rl = await checkRateLimitShared(`admin:reports:read:${getIp(req)}`, {
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
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } });
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'community_admin')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((value, key) => {
    raw[key] = value;
  });
  const parsed = ListParamsSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid parameters', details: parsed.error.issues }, { status: 400 });
  }

  const { page, limit, reason, status } = parsed.data;
  const offset = (page - 1) * limit;
  const conditions = [`sub.submission_type = 'community_report'`];
  const params: unknown[] = [];

  if (status) {
    params.push(status);
    conditions.push(`sub.status = $${params.length}`);
  }
  if (reason) {
    params.push(reason);
    conditions.push(`sub.payload->>'reason' = $${params.length}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  try {
    const [rows, counts] = await Promise.all([
      executeQuery<{
        id: string;
        status: SubmissionStatus;
        title: string | null;
        notes: string | null;
        reviewer_notes: string | null;
        submitted_by_user_id: string;
        assigned_to_user_id: string | null;
        service_id: string | null;
        reason: string | null;
        contact_email: string | null;
        reporter_authenticated: boolean | null;
        created_at: string;
        updated_at: string;
        service_name: string | null;
        organization_name: string | null;
        integrity_hold_at: string | null;
      }>(
        `SELECT sub.id,
                sub.status,
                sub.title,
                sub.notes,
                sub.reviewer_notes,
                sub.submitted_by_user_id,
                sub.assigned_to_user_id,
                sub.service_id,
                sub.payload->>'reason' AS reason,
                sub.payload->>'contact_email' AS contact_email,
                CASE WHEN sub.payload->>'reporter_authenticated' = 'true' THEN true ELSE false END AS reporter_authenticated,
                sub.created_at,
                sub.updated_at,
                svc.name AS service_name,
                org.name AS organization_name,
                svc.integrity_hold_at
         FROM submissions sub
         LEFT JOIN services svc ON svc.id = sub.service_id
         LEFT JOIN organizations org ON org.id = svc.organization_id
         ${where}
         ORDER BY CASE WHEN sub.payload->>'reason' = 'suspected_fraud' THEN 0 ELSE 1 END,
                  sub.priority DESC,
                  sub.created_at ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      executeQuery<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM submissions sub ${where}`,
        params,
      ),
    ]);

    const total = parseInt(counts[0]?.count ?? '0', 10);
    return NextResponse.json(
      {
        results: rows.map((row) => ({
          ...row,
          is_high_risk: row.reason !== null && HIGH_RISK_REASONS.has(row.reason),
        })),
        total,
        page,
        hasMore: offset + rows.length < total,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_admin_reports_list' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const rl = await checkRateLimitShared(`admin:reports:write:${getIp(req)}`, {
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
    return NextResponse.json({ error: 'Rate limit exceeded.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } });
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
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const { reportId, decision, notes } = parsed.data;

  try {
    const locked = await acquireLock(reportId, authCtx.userId);
    if (!locked) {
      return NextResponse.json({ error: 'Report is currently being reviewed by another admin' }, { status: 409 });
    }

    const decisionResult = await withTransaction(async (client) => {
      // A report decision that changes seeker visibility is one publication
      // operation. Enter the shared side of the merge gate before taking any
      // row lock, then re-read every identity used by the terminal decision.
      await acquireFreshnessSensitiveAuthoritativeMutationGates(client);

      const reportRows = await client.query<{
        status: SubmissionStatus;
        assigned_to_user_id: string | null;
        is_locked: boolean;
        locked_by_user_id: string | null;
        service_id: string | null;
        reason: string | null;
      }>(
        `SELECT status, assigned_to_user_id, is_locked, locked_by_user_id,
                service_id, payload->>'reason' AS reason
         FROM submissions
         WHERE id = $1
           AND submission_type = 'community_report'
         FOR UPDATE`,
        [reportId],
      );
      const report = reportRows.rows[0];
      if (!report) {
        return { found: false as const, integrityHoldApplied: false };
      }
      if (
        !report.is_locked
        || report.locked_by_user_id !== authCtx.userId
        || (report.assigned_to_user_id && report.assigned_to_user_id !== authCtx.userId)
      ) {
        throw new ReportDecisionConflictError(
          'Claim and lock this report before applying a decision.',
        );
      }
      const protectedMatch = report.service_id
        ? (await findProtectedAuthoritativeEntities(client, {
            serviceIds: [report.service_id],
          }))[0] ?? null
        : null;
      const authorityReviewRequired = Boolean(
        protectedMatch
        && decision === 'approved'
        && report.reason
        && HIGH_RISK_REASONS.has(report.reason),
      );
      const assigned = await client.query<{ id: string }>(
        `UPDATE submissions
         SET assigned_to_user_id = $1, updated_at = NOW()
         WHERE id = $2
           AND is_locked = true
           AND locked_by_user_id = $1
           AND (assigned_to_user_id IS NULL OR assigned_to_user_id = $1)
         RETURNING id`,
        [authCtx.userId, reportId],
      );
      if (!assigned.rows[0]) {
        throw new ReportDecisionConflictError(
          'Report ownership changed before the decision could begin.',
        );
      }

      if (report.service_id) {
        const currentService = await client.query<{ id: string }>(
          `SELECT id
           FROM services
           WHERE id = $1
             AND status IS DISTINCT FROM 'defunct'
           FOR UPDATE`,
          [report.service_id],
        );
        if (!currentService.rows[0]) {
          throw new ReportDecisionConflictError(
            'The report\'s linked service is retired or missing; refresh before deciding it.',
          );
        }
      }

      if (notes) {
        await client.query(
          `UPDATE submissions SET reviewer_notes = $1, updated_at = NOW() WHERE id = $2`,
          [notes, reportId],
        );
      }

      if (report.status === 'submitted') {
        const reviewStart = await advanceInTransaction(client, {
          submissionId: reportId,
          toStatus: 'under_review',
          actorUserId: authCtx.userId,
          actorRole: authCtx.role,
          reason: 'Claimed for report review',
        });
        if (!reviewStart.success) {
          throw new ReportDecisionConflictError(reviewStart.error ?? 'Unable to start review');
        }
      }

      const appliedDecision: SubmissionStatus = authorityReviewRequired
        ? 'escalated'
        : decision;
      const terminalDecision = await advanceInTransaction(client, {
        submissionId: reportId,
        toStatus: appliedDecision,
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: authorityReviewRequired
          ? 'Protected authority resource requires its owning workflow to review this evidence'
          : notes ?? `Report ${decision}`,
        metadata: {
          requestedDecision: decision,
          decision: appliedDecision,
          protectedAuthority: protectedMatch ?? undefined,
        },
      });
      if (!terminalDecision.success) {
        throw new ReportDecisionConflictError(
          terminalDecision.error ?? 'Cannot apply this decision',
        );
      }

      let integrityHoldApplied = false;
      if (
        appliedDecision === 'approved'
        && !protectedMatch
        && report.service_id
        && report.reason
        && HIGH_RISK_REASONS.has(report.reason)
      ) {
        const updated = await client.query<{ id: string }>(
          `UPDATE services
           SET integrity_hold_at = COALESCE(integrity_hold_at, NOW()),
               integrity_hold_reason = $1,
               integrity_held_by_user_id = $2,
               updated_at = NOW(),
               updated_by_user_id = $2
           WHERE id = $3
             AND status IS DISTINCT FROM 'defunct'
           RETURNING id`,
          [
            `community_report:${report.reason}${notes ? `:${notes}` : ''}`,
            authCtx.userId,
            report.service_id,
          ],
        );
        if (!updated.rows[0]) {
          throw new ReportDecisionConflictError(
            'The linked service changed before its integrity hold could be applied.',
          );
        }

        integrityHoldApplied = true;
        if (integrityHoldApplied) {
          await client.query(
            `INSERT INTO notification_events
               (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
             SELECT om.user_id,
                    'listing_integrity_hold',
                    'A listing was placed on integrity hold',
                    $2,
                    'service',
                    $1,
                    '/services',
                    'integrity_hold_' || $1 || '_' || om.user_id || '_' || $3
             FROM services svc
             INNER JOIN organization_members om
               ON om.organization_id = svc.organization_id
              AND om.status = 'active'
              AND om.role = 'host_admin'
             WHERE svc.id = $1
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              report.service_id,
              'An approved high-risk community report requires listing review before seeker visibility resumes.',
              reportId,
            ],
          );
        }
      }

      return {
        found: true as const,
        integrityHoldApplied,
        appliedDecision,
        authorityReviewRequired,
      };
    });

    if (!decisionResult.found) {
      await releaseLock(reportId, authCtx.userId, false);
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    const integrityHoldApplied = decisionResult.integrityHoldApplied;
    const appliedDecision = decisionResult.appliedDecision;

    await releaseLock(reportId, authCtx.userId, false).catch(() => undefined);
    await sendTerminalStatusEmail(reportId, appliedDecision);

    return NextResponse.json({
      success: true,
      reportId,
      decision: appliedDecision,
      requestedDecision: decision,
      integrityHoldApplied,
      authorityReviewRequired: decisionResult.authorityReviewRequired,
      message: decisionResult.authorityReviewRequired
        ? 'Report evidence was retained and escalated to the protected resource authority workflow.'
        : integrityHoldApplied
        ? 'Report resolved and integrity hold applied.'
        : `Report ${appliedDecision} successfully.`,
    });
  } catch (error) {
    await releaseLock(reportId, authCtx.userId, false).catch(() => undefined);
    if (error instanceof ReportDecisionConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    await captureException(error, { feature: 'api_admin_reports_decide' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
