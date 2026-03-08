/**
 * GET /api/community/queue/[id] — Fetch a single submission with full service + org details.
 * PUT /api/community/queue/[id] — Submit a review decision (approve / deny / escalate / return).
 *
 * Uses the universal submissions table (migration 0022).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { advance } from '@/services/workflow/engine';
import {
  RATE_LIMIT_WINDOW_MS,
  COMMUNITY_READ_RATE_LIMIT_MAX_REQUESTS,
  COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';

// ============================================================
// SCHEMAS
// ============================================================

const DecisionSchema = z.object({
  decision: z.enum(['approved', 'denied', 'escalated', 'returned', 'pending_second_approval'], {
    message: 'decision is required',
  }),
  notes: z.string().max(5000).optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

type RouteContext = { params: Promise<{ id: string }> };

// ============================================================
// HANDLERS
// ============================================================

export async function GET(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid submission ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`community:verify:read:${ip}`, {
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

  try {
    // Full detail: submission + service + organization
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
      reviewer_notes: string | null;
      payload: Record<string, unknown>;
      evidence: unknown[];
      priority: number;
      is_locked: boolean;
      locked_by_user_id: string | null;
      sla_deadline: string | null;
      sla_breached: boolean;
      created_at: string;
      updated_at: string;
      // Service
      service_name: string | null;
      service_description: string | null;
      service_url: string | null;
      service_email: string | null;
      service_status: string | null;
      // Organization
      organization_id: string | null;
      organization_name: string | null;
      organization_url: string | null;
      organization_email: string | null;
      organization_description: string | null;
      submitted_by_display_name: string | null;
      assigned_to_display_name: string | null;
    }>(
      `SELECT sub.id, sub.submission_type, sub.status,
              sub.service_id, sub.target_type, sub.target_id,
              sub.submitted_by_user_id, sub.assigned_to_user_id,
              sub.title, sub.notes, sub.reviewer_notes,
              sub.payload, sub.evidence, sub.priority,
              sub.is_locked, sub.locked_by_user_id,
              sub.sla_deadline, sub.sla_breached,
              sub.created_at, sub.updated_at,
              s.name AS service_name, s.description AS service_description,
              s.url AS service_url, s.email AS service_email, s.status AS service_status,
              o.id AS organization_id, o.name AS organization_name,
              o.url AS organization_url, o.email AS organization_email,
              o.description AS organization_description,
              up_sub.display_name AS submitted_by_display_name,
              up_assign.display_name AS assigned_to_display_name
       FROM submissions sub
       LEFT JOIN services s ON s.id = sub.service_id
       LEFT JOIN organizations o ON o.id = s.organization_id
       LEFT JOIN user_profiles up_sub ON up_sub.user_id = sub.submitted_by_user_id
       LEFT JOIN user_profiles up_assign ON up_assign.user_id = sub.assigned_to_user_id
       WHERE sub.id = $1`,
      [id],
    );

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Submission not found' }, { status: 404 });
    }

    const entry = rows[0];

    // Fetch locations if service exists
    let locations: unknown[] = [];
    let phones: unknown[] = [];
    if (entry.service_id) {
      locations = await executeQuery<{
        id: string;
        name: string | null;
        address_1: string | null;
        city: string | null;
        state_province: string | null;
        postal_code: string | null;
        latitude: number | null;
        longitude: number | null;
      }>(
        `SELECT l.id, l.name, a.address_1, a.city, a.state_province, a.postal_code,
                l.latitude, l.longitude
         FROM service_at_location sal
         JOIN locations l ON l.id = sal.location_id
         LEFT JOIN addresses a ON a.location_id = l.id
         WHERE sal.service_id = $1`,
        [entry.service_id],
      );

      phones = await executeQuery<{
        id: string;
        number: string;
        type: string | null;
        description: string | null;
      }>(
        `SELECT id, number, type, description FROM phones WHERE service_id = $1`,
        [entry.service_id],
      );
    }

    // Fetch confidence score
    const scores = entry.service_id
      ? await executeQuery<{
          score: number;
          verification_confidence: number;
          eligibility_match: number;
          constraint_fit: number;
          computed_at: string;
        }>(
          `SELECT score, verification_confidence, eligibility_match, constraint_fit, computed_at
           FROM confidence_scores WHERE service_id = $1`,
          [entry.service_id],
        )
      : [];

    // Fetch transition history
    const transitions = await executeQuery<{
      id: string;
      from_status: string;
      to_status: string;
      actor_user_id: string;
      actor_role: string | null;
      reason: string | null;
      gates_passed: boolean;
      created_at: string;
      actor_display_name: string | null;
    }>(
      `SELECT st.id, st.from_status, st.to_status, st.actor_user_id, st.actor_role,
              st.reason, st.gates_passed, st.created_at,
              up.display_name AS actor_display_name
       FROM submission_transitions st
       LEFT JOIN user_profiles up ON up.user_id = st.actor_user_id
       WHERE st.submission_id = $1
       ORDER BY st.created_at ASC`,
      [id],
    );

    return NextResponse.json(
      {
        ...entry,
        locations,
        phones,
        confidenceScore: scores[0] ?? null,
        transitions,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_community_verify_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid submission ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`community:verify:write:${ip}`, {
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

  const parsed = DecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { decision, notes } = parsed.data;

  try {
    // Save reviewer notes before advancing
    if (notes) {
      await executeQuery(
        `UPDATE submissions SET reviewer_notes = $1, updated_at = NOW() WHERE id = $2`,
        [notes, id],
      );
    }

    // Use the workflow engine to advance the submission
    const result = await advance({
      submissionId: id,
      toStatus: decision as SubmissionStatus,
      actorUserId: authCtx.userId,
      actorRole: authCtx.role,
      reason: notes ?? `Decision: ${decision}`,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error ?? 'Cannot apply this decision' },
        { status: 409 },
      );
    }

    // If approved, bump confidence score for the associated service
    if (decision === 'approved') {
      const serviceRows = await executeQuery<{ service_id: string }>(
        `SELECT service_id FROM submissions WHERE id = $1 AND service_id IS NOT NULL`,
        [id],
      );
      if (serviceRows.length > 0) {
        await executeQuery(
          `INSERT INTO confidence_scores (service_id, score, verification_confidence, eligibility_match, constraint_fit)
           VALUES ($1, 80, 80, 50, 50)
           ON CONFLICT (service_id)
           DO UPDATE SET verification_confidence = 80,
                         score = GREATEST(confidence_scores.score, 80),
                         computed_at = now()`,
          [serviceRows[0].service_id],
        );
      }
    }

    const messages: Record<string, string> = {
      approved: 'Record approved. Confidence score updated.',
      denied: 'Record denied. Change request notes saved for the host.',
      escalated: 'Record escalated for ORAN admin review.',
      returned: 'Record returned to submitter for revision.',
      pending_second_approval: 'Record sent for second approval (two-person rule).',
    };

    return NextResponse.json({
      success: true,
      id,
      fromStatus: result.fromStatus,
      toStatus: result.toStatus,
      transitionId: result.transitionId,
      message: messages[decision] ?? `Decision: ${decision}`,
    });
  } catch (error) {
    await captureException(error, { feature: 'api_community_verify_decision' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
