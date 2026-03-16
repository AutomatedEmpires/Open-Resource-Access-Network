import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { executeQuery, isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { advance, acquireLock, releaseLock } from '@/services/workflow/engine';
import {
  DEFAULT_PAGE_SIZE,
  ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';

const HIGH_RISK_REASONS = new Set(['suspected_fraud', 'permanently_closed', 'wrong_location']);

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
}).refine(
  (data) => data.decision === 'approved' || Boolean(data.notes?.trim()),
  { path: ['notes'], message: 'Notes are required when denying, escalating, or returning a report' },
);

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const rl = await checkRateLimitShared(`admin:reports:read:${getIp(req)}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
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
  if (rl.exceeded) {
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

    const reportRows = await executeQuery<{
      status: SubmissionStatus;
      service_id: string | null;
      reason: string | null;
    }>(
      `SELECT status, service_id, payload->>'reason' AS reason
       FROM submissions
       WHERE id = $1 AND submission_type = 'community_report'`,
      [reportId],
    );

    const report = reportRows[0];
    if (!report) {
      await releaseLock(reportId, authCtx.userId, false);
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    if (notes) {
      await executeQuery(
        `UPDATE submissions SET reviewer_notes = $1, updated_at = NOW() WHERE id = $2`,
        [notes, reportId],
      );
    }

    if (report.status === 'submitted') {
      const reviewStart = await advance({
        submissionId: reportId,
        toStatus: 'under_review',
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: 'Claimed for report review',
      });
      if (!reviewStart.success) {
        await releaseLock(reportId, authCtx.userId, false);
        return NextResponse.json({ error: reviewStart.error ?? 'Unable to start review' }, { status: 409 });
      }
    }

    const result = await advance({
      submissionId: reportId,
      toStatus: decision,
      actorUserId: authCtx.userId,
      actorRole: authCtx.role,
      reason: notes ?? `Report ${decision}`,
      metadata: { decision },
    });

    if (!result.success) {
      await releaseLock(reportId, authCtx.userId, false);
      return NextResponse.json({ error: result.error ?? 'Cannot apply this decision' }, { status: 409 });
    }

    let integrityHoldApplied = false;
    if (decision === 'approved' && report.service_id && report.reason && HIGH_RISK_REASONS.has(report.reason)) {
      const holdResult = await withTransaction(async (client) => {
        const updated = await client.query<{ id: string }>(
          `UPDATE services
           SET integrity_hold_at = COALESCE(integrity_hold_at, NOW()),
               integrity_hold_reason = $1,
               integrity_held_by_user_id = $2,
               updated_at = NOW(),
               updated_by_user_id = $2
           WHERE id = $3
           RETURNING id`,
          [
            `community_report:${report.reason}${notes ? `:${notes}` : ''}`,
            authCtx.userId,
            report.service_id,
          ],
        );

        if (updated.rows.length > 0) {
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

        return updated.rows.length > 0;
      });
      integrityHoldApplied = holdResult;
    }

    await releaseLock(reportId, authCtx.userId, false).catch(() => undefined);

    return NextResponse.json({
      success: true,
      reportId,
      decision,
      integrityHoldApplied,
      message: integrityHoldApplied
        ? 'Report resolved and integrity hold applied.'
        : `Report ${decision} successfully.`,
    });
  } catch (error) {
    await releaseLock(reportId, authCtx.userId, false).catch(() => undefined);
    await captureException(error, { feature: 'api_admin_reports_decide' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
