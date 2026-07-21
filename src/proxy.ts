/**
 * ORAN Middleware
 *
 * Route-level identity enforcement via Clerk plus same-origin write protection.
 * ORAN roles remain database-owned and are enforced by route handlers/layouts.
 */

import { NextResponse } from 'next/server';
import type { NextFetchEvent, NextRequest } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';

const PROTECTED_ROUTES: RegExp[] = [
  /^\/(saved|profile|appeal|notifications)/,
  /^\/(host|host-forms|resource-studio|claim|org|locations|services|admins)/,
  /^\/(queue|verify|coverage|dashboard|community-forms)/,
  /^\/(operations|approvals|rules|audit|zone-management|ingestion|appeals|reports|admin-security|scopes|triage|templates|discovery-preview|forms)/,
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
  '/api/resource-submissions',
  '/api/feedback',
  '/api/chat',
  '/api/tts',
  '/api/reports',
] as const;

const CLERK_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  && process.env.CLERK_SECRET_KEY,
);

const CLERK_AUTHORIZED_PARTIES = [
  'https://openresourceaccessnetwork.com',
  'https://www.openresourceaccessnetwork.com',
] as const;

function getClerkAuthorizedParties(): string[] {
  const parties = new Set<string>(CLERK_AUTHORIZED_PARTIES);

  if (process.env.VERCEL_ENV !== 'preview') {
    return [...parties];
  }

  for (const host of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) {
    const trimmedHost = host?.trim();
    if (!trimmedHost) continue;

    try {
      const candidate = new URL(`https://${trimmedHost}`);
      const isExactVercelHostname = candidate.hostname.endsWith('.vercel.app');
      const isBareOrigin = candidate.username === ''
        && candidate.password === ''
        && candidate.port === ''
        && candidate.pathname === '/'
        && candidate.search === ''
        && candidate.hash === ''
        && candidate.host === trimmedHost.toLowerCase();

      if (isExactVercelHostname && isBareOrigin) {
        parties.add(candidate.origin);
      }
    } catch {
      // Ignore malformed provider metadata; the canonical production origins
      // remain authorized and protected routes continue to fail closed.
    }
  }

  return [...parties];
}

function runEarlyRouteBoundary(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;

  // Encoded Windows path separators can reach filesystem route resolution on
  // Windows and turn an invalid URL into an internal module lookup. Reject the
  // path while it is still encoded; query values are intentionally excluded.
  if (/%5c/i.test(pathname)) {
    return new NextResponse('Invalid request path', {
      status: 400,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'text/plain; charset=utf-8',
      },
    });
  }

  // Preserve old Clerk entry-point links and their return intent. Supporting
  // nested paths also keeps path-routed Clerk flow URLs intact.
  if (pathname === '/sign-in' || pathname.startsWith('/sign-in/')) {
    const destination = new URL(request.url);
    destination.pathname = `/auth/signin${pathname.slice('/sign-in'.length)}`;
    return NextResponse.redirect(destination, 308);
  }

  return null;
}

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
    if (origin === request.nextUrl.origin) {
      return true;
    }

    // Next can normalize nextUrl.origin to the configured canonical host in
    // development and behind proxies. Compare against the actual HTTP Host as
    // well so a browser request to 127.0.0.1 (or a forwarded deployment host)
    // is not mistaken for a cross-site write. Browsers do not allow scripts to
    // forge either Origin or Host.
    try {
      const requestHost = request.headers.get('host')?.trim().toLowerCase();
      return Boolean(requestHost && new URL(origin).host.toLowerCase() === requestHost);
    } catch {
      return false;
    }
  }

  const fetchSite = request.headers.get('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite === 'same-origin' || fetchSite === 'same-site') {
    return true;
  }

  return process.env.NODE_ENV !== 'production';
}

function runRequestBoundary(
  request: NextRequest,
  clerkUserId: string | null,
  identityUnavailable = false,
): NextResponse {
  const { pathname } = request.nextUrl;

  if (isProtectedApiWrite(request) && !isSameOriginWriteAllowed(request)) {
    return new NextResponse('Cross-site state-changing requests are forbidden', { status: 403 });
  }

  // Check if route requires authentication
  const protectedRoute = PROTECTED_ROUTES.find((pattern) => pattern.test(pathname));
  if (!protectedRoute) {
    return NextResponse.next();
  }

  // Local development may run without Clerk; production always fails closed.
  if (!CLERK_CONFIGURED) {
    // In production, protected routes must not be reachable without auth configured.
    if (process.env.NODE_ENV === 'production') {
      return new NextResponse('Authentication is not configured', { status: 503 });
    }
    return NextResponse.next();
  }

  if (identityUnavailable) {
    return new NextResponse('Authentication is temporarily unavailable', { status: 503 });
  }

  if (!clerkUserId) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set(
      'redirect_url',
      `${pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

const clerkProxy = clerkMiddleware(async (clerkAuth, request) => {
  const { userId } = await clerkAuth();
  return runRequestBoundary(request, userId);
}, {
  authorizedParties: process.env.NODE_ENV === 'production'
    ? getClerkAuthorizedParties()
    : undefined,
});

export async function proxy(request: NextRequest, event: NextFetchEvent): Promise<Response> {
  const earlyResponse = runEarlyRouteBoundary(request);
  if (earlyResponse) {
    return earlyResponse;
  }

  if (!CLERK_CONFIGURED) {
    return runRequestBoundary(request, null);
  }

  try {
    const response = await clerkProxy(request, event);
    return response ?? runRequestBoundary(request, null, true);
  } catch {
    // Public discovery remains available during an IdP interruption, while
    // protected surfaces fail closed with an explicit service response.
    return runRequestBoundary(request, null, true);
  }
}

export const config = {
  matcher: [
    // Always intercept encoded backslashes, including asset-shaped paths that
    // the general extension exclusion below intentionally skips.
    '/((?:.*%5[cC].*))',
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder
     */
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
};
