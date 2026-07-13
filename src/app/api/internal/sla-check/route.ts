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

export const dynamic = 'force-dynamic';

async function runSlaCheck(req: NextRequest) {
  const authFailure = rejectUnauthorizedInternalRequest(req);
  if (authFailure) return authFailure;

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 },
    );
  }

  try {
    // 1. Fire SLA warnings for submissions approaching deadline
    const warningCount = await checkSlaWarnings();

    // 2. Mark newly breached submissions and send initial breach notification
    const breachedCount = await checkSlaBreaches();

    // 3. Escalate previously breached submissions through tiered cadence
    const escalation = await escalateBreachedSubmissions();

    return NextResponse.json({
      success: true,
      warningCount,
      breachedCount,
      escalation,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    await captureException(error, { feature: 'sla_check' });
    return NextResponse.json(
      { error: 'SLA check failed' },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return runSlaCheck(req);
}

export async function POST(req: NextRequest) {
  return runSlaCheck(req);
}
