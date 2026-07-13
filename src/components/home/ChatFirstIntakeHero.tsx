'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { List, MapPin, ShieldCheck } from 'lucide-react';

import { GuidedIntake } from '@/components/chat/GuidedIntake';
import { SITE } from '@/lib/site';

export function ChatFirstIntakeHero() {
  const router = useRouter();

  return (
    <section className="border-b border-slate-200 bg-white px-4 py-12 sm:py-20">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            {SITE.tagline}
          </p>
          <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Stored provider records · No advice or invented facts
          </div>
          <h1 className="mt-5 font-display text-4xl font-bold leading-tight tracking-tight text-slate-950 sm:text-6xl">
            Tell ORAN what is wrong.
            <span className="mt-2 block text-slate-500">Find the right next step.</span>
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-slate-600 sm:text-lg">
            Explain your situation in plain language. ORAN narrows the need, searches stored service records, and shows how to contact or apply—without making you browse hundreds of listings.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <Link href="/directory" className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">
              <List className="h-4 w-4" aria-hidden="true" />
              Browse directory
            </Link>
            <Link href="/map" className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              Open map
            </Link>
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-500">
            ORAN is not emergency response, a government authority, or medical or legal advice. If someone is in immediate danger, call 911. Call or text 988 for crisis support.
          </p>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4 shadow-xl sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Start here</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-950">What is happening?</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">ORAN will ask for more only when it can change the match.</p>
          <GuidedIntake
            className="mt-5"
            onSubmit={(prompt) => {
              router.push(`/chat?q=${encodeURIComponent(prompt)}`);
            }}
          />
        </div>
      </div>
    </section>
  );
}
