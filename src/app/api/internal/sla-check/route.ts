/**
 * GET|POST /api/internal/sla-check
 *
 * Internal endpoint called by Vercel Cron to check SLA breaches. POST remains
 * available to authenticated rollback workers and operational tooling.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkSlaBreaches } from '@/services/workflow/engine';
import {
  checkSlaWarnings,
  escalateBreachedSubmissions,
} from '@/services/escalation/engine';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';
import { rejectUnauthorizedInternalRequest } from '@/services/auth/internalRequest';
import {
  candidateReviewerRoutingRepairResultFrom,
  repairCandidateReviewerCoverage,
} from '@/services/ingestion/candidateReviewerRoutingRepair';

export const dynamic = 'force-dynamic';

async function runSubmissionSlaCheck() {
  // 1. Fire SLA warnings for submissions approaching deadline
  const warningCount = await checkSlaWarnings();

  // 2. Mark newly breached submissions and send initial breach notification
  const breachedCount = await checkSlaBreaches();

  // 3. Escalate previously breached submissions through tiered cadence
  const escalation = await escalateBreachedSubmissions();

  return { warningCount, breachedCount, escalation };
}

async function runSlaCheck(req: NextRequest) {
  const authFailure = rejectUnauthorizedInternalRequest(req);
  if (authFailure) return authFailure;

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 },
    );
  }

  const [slaOutcome, candidateRoutingOutcome] = await Promise.allSettled([
    runSubmissionSlaCheck(),
    repairCandidateReviewerCoverage(),
  ]);

  if (slaOutcome.status === 'rejected') {
    await captureException(slaOutcome.reason, { feature: 'sla_check' });
  }
  const candidateRouting = candidateRoutingOutcome.status === 'fulfilled'
    ? candidateRoutingOutcome.value
    : candidateReviewerRoutingRepairResultFrom(candidateRoutingOutcome.reason);
  if (candidateRoutingOutcome.status === 'rejected') {
    const sanitizedRoutingError = new Error('Candidate reviewer routing repair failed');
    sanitizedRoutingError.name = 'CandidateReviewerRoutingRepairError';
    await captureException(sanitizedRoutingError, {
      feature: 'candidate_reviewer_routing_repair',
      extra: candidateRouting ? { ...candidateRouting } : { failureCount: 1 },
    });
  }

  const checkedAt = new Date().toISOString();
  if (
    slaOutcome.status === 'rejected'
    || candidateRoutingOutcome.status === 'rejected'
  ) {
    return NextResponse.json(
      {
        error: 'Scheduled check failed',
        sla: { success: slaOutcome.status === 'fulfilled' },
        candidateReviewerRouting: {
          success: candidateRoutingOutcome.status === 'fulfilled',
          ...(candidateRouting ?? {}),
        },
        checkedAt,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    ...slaOutcome.value,
    candidateReviewerRouting: candidateRoutingOutcome.value,
    checkedAt,
  });
}

export async function GET(req: NextRequest) {
  return runSlaCheck(req);
}

export async function POST(req: NextRequest) {
  return runSlaCheck(req);
}
