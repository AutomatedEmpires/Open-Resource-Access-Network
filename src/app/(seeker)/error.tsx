'use client';

/**
 * Seeker Error Boundary — catches errors in seeker pages.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { buildDiscoveryHref } from '@/services/search/discovery';
import { readStoredDiscoveryPreference } from '@/services/profile/discoveryPreference';

export default function SeekerError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [discoveryPreference, setDiscoveryPreference] = useState<ReturnType<typeof readStoredDiscoveryPreference>>({});

  useEffect(() => {
    import('@/services/telemetry/sentry').then(({ captureException }) => {
      captureException(error, { feature: 'seeker_error_boundary' });
    }).catch(() => {});
  }, [error]);

  useEffect(() => {
    setDiscoveryPreference(readStoredDiscoveryPreference());
  }, []);

  const chatHref = useMemo(() => buildDiscoveryHref('/chat', discoveryPreference), [discoveryPreference]);

  return (
    <main
      id="main-content"
      role="alert"
      className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center"
    >
      <div className="mb-6 rounded-full bg-error-muted p-4">
        <svg className="h-10 w-10 text-error-base" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      </div>

      <h1 className="mb-2 text-2xl font-bold text-stone-900">
        Something went wrong
      </h1>
      <p className="mb-6 max-w-md text-stone-600">
        We couldn&apos;t load this page. You can try again or search for services
        using the links below.
      </p>

      {error.digest && (
        <p className="mb-4 text-xs text-stone-400">Error ID: {error.digest}</p>
      )}

      <div className="flex gap-3">
        <Button onClick={reset}>Try again</Button>
        <Link
          href={chatHref}
          className="rounded-full bg-orange-100 px-5 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-orange-200"
        >
          Search services
        </Link>
      </div>
    </main>
  );
}
