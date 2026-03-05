/**
 * POST /api/host/claim — Submit an organization claim.
 *
 * Creates an organization record and a submissions entry with submission_type='org_claim'
 * and status='submitted'. The community/ORAN admin workflow processes the queue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured, withTransaction } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth';
import { applySla } from '@/services/workflow/engine';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';

// ============================================================
// SCHEMA
// ============================================================

const ClaimSchema = z.object({
  /** Organization name to claim */
  organizationName: z.string().min(1, 'Organization name is required').max(500),
  /** Brief description of the organization */
  description:      z.string().max(5000).optional(),
  /** Organization website (helps verification) */
  url:              z.string().url().max(2000).optional(),
  /** Contact email for verification */
  email:            z.string().email().max(500).optional(),
  /** Contact phone for verification */
  phone:            z.string().max(30).optional(),
  /** Notes for the reviewer (role at org, how to verify, etc.) */
  claimNotes:       z.string().max(2000).optional(),
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

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Database not configured.' },
      { status: 503 },
    );
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`host:claim:write:${ip}`, {
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

  const d = parsed.data;

  // Auth required unconditionally for claim submission.
  // Claims create organizations and enter the approval queue — they must be
  // attributed to a real, authenticated user in all environments.
  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json(
      { error: 'Authentication required to submit claims' },
      { status: 401 },
    );
  }

  try {
    const submitterId = authCtx.userId;

    // All inserts in a transaction — if any fail, everything rolls back
    const result = await withTransaction(async (client) => {
      // 1. Create the organization
      const orgResult = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, description, url, email, phone)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          d.organizationName,
          d.description ?? null,
          d.url ?? null,
          d.email ?? null,
          d.phone ?? null,
        ],
      );
      const orgId = orgResult.rows[0].id;

      // 2. Create a placeholder service for verification tracking.
      const svcResult = await client.query<{ id: string }>(
        `INSERT INTO services (organization_id, name, description, status)
         VALUES ($1, $2, $3, 'inactive')
         RETURNING id`,
        [orgId, `${d.organizationName} — General Services`, 'Placeholder service created during organization claim.'],
      );
      const serviceId = svcResult.rows[0].id;

      // 3. Create submission entry for org claim
      const subResult = await client.query<{ id: string }>(
        `INSERT INTO submissions
           (submission_type, status, target_type, target_id, service_id,
            submitted_by_user_id, title, notes, payload, submitted_at)
         VALUES ('org_claim', 'submitted', 'organization', $1, $2, $3, $4, $5, $6, NOW())
         RETURNING id`,
        [
          orgId,
          serviceId,
          submitterId,
          `Organization claim: ${d.organizationName}`,
          d.claimNotes ?? 'Organization claim submitted via host portal.',
          JSON.stringify({ phone: d.phone ?? null }),
        ],
      );
      const submissionId = subResult.rows[0].id;

      // 4. Record the initial transition (draft → submitted)
      await client.query(
        `INSERT INTO submission_transitions
           (submission_id, from_status, to_status, actor_user_id, actor_role,
            reason, gates_checked, gates_passed, metadata)
         VALUES ($1, 'draft', 'submitted', $2, $3, $4, '[]', true, $5)`,
        [
          submissionId,
          submitterId,
          authCtx.role,
          'Organization claim submitted',
          JSON.stringify({ organization_id: orgId, service_id: serviceId }),
        ],
      );

      // 5. Notify admin pool of new submission
      await client.query(
        `INSERT INTO notification_events
           (recipient_user_id, event_type, title, body, resource_type, resource_id, action_url, idempotency_key)
         SELECT up.user_id,
                'submission_status_changed',
                'New organization claim submitted',
                $2,
                'submission',
                $1,
                '/admin/approvals',
                'new_claim_' || $1 || '_' || up.user_id
         FROM user_profiles up
         WHERE up.role IN ('community_admin', 'oran_admin')
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          submissionId,
          `New org claim: ${d.organizationName}`,
        ],
      );

      return { orgId, serviceId, submissionId };
    });

    // Apply SLA deadline for the new claim
    try {
      await applySla(result.submissionId, 'org_claim');
    } catch {
      // SLA is best-effort — don't fail the submission
    }

    return NextResponse.json(
      {
        success: true,
        organizationId: result.orgId,
        serviceId: result.serviceId,
        message: 'Claim submitted. A community administrator will review your request.',
      },
      { status: 201 },
    );
  } catch (error) {
    await captureException(error, { feature: 'api_host_claim' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
