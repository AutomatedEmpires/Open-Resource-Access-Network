/**
 * Custom Sign-in Page
 *
 * Provides a branded sign-in experience instead of the default NextAuth page.
 * Users are directed here by middleware when accessing protected routes.
 */

'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { Shield, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

function SignInContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/chat';
  const error = searchParams.get('error');

  return (
    <main className="container mx-auto max-w-md px-4 py-16">
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-info-muted mb-3">
            <Shield className="h-6 w-6 text-action-base" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Sign in to ORAN</h1>
          <p className="mt-1 text-sm text-gray-600">
            Sign in to save services, manage your profile, and get personalized results.
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-error-soft bg-error-subtle p-3 text-sm text-error-deep"
          >
            {error === 'OAuthSignin' && 'Could not start the sign-in process. Please try again.'}
            {error === 'OAuthCallback' && 'There was an error during sign-in. Please try again.'}
            {error === 'OAuthAccountNotLinked' && 'This email is already linked to another account.'}
            {error === 'Callback' && 'Sign-in failed. Please try again.'}
            {error === 'AccessDenied' && 'Access denied. You may not have permission to sign in.'}
            {!['OAuthSignin', 'OAuthCallback', 'OAuthAccountNotLinked', 'Callback', 'AccessDenied'].includes(error) &&
              'An unexpected error occurred. Please try again.'}
          </div>
        )}

        {/* Sign-in button */}
        <Button
          className="w-full min-h-[44px] text-sm font-medium gap-2"
          onClick={() => signIn('azure-ad', { callbackUrl })}
        >
          <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Sign in with Microsoft
        </Button>

        {/* Info text */}
        <p className="mt-4 text-xs text-gray-500 text-center">
          ORAN uses Microsoft Entra ID for secure authentication.
          No passwords are stored by ORAN.
        </p>

        {/* Back link */}
        <div className="mt-6 text-center">
          <Link
            href={callbackUrl}
            className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Continue without signing in
          </Link>
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

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <main className="container mx-auto max-w-md px-4 py-16">
          <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm text-center">
            <p className="text-gray-500">Loading…</p>
          </div>
        </main>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
