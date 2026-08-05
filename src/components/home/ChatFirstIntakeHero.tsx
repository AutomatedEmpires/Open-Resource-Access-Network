'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';

import { GuidedIntake } from '@/components/chat/GuidedIntake';

export function ChatFirstIntakeHero() {
  const router = useRouter();
  const [handoffError, setHandoffError] = useState<string | null>(null);

  return (
    <section className="border-b border-[var(--border)] bg-[var(--bg-page)] px-4 py-6 sm:py-10 lg:py-14">
      <div className="mx-auto grid max-w-6xl gap-4 sm:gap-7 lg:grid-cols-2 lg:items-center lg:gap-12">
        <div>
          <p className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--brand-cobalt)] sm:text-sm">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            No account required
          </p>
          <h1 className="mt-2 max-w-xl font-display text-3xl font-bold leading-tight tracking-tight text-[var(--text-primary)] sm:mt-4 sm:text-5xl">
            Find services and benefits that may help.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--text-secondary)] sm:mt-5 sm:text-lg sm:leading-7">
            Describe what you need. ORAN searches source-backed service listings and shows contact or application details when they are available.
          </p>
          <div className="hidden lg:block">
            <p className="mt-4 max-w-xl text-sm leading-6 text-[var(--text-secondary)]">
              Providers decide eligibility and availability. Confirm details before visiting or applying.
            </p>
            <Link
              href="/directory"
              className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface-alt)]"
            >
              Browse all services
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <p className="mt-5 max-w-xl text-xs leading-5 text-[var(--text-muted)]">
              ORAN provides service information, not emergency response or medical, legal, or financial advice.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-white p-4 shadow-lg sm:p-7 sm:shadow-xl">
          <h2 className="font-display text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl">
            Start your search
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
            A short sentence is enough. Add a city or ZIP if you want nearby options.
          </p>
          <GuidedIntake
            className="mt-4 sm:mt-5"
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
          <p className="mt-4 border-t border-[var(--border-subtle)] pt-4 text-xs leading-5 text-[var(--text-muted)]">
            ORAN does not send your description to listed service providers. Providers decide eligibility and availability; confirm details before visiting or applying.
          </p>
        </div>

        <p className="text-xs leading-5 text-[var(--text-muted)] lg:hidden">
          ORAN provides service information, not emergency response or medical, legal, or financial advice.
        </p>
      </div>
    </section>
  );
}
