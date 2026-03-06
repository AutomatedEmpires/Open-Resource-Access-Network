/**
 * GET  /api/community/queue — List submission entries (universal pipeline).
 * POST /api/community/queue — Claim a submission for review (lock + assign).
 *
 * Replaces the legacy verification_queue with the universal submissions table.
 * Supports filtering by submission_type, status, and pagination.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { advance, acquireLock, releaseLock } from '@/services/workflow/engine';
import { computeTriagePriority } from '@/services/queue/triage';
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
  const rl = checkRateLimit(`community:queue:read:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
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
    const conditions: string[] = [];
    const params: unknown[] = [];

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
    }>(
      `SELECT sub.id, sub.submission_type, sub.status,
              sub.service_id, sub.target_type, sub.target_id,
              sub.submitted_by_user_id, sub.assigned_to_user_id,
              sub.title, sub.notes, sub.priority,
              sub.is_locked, sub.locked_by_user_id,
              sub.sla_deadline, sub.sla_breached,
              sub.created_at, sub.updated_at,
              s.name AS service_name, s.status AS service_status,
              o.id AS organization_id, o.name AS organization_name
       FROM submissions sub
       LEFT JOIN services s ON s.id = sub.service_id
       LEFT JOIN organizations o ON o.id = s.organization_id
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
  const rl = checkRateLimit(`community:queue:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
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
    // Acquire lock + assign
    const locked = await acquireLock(submissionId, authCtx.userId);
    if (!locked) {
      return NextResponse.json(
        { error: 'Submission not found, already locked, or already assigned' },
        { status: 409 },
      );
    }

    // Move submitted → under_review via workflow engine
    const result = await advance({
      submissionId,
      toStatus: 'under_review',
      actorUserId: authCtx.userId,
      actorRole: authCtx.role,
      reason: 'Claimed for review',
    });

    if (!result.success) {
      // Release lock so the submission doesn't remain stuck
      await releaseLock(submissionId, authCtx.userId, false);
      return NextResponse.json(
        { error: result.error ?? 'Cannot claim this submission' },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true, id: submissionId }, { status: 200 });
  } catch (error) {
    // Best-effort lock release on unexpected failure
    try {
      await releaseLock(submissionId, authCtx.userId, false);
    } catch { /* lock release is best-effort */ }
    await captureException(error, { feature: 'api_community_queue_assign' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
