/**
 * POST /api/internal/sla-check
 *
 * Internal endpoint called by Azure Functions Timer Trigger to check SLA breaches.
 * Protected by a shared secret (INTERNAL_API_KEY) — not accessible to end users.
 */

import { NextRequest, NextResponse } from 'next/server';
import { checkSlaBreaches } from '@/services/workflow/engine';
import { isDatabaseConfigured } from '@/services/db/postgres';
import { captureException } from '@/services/telemetry/sentry';

export async function POST(req: NextRequest) {
  // Validate internal API key
  const apiKey = process.env.INTERNAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Internal API not configured' },
      { status: 503 },
    );
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 },
    );
  }

  try {
    const breachedCount = await checkSlaBreaches();
    return NextResponse.json({
      success: true,
      breachedCount,
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
