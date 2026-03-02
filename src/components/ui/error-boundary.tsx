/**
 * ORAN Error Boundary
 * Catches render errors and shows a human-readable message with retry.
 * Never exposes stack traces or PII in production.
 */

'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback — if omitted, the default ORAN error panel is shown */
  fallback?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to telemetry (Sentry) if wired — never include PII
    console.error('[ORAN ErrorBoundary]', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          role="alert"
          className="flex flex-col items-center justify-center gap-4 rounded-lg border border-gray-200 bg-white p-8 text-center"
        >
          <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Something went wrong</h2>
            <p className="mt-1 text-sm text-gray-500">
              We couldn&apos;t load this section. Your data is safe.
            </p>
          </div>
          <Button onClick={this.handleRetry} variant="outline" size="sm">
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
