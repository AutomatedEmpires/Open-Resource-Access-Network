/**
 * PATCH /api/community/queue/bulk — Apply a bulk decision (approved / denied)
 * to a list of submission IDs.
 *
 * Body: { ids: string[], decision: 'approved' | 'denied', notes?: string }
 * Returns: { succeeded: string[], failed: { id: string, error: string }[] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { executeQuery, isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { buildCommunitySubmissionScope, getCommunityAdminScope } from '@/services/community/scope';
import { advance } from '@/services/workflow/engine';
import {
  RATE_LIMIT_WINDOW_MS,
  COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import type { SubmissionStatus } from '@/domain/types';

// ============================================================
// SCHEMA
// ============================================================

const BulkDecisionSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  decision: z.enum(['approved', 'denied']),
  notes: z.string().max(5000).optional(),
});

// ============================================================
// HELPERS
// ============================================================

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

// ============================================================
// HANDLER
// ============================================================

export async function PATCH(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`community:queue:bulk:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: COMMUNITY_WRITE_RATE_LIMIT_MAX_REQUESTS,
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

  const parsed = BulkDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { ids, decision, notes } = parsed.data;

  const succeeded: string[] = [];
  const failed: { id: string; error: string }[] = [];

  try {
    const scope = await getCommunityAdminScope(authCtx.userId);
    const accessibleIds = new Set<string>();

    if (scope.hasExplicitScope) {
      const accessParams: unknown[] = [ids];
      const scopeCondition = buildCommunitySubmissionScope('sub', scope, accessParams);
      const accessibleRows = await executeQuery<{ id: string }>(
        `SELECT sub.id
         FROM submissions sub
         WHERE sub.id = ANY($1::uuid[])${scopeCondition ? ` AND ${scopeCondition}` : ''}`,
        accessParams,
      );

      for (const row of accessibleRows) {
        accessibleIds.add(row.id);
      }
    } else {
      for (const id of ids) {
        accessibleIds.add(id);
      }
    }

    for (const id of ids) {
      if (!accessibleIds.has(id)) {
        failed.push({ id, error: 'Submission is outside your assigned community scope' });
        continue;
      }

      try {
        if (notes) {
          await executeQuery(
            `UPDATE submissions SET reviewer_notes = $1, updated_at = NOW() WHERE id = $2`,
            [notes, id],
          );
        }

        const result = await advance({
          submissionId: id,
          toStatus: decision as SubmissionStatus,
          actorUserId: authCtx.userId,
          actorRole: authCtx.role,
          reason: notes ?? `Bulk decision: ${decision}`,
        });

        if (!result.success) {
          failed.push({ id, error: result.error ?? 'Cannot apply this decision' });
          continue;
        }

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

        succeeded.push(id);
      } catch (itemError) {
        failed.push({ id, error: itemError instanceof Error ? itemError.message : 'Unknown error' });
      }
    }

    return NextResponse.json({ succeeded, failed });
  } catch (error) {
    await captureException(error, { feature: 'api_community_queue_bulk' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
