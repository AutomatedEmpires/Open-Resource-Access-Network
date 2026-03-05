/**
 * NextAuth.js API Route Handler
 *
 * Wires NextAuth.js into the Next.js App Router.
 * Uses Microsoft Entra ID as the sole authentication provider.
 * Rate-limited to prevent brute-force login attempts.
 *
 * See: src/lib/auth.ts for configuration.
 */

import { NextRequest, NextResponse } from 'next/server';
import NextAuth from 'next-auth';
import { authOptions } from '@/lib/auth';
import { checkRateLimit } from '@/services/security/rateLimit';
import { RATE_LIMIT_WINDOW_MS } from '@/domain/constants';

/** Max auth requests per window (generous for OAuth callbacks) */
const AUTH_RATE_LIMIT_MAX = 30;

const nextAuthHandler = NextAuth(authOptions);

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function rateLimitGuard(req: NextRequest): NextResponse | null {
  const ip = getIp(req);
  const rl = checkRateLimit(`auth:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: AUTH_RATE_LIMIT_MAX,
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
  return null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const blocked = rateLimitGuard(req);
  if (blocked) return blocked;
  const params = await Promise.resolve(ctx.params);
  return nextAuthHandler(req as unknown as Request, { params }) as Promise<Response>;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const blocked = rateLimitGuard(req);
  if (blocked) return blocked;
  const params = await Promise.resolve(ctx.params);
  return nextAuthHandler(req as unknown as Request, { params }) as Promise<Response>;
}
