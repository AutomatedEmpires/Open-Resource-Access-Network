/**
 * Custom Sign-in Page
 *
 * Three-path sign-in: Seeker, Organization, and Administration.
 * Each path routes to the correct portal after Microsoft OAuth.
 * The middleware enforces RBAC — this page only sets intent/callbackUrl.
 */

'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { Search, Building2, ShieldCheck, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ============================================================
// PATH DEFINITIONS
// ============================================================

type UserPath = 'seeker' | 'organization' | 'admin';

interface PathOption {
  id: UserPath;
  label: string;
  icon: React.ElementType;
  description: string;
  callbackUrl: string;
  guestAllowed: boolean;
  detail: string;
}

const PATHS: PathOption[] = [
  {
    id: 'seeker',
    label: 'Find Services',
    icon: Search,
    description: 'Looking for help or resources?',
    callbackUrl: '/chat',
    guestAllowed: true,
    detail: 'Search verified community resources, save favorites, and get personalized results.',
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: Building2,
    description: 'Manage your organization?',
    callbackUrl: '/claim',
    guestAllowed: false,
    detail: 'Register your organization or manage your service listings on ORAN.',
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: ShieldCheck,
    description: 'Platform staff?',
    callbackUrl: '/approvals',
    guestAllowed: false,
    detail: 'Community moderation, data verification, and platform management.',
  },
];

/** Detect which path to pre-select from a callbackUrl */
function detectPath(callbackUrl: string | null): UserPath {
  if (!callbackUrl) return 'seeker';
  if (/^\/(claim|org|services|locations|admins)/.test(callbackUrl)) return 'organization';
  if (/^\/(approvals|rules|audit|zone-management|ingestion|triage|queue|verify|coverage|appeals|scopes|templates)/.test(callbackUrl))
    return 'admin';
  return 'seeker';
}

// ============================================================
// ERROR MAP
// ============================================================

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: 'Could not start the sign-in process. Please try again.',
  OAuthCallback: 'There was an error during sign-in. Please try again.',
  OAuthAccountNotLinked: 'This email is already linked to another account.',
  Callback: 'Sign-in failed. Please try again.',
  AccessDenied: 'Access denied. You may not have permission to sign in.',
};

// ============================================================
// MICROSOFT LOGO
// ============================================================

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

// ============================================================
// MAIN CONTENT
// ============================================================

function SignInContent() {
  const searchParams = useSearchParams();
  const originalCallback = searchParams.get('callbackUrl');
  const error = searchParams.get('error');
  const detectedPath = detectPath(originalCallback);
  const [selected, setSelected] = useState<UserPath>(detectedPath);

  const activePath = PATHS.find((p) => p.id === selected)!;

  // If the user stays on the auto-detected path, preserve the original deep-link.
  // Otherwise use the selected path's default callback.
  const effectiveCallback =
    selected === detectedPath && originalCallback
      ? originalCallback
      : activePath.callbackUrl;

  const errorMessage = error
    ? ERROR_MESSAGES[error] ?? 'An unexpected error occurred. Please try again.'
    : null;

  return (
    <main className="container mx-auto max-w-lg px-4 py-12">
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-2 text-center">
          <h1 className="text-xl font-bold text-gray-900">Welcome to ORAN</h1>
          <p className="mt-1 text-sm text-gray-500">
            How would you like to use ORAN?
          </p>
        </div>

        {/* Path selector */}
        <div role="radiogroup" aria-label="Account type" className="px-6 pt-4 pb-2">
          <div className="grid grid-cols-3 gap-2">
            {PATHS.map(({ id, label, icon: Icon }) => {
              const isActive = selected === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setSelected(id)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-xs font-medium transition-all min-h-[44px] cursor-pointer ${
                    isActive
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Dynamic content area */}
        <div className="px-8 pb-8 pt-4">
          <p className="text-sm text-gray-600 text-center mb-5" data-testid="path-detail">
            {activePath.detail}
          </p>

          {/* Error message */}
          {errorMessage && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-error-soft bg-error-subtle p-3 text-sm text-error-deep"
            >
              {errorMessage}
            </div>
          )}

          {/* Sign-in button */}
          <Button
            className="w-full min-h-[44px] text-sm font-medium gap-2"
            onClick={() => signIn('azure-ad', { callbackUrl: effectiveCallback })}
          >
            <MicrosoftLogo />
            Sign in with Microsoft
          </Button>

          <p className="mt-3 text-xs text-gray-400 text-center">
            Secure sign-in via Microsoft Entra ID. No passwords stored by ORAN.
          </p>

          {/* Guest path (seekers only) */}
          {activePath.guestAllowed && (
            <div className="mt-5 text-center border-t border-gray-100 pt-4">
              <Link
                href={effectiveCallback}
                className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Continue without signing in
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Privacy note */}
      <p className="mt-4 text-xs text-gray-400 text-center max-w-sm mx-auto">
        By signing in, you agree to ORAN collecting your name, email, and
        location data to deliver and improve our services.
        See our <Link href="/privacy" className="underline hover:text-gray-600">Privacy Policy</Link> for
        details.
      </p>
    </main>
  );
}

// ============================================================
// EXPORTS
// ============================================================

export { detectPath, PATHS, ERROR_MESSAGES };
export type { UserPath };

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="container mx-auto max-w-lg px-4 py-12">
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm text-center">
            <p className="text-gray-500">Loading…</p>
          </div>
        </main>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
