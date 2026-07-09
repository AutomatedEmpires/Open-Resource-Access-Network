/**
 * GET /api/me
 *
 * Lightweight current-user endpoint for client components. Resolves the
 * Clerk-authenticated user's ORAN role, account status, and org memberships via
 * the DB-driven `getAuthContext()` seam. Powers the `useOranSession()` client
 * hook (see src/services/auth/useOranSession.ts).
 *
 * Always returns 200 so the client can distinguish "signed out" from an error:
 *   { authenticated: false } | { authenticated: true, user: {...} }
 */

import { NextResponse } from 'next/server';
import { getAuthContext } from '@/services/auth/session';

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ authenticated: false }, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: ctx.userId,
        role: ctx.role,
        accountStatus: ctx.accountStatus,
        orgIds: ctx.orgIds,
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
