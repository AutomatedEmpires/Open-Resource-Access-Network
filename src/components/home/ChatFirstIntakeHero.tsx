'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { List, MapPin, ShieldCheck } from 'lucide-react';

import { GuidedIntake } from '@/components/chat/GuidedIntake';
import { SITE } from '@/lib/site';

export function ChatFirstIntakeHero() {
  const router = useRouter();
  const [handoffError, setHandoffError] = useState<string | null>(null);

  return (
    <section className="relative isolate overflow-hidden border-b border-blue-950 bg-gradient-brand-deep px-4 py-12 text-white sm:py-20">
      <div className="pointer-events-none absolute -left-24 -top-28 -z-10 h-80 w-80 rounded-full border border-white/20 bg-sky-300/20 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-40 -right-20 -z-10 h-96 w-96 rounded-full border border-sky-200/20 bg-blue-950/45 blur-2xl" aria-hidden="true" />
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2 lg:items-center">
        <div className="relative">
          <p className="inline-flex rounded-full border border-white/40 bg-blue-950/35 px-4 py-2 text-sm font-extrabold uppercase tracking-widest text-white shadow-xl backdrop-blur sm:text-base">
            {SITE.tagline}
          </p>
          <div className="mt-4 flex w-fit items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-sky-50 backdrop-blur">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Stored provider records · No advice or invented facts
          </div>
          <h1 className="mt-6 font-display text-4xl font-bold leading-none tracking-tight text-white sm:text-6xl">
            Tell ORAN what is wrong.
            <span className="mt-2 block text-sky-100">Find the right next step.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-blue-50 sm:text-lg">
            Explain your situation in plain language. ORAN narrows the need, searches stored service records, and shows how to contact or apply—without making you browse hundreds of listings.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link href="/scroll" className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white bg-white px-4 py-2 font-bold text-blue-900 shadow-xl transition-transform hover:-translate-y-0.5 hover:bg-sky-50 motion-reduce:transform-none motion-reduce:transition-none">
              <List className="h-4 w-4" aria-hidden="true" />
              Scroll resources
            </Link>
            <Link href="/map" className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/55 bg-blue-950/25 px-4 py-2 font-bold text-white backdrop-blur transition-colors hover:bg-white/15">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Open map
            </Link>
          </div>
          <p className="mt-5 max-w-xl text-xs leading-5 text-blue-100">
            ORAN is not emergency response, a government authority, or medical or legal advice. If someone is in immediate danger, call 911. Call or text 988 for crisis support.
          </p>
        </div>

        <div className="rounded-3xl bg-gradient-chrome p-px shadow-2xl">
          <div className="rounded-3xl bg-white p-4 text-slate-900 sm:p-6">
            <p className="text-xs font-extrabold uppercase tracking-[0.22em] text-blue-700">Start here</p>
            <h2 className="mt-2 font-display text-2xl font-bold text-[var(--brand-navy)]">What is happening?</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">ORAN will ask for more only when it can change the match.</p>
            <GuidedIntake
              className="mt-5"
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
        </div>
      </div>
    </section>
  );
}
