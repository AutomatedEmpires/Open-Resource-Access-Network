/**
 * ORAN Middleware
 *
 * Route-level authentication and authorization via Microsoft Entra ID.
 * If Entra is not configured (no AZURE_AD_CLIENT_ID env var), middleware is a no-op.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import type { OranRole } from '@/domain/types';
import { isRoleAtLeast } from '@/services/auth/roles';

// Protected route patterns by minimum role
const PROTECTED_ROUTES: { pattern: RegExp; minRole: OranRole }[] = [
  { pattern: /^\/(saved|profile|appeal|notifications)/, minRole: 'seeker' },
  { pattern: /^\/(host|host-forms|resource-studio|claim|org|locations|services|admins)/, minRole: 'host_member' },
  { pattern: /^\/(queue|verify|coverage|dashboard|community-forms)/, minRole: 'community_admin' },
  { pattern: /^\/(operations|approvals|rules|audit|zone-management|ingestion|appeals|reports|security|scopes|triage|templates|discovery-preview|forms)/, minRole: 'oran_admin' },
];

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const CSRF_PROTECTED_API_PREFIXES = [
  '/api/profile',
  '/api/saved',
  '/api/user',
  '/api/host',
  '/api/community',
  '/api/admin',
  '/api/forms',
  '/api/templates',
  '/api/submissions',
  '/api/feedback',
  '/api/chat',
  '/api/tts',
  '/api/reports',
] as const;

const ENTRA_CLIENT_ID = process.env.AZURE_AD_CLIENT_ID;

function isProtectedApiWrite(request: NextRequest): boolean {
  const method = request.method?.toUpperCase() ?? 'GET';
  if (!STATE_CHANGING_METHODS.has(method)) {
    return false;
  }

  const { pathname } = request.nextUrl;
  return CSRF_PROTECTED_API_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function isSameOriginWriteAllowed(request: NextRequest): boolean {
  if (request.headers.get('authorization')) {
    return true;
  }

  const origin = request.headers.get('origin')?.trim();
  if (origin) {
    return origin === request.nextUrl.origin;
  }

  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite === 'same-origin' || fetchSite === 'same-site') {
    return true;
  }

  return process.env.NODE_ENV !== 'production';
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isProtectedApiWrite(request) && !isSameOriginWriteAllowed(request)) {
    return new NextResponse('Cross-site state-changing requests are forbidden', { status: 403 });
  }

  // Check if route requires authentication
  const protectedRoute = PROTECTED_ROUTES.find((r) => r.pattern.test(pathname));
  if (!protectedRoute) {
    return NextResponse.next();
  }

  // If Entra is not configured, skip auth (development/test mode)
  if (!ENTRA_CLIENT_ID) {
    // In production, protected routes must not be reachable without auth configured.
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('Authentication is not configured', { status: 503 });
    }
    return NextResponse.next();
  }

  try {
    // Decode JWT token from session cookie using next-auth/jwt
    // This works in Edge middleware and extracts claims including role
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!token) {
      // No valid session token — redirect to sign-in
      const signInUrl = new URL('/api/auth/signin', request.url);
      signInUrl.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(signInUrl);
    }

    // Extract role from token (default to 'seeker' if not present)
    const userRole = (token.role as OranRole) ?? 'seeker';

    // Check if user's role meets the minimum required for this route
    if (!isRoleAtLeast(userRole, protectedRoute.minRole)) {
      return new NextResponse('Forbidden: Insufficient permissions', { status: 403 });
    }

    // Role check passed — allow request
    return NextResponse.next();
  } catch {
    // In production, protected routes must fail closed.
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('Authentication is temporarily unavailable', { status: 503 });
    }
    return NextResponse.next();
  }
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
