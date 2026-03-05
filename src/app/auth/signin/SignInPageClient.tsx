/**
 * Custom Sign-in Page
 *
 * Provides a branded sign-in experience instead of the default NextAuth page.
 * Users are directed here by middleware when accessing protected routes.
 */

'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 mb-3">
            <Shield className="h-6 w-6 text-blue-600" aria-hidden="true" />
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
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            {error === 'OAuthSignin' && 'Could not start the sign-in process. Please try again.'}
            {error === 'OAuthCallback' && 'There was an error during sign-in. Please try again.'}
            {error === 'OAuthAccountNotLinked' && 'This email is already linked to another account.'}
            {error === 'Callback' && 'Sign-in failed. Please try again.'}
            {!['OAuthSignin', 'OAuthCallback', 'OAuthAccountNotLinked', 'Callback'].includes(error) &&
              'An unexpected error occurred. Please try again.'}
          </div>
        )}

        {/* Sign-in button */}
        <Button asChild className="w-full min-h-[44px] text-sm font-medium gap-2">
          <Link
            href={`/api/auth/signin/azure-ad?callbackUrl=${encodeURIComponent(callbackUrl)}`}
          >
            <svg viewBox="0 0 21 21" className="h-5 w-5" aria-hidden="true">
              <rect x="1" y="1" width="9" height="9" fill="#f25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
              <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
              <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
            </svg>
            Sign in with Microsoft
          </Link>
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
        ORAN does not store your full name, email, or GPS coordinates.
        Your approximate city is used for search only, with your consent.
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
