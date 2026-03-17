/**
 * POST /api/host/claim — Submit an organization claim.
 *
 * Creates an organization record and a submissions entry with submission_type='org_claim'
 * and status='submitted'. The community/ORAN admin workflow processes the queue.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth';
import {
  RATE_LIMIT_WINDOW_MS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import { createEmptyResourceSubmissionDraft } from '@/domain/resourceSubmission';
import {
  createResourceSubmission,
  getResourceSubmissionDetailForActor,
} from '@/services/resourceSubmissions/service';
import { processSubmittedResourceSubmission } from '@/services/resourceSubmissions/submissionExecution';
import { getIp } from '@/services/security/ip';

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
}).strict();

// ============================================================
// HELPERS
// ============================================================
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
    const draft = createEmptyResourceSubmissionDraft('claim', 'host');
    draft.organization = {
      ...draft.organization,
      name: d.organizationName,
      description: d.description ?? '',
      url: d.url ?? '',
      email: d.email ?? '',
      phone: d.phone ?? '',
    };
    draft.evidence = {
      ...draft.evidence,
      sourceName: 'Host organization claim',
      sourceUrl: d.url ?? '',
      contactEmail: d.email ?? '',
      submitterRelationship: 'Organization representative',
      notes: d.claimNotes ?? 'Organization claim submitted via host portal.',
    };

    const detail = await createResourceSubmission({
      variant: 'claim',
      channel: 'host',
      submittedByUserId: authCtx.userId,
      actorRole: authCtx.role,
      title: `Organization claim: ${d.organizationName}`,
      notes: d.claimNotes ?? 'Organization claim submitted via host portal.',
      draft,
    });

    const processed = await processSubmittedResourceSubmission({
      detail,
      actorUserId: authCtx.userId,
      actorRole: authCtx.role,
      allowAutoApprove: false,
    });
    if (!processed.success) {
      return NextResponse.json({ error: processed.error ?? 'Unable to submit claim.' }, { status: 409 });
    }

    const refreshed = await getResourceSubmissionDetailForActor(authCtx, detail.instance.id);

    return NextResponse.json(
      {
        success: true,
        queuedForReview: true,
        submissionId: detail.instance.submission_id,
        instanceId: detail.instance.id,
        detail: refreshed ?? detail,
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
