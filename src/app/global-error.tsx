'use client';

/**
 * Global Error Boundary — catches errors in the root layout itself.
 *
 * Must provide its own <html> and <body> since the root layout may have failed.
 * Reports to Sentry, displays a branded recovery UI.
 */

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Dynamic import to avoid bundling Sentry if not configured
    import('@/services/telemetry/sentry').then(({ captureException }) => {
      captureException(error, { feature: 'global_error_boundary' });
    }).catch(() => {
      // Sentry not available — swallow silently
    });
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased" style={{ fontFamily: 'system-ui, Arial, Helvetica, sans-serif' }}>
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '2rem',
            textAlign: 'center',
            backgroundColor: '#ffffff',
            color: '#171717',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '1rem', color: '#6b7280', maxWidth: '28rem', marginBottom: '1.5rem' }}>
            An unexpected error occurred. Our team has been notified.
          </p>
          {error.digest && (
            <p style={{ fontSize: '0.75rem', color: '#9ca3af', marginBottom: '1rem' }}>
              Error ID: {error.digest}
            </p>
          )}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              onClick={reset}
              style={{
                padding: '0.625rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#ffffff',
                backgroundColor: '#2563eb',
                border: 'none',
                borderRadius: '0.375rem',
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
            <a
              href="/"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0.625rem 1.25rem',
                fontSize: '0.875rem',
                fontWeight: 500,
                color: '#374151',
                backgroundColor: '#f3f4f6',
                borderRadius: '0.375rem',
                textDecoration: 'none',
              }}
            >
              Go home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
