/**
 * Vercel Cron helpers.
 *
 * ORAN's scheduled jobs run as Vercel Cron (configured in vercel.json), replacing
 * the former timer-triggered Azure Functions. A cron route verifies the Vercel
 * cron secret and then invokes the corresponding internal endpoint (which already
 * enforces INTERNAL_API_KEY and contains the actual work), exactly as the Azure
 * timer functions did.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * True when the request carries the Vercel Cron bearer token (CRON_SECRET).
 * Vercel injects `Authorization: Bearer <CRON_SECRET>` on scheduled invocations.
 * In local dev (no CRON_SECRET set) we allow the call so `vercel dev` / manual
 * hits work; in production a missing/incorrect token is rejected.
 */
export function isAuthorizedCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== 'production';
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * Run a scheduled job by calling an internal POST endpoint on the same
 * deployment with the internal API key. Returns the internal response's status
 * and body so cron logs are actionable.
 */
export async function runCronJob(req: NextRequest, internalPath: string): Promise<NextResponse> {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.INTERNAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'INTERNAL_API_KEY not configured' }, { status: 503 });
  }

  const url = new URL(internalPath, req.nextUrl.origin);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    const body = await res.text();
    let json: unknown = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = { raw: body.slice(0, 500) };
    }
    return NextResponse.json(
      { ok: res.ok, status: res.status, job: internalPath, result: json },
      { status: res.ok ? 200 : 502, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, job: internalPath, error: error instanceof Error ? error.message : 'unknown' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
