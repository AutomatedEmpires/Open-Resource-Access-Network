'use client';

import React, { Suspense, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { SignIn } from '@clerk/nextjs';
import { ArrowLeft, Building2, Search, ShieldCheck } from 'lucide-react';

export type UserPath = 'seeker' | 'organization' | 'admin';

interface PathOption {
  id: UserPath;
  label: string;
  icon: React.ElementType;
  callbackUrl: string;
  guestAllowed: boolean;
  detail: string;
  accessTitle: string;
  accessNotes: string[];
}

export const PATHS: PathOption[] = [
  {
    id: 'seeker',
    label: 'Find support',
    icon: Search,
    callbackUrl: '/chat',
    guestAllowed: true,
    detail: 'Find verified community and government resources, then save what helps.',
    accessTitle: 'Open to everyone',
    accessNotes: [
      'Browse and chat without creating an account.',
      'Sign in to save resources and carry your preferences across devices.',
    ],
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: Building2,
    callbackUrl: '/claim',
    guestAllowed: false,
    detail: 'Claim and maintain services your organization provides.',
    accessTitle: 'For service-provider teams',
    accessNotes: [
      'Create your personal account first.',
      'Organization access begins after the claim is reviewed and approved.',
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: ShieldCheck,
    callbackUrl: '/dashboard',
    guestAllowed: false,
    detail: 'Verify resources, monitor coverage, and operate the network.',
    accessTitle: 'For approved ORAN teams',
    accessNotes: [
      'Community and platform roles are assigned by ORAN.',
      'Signing up never grants administrative access automatically.',
    ],
  },
];

export function detectPath(callbackUrl: string | null): UserPath {
  if (!callbackUrl) return 'seeker';
  if (/^\/(claim|host|host-forms|resource-studio|org|services|locations|admins)/.test(callbackUrl)) {
    return 'organization';
  }
  if (/^\/(operations|approvals|rules|audit|zone-management|ingestion|triage|queue|verify|coverage|dashboard|appeals|reports|admin-security|scopes|templates)/.test(callbackUrl)) {
    return 'admin';
  }
  return 'seeker';
}

export function safeRedirect(value: string | null, fallback: string): string {
  if (
    !value
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const base = new URL('https://oran.local');
    const destination = new URL(value, base);
    if (destination.origin !== base.origin) return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}

function SignInContent() {
  const searchParams = useSearchParams();
  const requestedRedirect = searchParams.get('redirect_url') ?? searchParams.get('callbackUrl');
  const detectedPath = detectPath(requestedRedirect);
  const [selected, setSelected] = useState<UserPath>(detectedPath);
  const activePath = PATHS.find((path) => path.id === selected) ?? PATHS[0];

  const effectiveRedirect = useMemo(() => {
    if (selected === detectedPath) {
      return safeRedirect(requestedRedirect, activePath.callbackUrl);
    }
    return activePath.callbackUrl;
  }, [activePath.callbackUrl, detectedPath, requestedRedirect, selected]);

  const signUpRedirect = selected === 'seeker' ? '/onboarding' : effectiveRedirect;

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-300 via-blue-800 to-blue-950 px-4 py-8 sm:py-12">
      <div className="mx-auto grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/30 bg-white/90 shadow-2xl backdrop-blur-xl lg:grid-cols-2">
        <section className="bg-gradient-to-br from-blue-950 via-blue-800 to-cyan-600 p-6 text-white sm:p-9" aria-labelledby="signin-heading">
          <p className="text-xs font-extrabold uppercase tracking-widest text-cyan-100">
            Open Resource Access Network
          </p>
          <h1 id="signin-heading" className="mt-4 font-display text-3xl font-black tracking-tight sm:text-4xl">
            Welcome to ORAN
          </h1>
          <p className="mt-3 text-base font-semibold text-blue-50">
            Building Bridges | Strengthening Communities
          </p>
          <p className="mt-7 text-sm font-bold uppercase tracking-widest text-cyan-100">
            How will you use ORAN?
          </p>
          <div role="radiogroup" aria-label="Account path" className="mt-3 grid gap-2">
            {PATHS.map(({ id, label, icon: Icon }) => {
              const active = selected === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setSelected(id)}
                  className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-bold transition ${
                    active
                      ? 'border-white bg-white text-blue-950 shadow-lg'
                      : 'border-white/30 bg-blue-950/25 text-white hover:border-white/70 hover:bg-blue-900/50'
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>

          <div className="mt-6 rounded-2xl border border-white/25 bg-blue-950/25 p-4">
            <p className="font-bold">{activePath.accessTitle}</p>
            <p className="mt-1 text-sm text-blue-50">{activePath.detail}</p>
            <ul className="mt-3 space-y-1 text-sm text-blue-50">
              {activePath.accessNotes.map((note) => <li key={note}>• {note}</li>)}
            </ul>
          </div>

          {activePath.guestAllowed && (
            <Link
              href={effectiveRedirect}
              className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/35 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/10"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Continue without signing in
            </Link>
          )}
        </section>

        <section className="flex items-center justify-center bg-gradient-to-br from-white via-slate-100 to-slate-300 p-4 sm:p-8">
          <SignIn
            path="/auth/signin"
            routing="path"
            signUpUrl="/auth/signup"
            fallbackRedirectUrl={effectiveRedirect}
            signUpFallbackRedirectUrl={signUpRedirect}
            appearance={{
              elements: {
                rootBox: 'w-full',
                cardBox: 'w-full shadow-none',
                card: 'w-full border-0 bg-transparent shadow-none',
                headerTitle: 'text-blue-950 font-black',
                headerSubtitle: 'text-slate-600',
                formButtonPrimary: 'bg-blue-700 hover:bg-blue-800 font-bold shadow-lg',
                footerActionLink: 'text-blue-700 font-bold',
              },
            }}
          />
        </section>
      </div>
    </main>
  );
}

export default function SignInPageClient() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-gradient-to-br from-slate-300 via-blue-800 to-blue-950" aria-busy="true" />}>
      <SignInContent />
    </Suspense>
  );
}
