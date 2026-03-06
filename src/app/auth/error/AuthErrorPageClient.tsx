/**
 * Auth Error Page
 *
 * Displayed when NextAuth.js encounters an authentication error.
 */

'use client';

import React, { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: 'There is a problem with the server configuration. Please contact support.',
  AccessDenied: 'You do not have permission to sign in.',
  Verification: 'The verification link has expired or has already been used.',
  Default: 'An unexpected authentication error occurred.',
};

function ErrorContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error') ?? 'Default';
  const message = ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default;

  return (
    <main className="container mx-auto max-w-md px-4 py-16">
      <div className="rounded-lg border border-gray-200 bg-white p-8 shadow-sm text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-error-muted mb-3">
          <AlertTriangle className="h-6 w-6 text-error-base" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Authentication Error</h1>
        <p className="text-sm text-gray-600 mb-6">{message}</p>

        <div className="flex flex-col gap-3">
          <Link href="/auth/signin">
            <Button className="w-full min-h-[44px]">Try again</Button>
          </Link>
          <Link
            href="/chat"
            className="inline-flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Continue without signing in
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function AuthErrorPage() {
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
      <ErrorContent />
    </Suspense>
  );
}
