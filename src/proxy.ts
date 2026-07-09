/**
 * ORAN Middleware (Next.js `proxy`)
 *
 * Route-level authentication via Clerk, plus cross-site write (CSRF) protection.
 *
 * - Authentication: protected routes require a signed-in Clerk session.
 * - Authorization: fine-grained ROLE checks are enforced in the DB-driven server
 *   layer (`getAuthContext()` / guards in every API route), not here — the Edge
 *   middleware cannot read `user_profiles.role`. This keeps data access secure
 *   regardless of the middleware.
 * - When Clerk is not configured (no publishable key), protected routes fail
 *   closed in production and are permitted in local dev.
 */

import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that require an authenticated user (role enforced server-side).
const isProtectedRoute = createRouteMatcher([
  '/saved(.*)', '/profile(.*)', '/appeal(.*)', '/notifications(.*)', '/plan(.*)',
  '/host(.*)', '/host-forms(.*)', '/resource-studio(.*)', '/claim(.*)', '/org(.*)',
  '/locations(.*)', '/services(.*)', '/admins(.*)',
  '/queue(.*)', '/verify(.*)', '/coverage(.*)', '/dashboard(.*)', '/community-forms(.*)',
  '/operations(.*)', '/approvals(.*)', '/rules(.*)', '/audit(.*)', '/zone-management(.*)',
  '/ingestion(.*)', '/appeals(.*)', '/reports(.*)', '/admin-security(.*)', '/scopes(.*)',
  '/triage(.*)', '/templates(.*)', '/discovery-preview(.*)', '/forms(.*)',
]);

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_PROTECTED_API_PREFIXES = [
  '/api/profile', '/api/saved', '/api/user', '/api/host', '/api/community',
  '/api/admin', '/api/forms', '/api/templates', '/api/submissions', '/api/feedback',
  '/api/chat', '/api/tts', '/api/reports',
] as const;

function isProtectedApiWrite(request: NextRequest): boolean {
  const method = request.method?.toUpperCase() ?? 'GET';
  if (!STATE_CHANGING_METHODS.has(method)) return false;

  const { pathname } = request.nextUrl;
  return CSRF_PROTECTED_API_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isSameOriginWriteAllowed(request: NextRequest): boolean {
  if (request.headers.get('authorization')) return true;

  const origin = request.headers.get('origin')?.trim();
  if (origin) return origin === request.nextUrl.origin;

  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite === 'same-origin' || fetchSite === 'same-site') return true;

  return process.env.NODE_ENV !== 'production';
}

const CLERK_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const proxy = clerkMiddleware(async (auth, request) => {
  // CSRF: block cross-site state-changing API writes.
  if (isProtectedApiWrite(request) && !isSameOriginWriteAllowed(request)) {
    return new NextResponse('Cross-site state-changing requests are forbidden', { status: 403 });
  }

  if (!isProtectedRoute(request)) {
    return NextResponse.next();
  }

  // Clerk not configured: fail closed in production, allow in local dev.
  if (!CLERK_CONFIGURED) {
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('Authentication is not configured', { status: 503 });
    }
    return NextResponse.next();
  }

  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn({ returnBackUrl: request.url });
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Run on everything except static assets and images.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
