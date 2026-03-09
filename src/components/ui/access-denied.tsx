/**
 * AccessDenied Component
 *
 * Rendered inside a portal layout when an authenticated user's role does not
 * meet the minimum required for that portal.
 *
 * NOTE: The middleware enforces server-side access control.  This component is
 * belt-and-suspenders UX — it fires when an authenticated session exists but
 * carries a lower role (e.g. role was downgraded after sign-in, or dev/test
 * scenarios where middleware is disabled).
 */

import React from 'react';
import Link from 'next/link';

export interface AccessDeniedProps {
  /** Display name of the portal the user attempted to access */
  portalName: string;
  /** Minimum role required — shown verbatim, e.g. "oran_admin" */
  requiredRole: string;
}

export function AccessDenied({ portalName, requiredRole }: AccessDeniedProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-orange-50 via-rose-50 to-emerald-50 px-4">
      <div className="max-w-md w-full text-center" role="main">
        {/* Lock icon */}
        <div
          aria-hidden="true"
          className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth="1.5"
            stroke="currentColor"
            className="h-8 w-8 text-red-600"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
            />
          </svg>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-stone-900">Access Denied</h1>

        <p className="mb-1 text-stone-600">
          You don&apos;t have permission to access the{' '}
          <strong>{portalName}</strong>.
        </p>

        <p className="mb-8 text-sm text-stone-500">
          This area requires the{' '}
          <code className="rounded bg-orange-100 px-1 py-0.5 text-xs text-stone-700">{requiredRole}</code>{' '}
          role or higher. Contact your administrator if you believe this is an
          error.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-orange-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2"
          >
            Go to Home
          </Link>

          <Link
            href="/api/auth/signout"
            className="inline-flex items-center justify-center rounded-full border border-orange-100 bg-white px-4 py-2 text-sm font-medium text-stone-700 transition-colors hover:bg-orange-50 focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2"
          >
            Sign Out
          </Link>
        </div>
      </div>
    </div>
  );
}
