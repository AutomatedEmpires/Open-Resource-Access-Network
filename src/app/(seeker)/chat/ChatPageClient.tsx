'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonLine } from '@/components/ui/skeleton';
import type { GuidedIntakeSubmission } from '@/domain/resourceNavigator';
import { consumeGuidedIntakeHandoff } from '@/services/chat/guidedIntakeHandoff';
import { readStoredDiscoveryPreference } from '@/services/profile/discoveryPreference';
import {
  consumeOnboardingChatHandoff,
  type OnboardingChatHandoff,
} from '@/services/profile/onboardingHandoff';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
  hasMeaningfulDiscoveryState,
  parseDiscoveryUrlState,
  resolveDiscoverySearchText,
} from '@/services/search/discovery';

function ChatLoadingState() {
  return (
    <div className="mx-auto max-w-3xl p-6" role="status" aria-busy="true" aria-label="Loading chat">
      <SkeletonLine className="h-5 w-40" />
      <SkeletonLine className="mt-3 h-4 w-full" />
      <SkeletonLine className="mt-2 h-4 w-2/3" />
    </div>
  );
}

const ChatWindow = dynamic(
  () => import('@/components/chat/ChatWindow').then((module) => module.ChatWindow),
  { ssr: false, loading: ChatLoadingState },
);

function generateSessionId(forceNew = false): string {
  const key = 'oran_chat_session_id';
  const existing = sessionStorage.getItem(key);
  if (existing && !forceNew) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

export default function ChatPage() {
  const searchParams = useSearchParams();
  // Initialised in useEffect so SSR and client first-render both produce the
  // same empty-string value, eliminating the hydration mismatch / skeleton flash.
  const [sessionId, setSessionId] = useState<string>('');
  const [onboardingHandoff, setOnboardingHandoff] = useState<OnboardingChatHandoff | null>(null);
  const [guidedIntake, setGuidedIntake] = useState<GuidedIntakeSubmission | null>(null);
  const [savedSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());
  const fromOnboarding = searchParams.get('from') === 'onboarding';
  const fromGuidedIntake = searchParams.get('from') === 'guided';
  // A ?q= link carries fresh intent: open a fresh session so the seeded prompt
  // is never silently swallowed by an older conversation's messages or draft
  // (ChatWindow only applies initialPrompt to message-free sessions).
  const hasSeededPrompt = Boolean(searchParams.get('q')?.trim());
  const handoffRoute = fromGuidedIntake ? 'guided' : fromOnboarding ? 'onboarding' : 'none';
  const processedHandoffRouteRef = useRef<string | null>(null);

  const urlDiscoveryIntent = useMemo(() => parseDiscoveryUrlState(searchParams), [searchParams]);
  const discoveryIntent = useMemo(() => {
    if (hasMeaningfulDiscoveryState(urlDiscoveryIntent)) {
      return urlDiscoveryIntent;
    }

    if (!sessionId) {
      return urlDiscoveryIntent;
    }

    const storedDiscoveryIntent = readStoredDiscoveryPreference();

    return {
      ...urlDiscoveryIntent,
      text: storedDiscoveryIntent.text ?? urlDiscoveryIntent.text,
      needId: storedDiscoveryIntent.needId ?? urlDiscoveryIntent.needId,
      confidenceFilter: storedDiscoveryIntent.confidenceFilter ?? urlDiscoveryIntent.confidenceFilter,
      sortBy: storedDiscoveryIntent.sortBy ?? urlDiscoveryIntent.sortBy,
      attributeFilters: storedDiscoveryIntent.attributeFilters ?? urlDiscoveryIntent.attributeFilters,
      page: storedDiscoveryIntent.page ?? urlDiscoveryIntent.page,
    };
  }, [sessionId, urlDiscoveryIntent]);
  const initialPrompt = useMemo(
    () => guidedIntake?.prompt
      ?? onboardingHandoff?.prompt
      ?? resolveDiscoverySearchText(discoveryIntent.text, discoveryIntent.needId),
    [discoveryIntent.needId, discoveryIntent.text, guidedIntake, onboardingHandoff],
  );
  useEffect(() => {
    if (processedHandoffRouteRef.current === handoffRoute) return;
    processedHandoffRouteRef.current = handoffRoute;

    // sessionStorage unavailable on SSR — initialising via effect ensures SSR and first client
    // render produce identical '' output, eliminating hydration mismatch / skeleton flash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOnboardingHandoff(fromOnboarding ? consumeOnboardingChatHandoff() : null);
    const nextGuidedIntake = fromGuidedIntake ? consumeGuidedIntakeHandoff() : null;
    setGuidedIntake(nextGuidedIntake);
    setSessionId(generateSessionId(Boolean(nextGuidedIntake) || hasSeededPrompt));
  }, [fromGuidedIntake, fromOnboarding, handoffRoute, hasSeededPrompt]);

  if (!sessionId) {
    return (
      <main className="bg-[var(--bg-page)]">
        <div className="border-b border-[var(--border)] bg-white px-4 py-3">
          <h1 className="mx-auto max-w-7xl text-base font-semibold text-[var(--text-primary)]">Find help</h1>
        </div>
        <ChatLoadingState />
      </main>
    );
  }

  return (
    <main className="bg-[var(--bg-page)]">
      <section className="chat-workspace flex min-w-0 flex-col overflow-hidden bg-white">
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-white px-4 py-2.5 sm:px-5">
          <h1 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">Find help</h1>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/saved" className="hidden min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-surface-alt)] sm:inline-flex">
              Saved
            </Link>
            <span className="sr-only">{savedSyncEnabled ? 'Saved services can sync to your account.' : 'Saved services stay on this device.'}</span>
          </div>
        </div>
        <ErrorBoundary>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChatWindow
              sessionId={sessionId}
              initialPrompt={initialPrompt}
              {...(guidedIntake ? { initialGuidedIntake: guidedIntake } : {})}
              initialNeedId={guidedIntake
                ? undefined
                : onboardingHandoff?.needId ?? discoveryIntent.needId}
              initialTrustFilter={discoveryIntent.confidenceFilter}
              initialSortBy={discoveryIntent.sortBy}
              initialPage={discoveryIntent.page}
              initialAttributeFilters={discoveryIntent.attributeFilters}
            />
          </div>
        </ErrorBoundary>
      </section>
    </main>
  );
}
