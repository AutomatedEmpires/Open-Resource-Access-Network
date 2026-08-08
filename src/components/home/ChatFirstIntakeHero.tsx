'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { List, MapPin, ShieldCheck } from 'lucide-react';

import { GuidedIntake } from '@/components/chat/GuidedIntake';

const SUGGESTED_NEEDS = [
  { label: 'Food', href: '/chat?q=food%20assistance' },
  { label: 'Housing', href: '/chat?q=housing%20help' },
  { label: 'Utility bills', href: '/chat?q=utility%20bill%20help' },
  { label: 'Health care', href: '/chat?q=health%20care' },
] as const;

export function ChatFirstIntakeHero() {
  const router = useRouter();
  const [handoffError, setHandoffError] = useState<string | null>(null);

  return (
    <section className="flex w-full flex-1 items-center bg-[var(--bg-page)] px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-3xl text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-[var(--brand-cobalt)]">
          Find local help
        </p>
        <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-[var(--text-primary)] sm:text-5xl">
          What do you need help with?
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[var(--text-secondary)] sm:text-base sm:leading-7">
          Tell ORAN what is happening in plain language. Results put each record&apos;s service scope, listed eligibility details, and missing information up front.
        </p>

        <div className="mt-6 rounded-[28px] border border-[var(--border-control)] bg-white p-3 text-left shadow-xl sm:mt-8 sm:p-4">
          <GuidedIntake
            compact
            submitLabel="Find help"
            onSubmit={async (submission) => {
              const { writeGuidedIntakeHandoff } = await import('@/services/chat/guidedIntakeHandoff');
              const stored = writeGuidedIntakeHandoff(submission);
              if (!stored) {
                setHandoffError('Chat could not be opened safely on this device. Your answers are still here—please try again.');
                return;
              }

              setHandoffError(null);
              router.push('/chat?from=guided');
            }}
          />
          {handoffError ? (
            <p className="mt-3 text-sm font-medium text-red-700" role="alert">{handoffError}</p>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2" aria-label="Common needs">
          <span className="text-xs text-[var(--text-muted)]">Try:</span>
          {SUGGESTED_NEEDS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="inline-flex min-h-[36px] items-center rounded-full border border-[var(--border)] bg-white px-3 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-[var(--border-control)] hover:text-[var(--text-primary)]"
            >
              {label}
            </Link>
          ))}
        </div>

        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <span className="text-sm text-[var(--text-secondary)]">Prefer to explore results yourself?</span>
          <div className="inline-flex rounded-xl border border-[var(--border)] bg-white p-1" aria-label="Browse services by view">
            <Link
              href="/directory"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-alt)]"
            >
              <List className="h-4 w-4" aria-hidden="true" />
              List view
            </Link>
            <Link
              href="/map"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-surface-alt)]"
            >
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Map view
            </Link>
          </div>
        </div>

        <p className="mx-auto mt-6 flex max-w-2xl items-start justify-center gap-2 text-left text-xs leading-5 text-[var(--text-muted)] sm:text-center">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand-cobalt)]" aria-hidden="true" />
          Stored service records. No account required. ORAN does not send your description to providers, and it does not guarantee eligibility or availability.
        </p>
        <p className="mx-auto mt-2 max-w-2xl text-xs leading-5 text-[var(--text-muted)]">
          ORAN is not emergency response or professional advice. In immediate danger, call 911; call or text 988 for crisis support.
        </p>
      </div>
    </section>
  );
}
