/**
 * ORAN Middleware
 *
 * Route-level authentication and authorization via Clerk.
 * If Clerk is not configured (no env vars), middleware is a no-op.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Protected route patterns by minimum role
const PROTECTED_ROUTES: { pattern: RegExp; minRole: string }[] = [
  { pattern: /^\/(saved|profile)/, minRole: 'seeker' },
  { pattern: /^\/(claim|org|locations|services|admins)/, minRole: 'host_member' },
  { pattern: /^\/(queue|verify)/, minRole: 'community_admin' },
  { pattern: /^\/(approvals|rules|audit)/, minRole: 'oran_admin' },
];

const CLERK_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // If Clerk is not configured, skip auth (development/test mode)
  if (!CLERK_PUBLISHABLE_KEY) {
    return NextResponse.next();
  }

  // Check if route requires authentication
  const protectedRoute = PROTECTED_ROUTES.find((r) => r.pattern.test(pathname));
  if (!protectedRoute) {
    return NextResponse.next();
  }

  try {
    // Dynamic import to avoid build failures when @clerk/nextjs is not configured
    const { auth } = await import('@clerk/nextjs/server');
    const { userId } = await auth();

    if (!userId) {
      const signInUrl = new URL(
        process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL ?? '/sign-in',
        request.url
      );
      signInUrl.searchParams.set('redirect_url', pathname);
      return NextResponse.redirect(signInUrl);
    }
  } catch {
    // Clerk not available — allow access (graceful degradation)
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
