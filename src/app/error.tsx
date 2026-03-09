'use client';

/**
 * App-level Error Boundary — catches errors in page segments.
 *
 * Renders within the root layout (fonts, providers, etc. are still available).
 * Reports to Sentry, displays a branded recovery UI with navigation.
 */

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    import('@/services/telemetry/sentry').then(({ captureException }) => {
      captureException(error, { feature: 'app_error_boundary' });
    }).catch(() => {});
  }, [error]);

  return (
    <main
      id="main-content"
      role="alert"
      className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center"
    >
      <div className="rounded-full bg-error-muted p-4 mb-6">
        <svg
          className="h-10 w-10 text-error-base"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
          />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 mb-2">
        Something went wrong
      </h1>
      <p className="text-gray-600 max-w-md mb-6">
        An unexpected error occurred while loading the page. Our team has been
        notified and is looking into it.
      </p>

      {error.digest && (
        <p className="text-xs text-gray-500 mb-4">
          Error ID: {error.digest}
        </p>
      )}

      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link
          href="/"
          className="px-5 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
