/** GET|POST /api/internal/account-erasure — retry durable Clerk erasures. */

import { NextRequest, NextResponse } from 'next/server';

import { rejectUnauthorizedInternalRequest } from '@/services/auth/internalRequest';
import { isDatabaseConfigured } from '@/services/db/postgres';
import {
  claimAccountErasures,
  processAccountErasurePages,
} from '@/services/privacy/accountErasure';
import { captureException } from '@/services/telemetry/sentry';

export const dynamic = 'force-dynamic';

async function runAccountErasure(req: NextRequest) {
  const authFailure = rejectUnauthorizedInternalRequest(req);
  if (authFailure) return authFailure;
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  try {
    const results = [];
    let claimed = 0;
    const deadlineMs = Date.now() + 20_000;
    while (claimed < 4 && Date.now() < deadlineMs) {
      // Claim only work this invocation can immediately attempt. A claimed
      // request carries a lease, so pre-claiming a batch would starve later
      // requests when an earlier scrub consumes the shared deadline.
      const requests = await claimAccountErasures(1);
      const request = requests[0];
      if (!request) break;
      claimed += 1;
      results.push(await processAccountErasurePages(request, {
        maxPages: 8,
        deadlineMs,
      }));
    }
    const completed = results.filter((result) => result.completed).length;
    const blocked = results.filter((result) => result.status === 'blocked').length;
    return NextResponse.json({
      success: true,
      claimed,
      processed: results.length,
      pagesProcessed: results.reduce((sum, result) => sum + result.pagesProcessed, 0),
      completed,
      blocked,
      pending: claimed - completed - blocked,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    await captureException(error, { feature: 'account_erasure_retry' });
    return NextResponse.json({ error: 'Account erasure retry failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return runAccountErasure(req);
}

export async function POST(req: NextRequest) {
  return runAccountErasure(req);
}
