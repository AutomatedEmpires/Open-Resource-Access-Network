/**
 * Sign-in entry page
 *
 * A lightweight, ORAN-branded chooser: Seeker, Organization, or Administration.
 * The actual authentication (email, OAuth, passwords, MFA) is handled by Clerk's
 * hosted sign-in at /sign-in. This page only sets intent + redirect target and
 * hands off to Clerk; role-based access is enforced server-side after sign-in.
 */

'use client';

import React, { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Search, Building2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ============================================================
// PATH DEFINITIONS
// ============================================================

type UserPath = 'seeker' | 'organization' | 'admin';

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
    label: 'Find Services',
    icon: Search,
    callbackUrl: '/chat',
    guestAllowed: true,
    detail: 'Search verified community resources, save favorites, and get personalized results.',
    accessTitle: 'Open to everyone',
    accessNotes: [
      'Anyone can browse verified services as a seeker.',
      'Create an account only if you want saved items and synced preferences.',
    ],
  },
  {
    id: 'organization',
    label: 'Organization',
    icon: Building2,
    callbackUrl: '/claim',
    guestAllowed: false,
    detail: 'Register your organization or manage your service listings on ORAN.',
    accessTitle: 'For provider staff and organization owners',
    accessNotes: [
      'Use this path if you represent a service provider and need to claim or update listings.',
      'Organization editing access is granted after an ORAN admin reviews and approves the claim.',
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: ShieldCheck,
    callbackUrl: '/approvals',
    guestAllowed: false,
    detail: 'Community moderation, data verification, and platform management.',
    accessTitle: 'For designated review and platform teams only',
    accessNotes: [
      'Admin access is reserved for community verifiers, ORAN operations staff, and platform governors.',
      'These roles are provisioned manually and are not created by self-service registration.',
    ],
  },
];

/** Detect which path to pre-select from a callbackUrl */
export function detectPath(callbackUrl: string | null): UserPath {
  if (!callbackUrl) return 'seeker';
  if (/^\/(claim|org|services|locations|admins)/.test(callbackUrl)) return 'organization';
  if (/^\/(operations|approvals|rules|audit|zone-management|ingestion|triage|queue|verify|coverage|appeals|reports|admin-security|scopes|templates)/.test(callbackUrl))
    return 'admin';
  return 'seeker';
}

function clerkSignInHref(redirect: string): string {
  return `/sign-in?redirect_url=${encodeURIComponent(redirect)}`;
}

function clerkSignUpHref(redirect: string): string {
  return `/sign-up?redirect_url=${encodeURIComponent(redirect)}`;
}

// ============================================================
// MAIN CONTENT
// ============================================================

function SignInContent() {
  const searchParams = useSearchParams();
  const originalCallback = searchParams.get('callbackUrl') ?? searchParams.get('redirect_url');
  const error = searchParams.get('error');
  const detectedPath = detectPath(originalCallback);
  const [selected, setSelected] = useState<UserPath>(detectedPath);

  const activePath = PATHS.find((p) => p.id === selected)!;

  // Preserve a deep-link when the user stays on the auto-detected path.
  const effectiveCallback =
    selected === detectedPath && originalCallback ? originalCallback : activePath.callbackUrl;

  return (
    <main className="container mx-auto max-w-lg px-4 py-12">
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm">
        <div className="px-5 sm:px-8 pt-6 sm:pt-8 pb-2 text-center">
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Welcome to ORAN</h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">How would you like to use ORAN?</p>
        </div>

        {/* Path selector */}
        <div role="radiogroup" aria-label="Account type" className="px-4 sm:px-6 pt-4 pb-2">
          <div className="grid grid-cols-3 gap-2">
            {PATHS.map(({ id, label, icon: Icon }) => {
              const isActive = selected === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  onClick={() => setSelected(id)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border-2 px-3 py-3 text-xs font-medium transition-all min-h-[44px] cursor-pointer ${
                    isActive
                      ? 'border-[var(--text-primary)] bg-[var(--bg-surface-alt)] text-[var(--text-primary)]'
                      : 'border-[var(--border)] bg-[var(--bg-surface-alt)] text-[var(--text-secondary)] hover:border-[var(--text-muted)] hover:bg-[var(--bg-surface)]'
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-5 sm:px-8 pb-6 sm:pb-8 pt-4">
          <p className="mb-5 text-center text-sm text-[var(--text-secondary)]" data-testid="path-detail">
            {activePath.detail}
          </p>

          <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface-alt)] px-4 py-3 text-left">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{activePath.accessTitle}</p>
            <ul className="mt-2 space-y-1 text-sm text-[var(--text-secondary)]">
              {activePath.accessNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg border border-error-soft bg-error-subtle p-3 text-sm text-error-deep"
            >
              Sign-in was interrupted. Please try again.
            </div>
          )}

          <div className="space-y-3">
            <Button asChild className="w-full min-h-[44px] text-sm font-medium">
              <Link href={clerkSignInHref(effectiveCallback)}>Sign in</Link>
            </Button>
            <Button asChild variant="outline" className="w-full min-h-[44px] text-sm font-medium">
              <Link href={clerkSignUpHref(effectiveCallback)}>Create an account</Link>
            </Button>

            {activePath.guestAllowed && (
              <Link
                href={activePath.callbackUrl}
                className="block text-center text-sm text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
              >
                Continue as guest
              </Link>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

export default function SignInPageClient() {
  return (
    <Suspense fallback={<div className="container mx-auto max-w-lg px-4 py-12 text-center text-sm text-[var(--text-secondary)]">Loading…</div>}>
      <SignInContent />
    </Suspense>
  );
}
