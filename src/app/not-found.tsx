/**
 * Custom 404 — Not Found page.
 *
 * Server component. Full-page branded 404 with navigation chrome,
 * 4 helpful escape hatches, and an above-fold crisis resource reminder.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin, MessageCircle, List, Home, Phone } from 'lucide-react';
import { AppNav } from '@/components/nav/AppNav';
import { AppFooter } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Page not found — ORAN',
  description: 'The page you are looking for does not exist or has been moved.',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-page)]">
      <AppNav />

      <main
        id="main-content"
        className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center"
      >
        {/* Icon */}
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg-surface)]">
          <MapPin className="h-9 w-9 text-[var(--text-primary)]" aria-hidden="true" />
        </div>

        {/* Headline */}
        <h1 className="mb-3 text-3xl font-bold text-[var(--text-primary)]">Page not found</h1>
        <p className="mb-10 max-w-md leading-relaxed text-[var(--text-secondary)]">
          We couldn&apos;t find what you were looking for. The page may have moved or
          the link may be incorrect. Here are some starting points:
        </p>

        {/* Escape hatches — 2×2 grid */}
        <div className="mb-12 grid w-full max-w-sm grid-cols-2 gap-3">
          <Link
            href="/"
            className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
          >
            <Home className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            Go home
          </Link>
          <Link
            href="/chat"
            className="flex items-center justify-center gap-2 rounded-lg border border-[var(--text-primary)] bg-[var(--text-primary)] px-4 py-3 text-sm font-semibold text-[var(--bg-page)] shadow-sm transition-colors hover:opacity-90"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Find services
          </Link>
          <Link
            href="/directory"
            className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
          >
            <List className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            Directory
          </Link>
          <Link
            href="/map"
            className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 text-sm font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:bg-[var(--bg-surface-alt)] hover:text-[var(--text-primary)]"
          >
            <MapPin className="h-4 w-4 text-[var(--text-muted)]" aria-hidden="true" />
            View map
          </Link>
        </div>

        {/* Crisis reminder */}
        <div className="flex max-w-md items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-left text-sm">
          <Phone className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" aria-hidden="true" />
          <p className="text-red-700">
            <strong>Need immediate help?</strong>{' '}Call{' '}
            <a href="tel:911" className="font-bold underline">911</a> for emergencies,{' '}
            <a href="tel:988" className="font-bold underline">988</a> for mental health crisis, or{' '}
            <a href="tel:211" className="font-bold underline">211</a> for community services.
          </p>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
