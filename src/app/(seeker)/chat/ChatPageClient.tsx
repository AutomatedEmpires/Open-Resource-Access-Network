'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonLine } from '@/components/ui/skeleton';
import { readStoredDiscoveryPreference } from '@/services/profile/discoveryPreference';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
  buildDiscoveryHref,
  hasMeaningfulDiscoveryState,
  parseDiscoveryUrlState,
  resolveDiscoverySearchText,
} from '@/services/search/discovery';

function generateSessionId(): string {
  const key = 'oran_chat_session_id';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem(key, id);
  return id;
}

export default function ChatPage() {
  const searchParams = useSearchParams();
  // Initialised in useEffect so SSR and client first-render both produce the
  // same empty-string value, eliminating the hydration mismatch / skeleton flash.
  const [sessionId, setSessionId] = useState<string>('');
  const [savedSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());

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
      taxonomyTermIds: storedDiscoveryIntent.taxonomyTermIds ?? urlDiscoveryIntent.taxonomyTermIds,
      attributeFilters: storedDiscoveryIntent.attributeFilters ?? urlDiscoveryIntent.attributeFilters,
      page: storedDiscoveryIntent.page ?? urlDiscoveryIntent.page,
    };
  }, [sessionId, urlDiscoveryIntent]);
  const initialPrompt = useMemo(
    () => resolveDiscoverySearchText(discoveryIntent.text, discoveryIntent.needId),
    [discoveryIntent.needId, discoveryIntent.text],
  );

  const directoryHref = useMemo(() => buildDiscoveryHref('/directory', discoveryIntent), [discoveryIntent]);
  const mapHref = useMemo(() => buildDiscoveryHref('/map', discoveryIntent), [discoveryIntent]);

  useEffect(() => {
    // sessionStorage unavailable on SSR — initialising via effect ensures SSR and first client
    // render produce identical '' output, eliminating hydration mismatch / skeleton flash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionId(generateSessionId());
  }, []);

  if (!sessionId) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-orange-50 via-rose-50 to-emerald-50">
        <div className="container mx-auto max-w-5xl px-4 py-6 md:py-8">
          <div className="rounded-[28px] border border-orange-100/80 bg-white/90 p-5 shadow-[0_24px_80px_rgba(234,88,12,0.10)] backdrop-blur md:p-8">
            <PageHeader
              eyebrow="Seeker assistant"
              title="Find Services"
              subtitle="Prefer browsing? Directory or Map."
              badges={(
                <>
                  <PageHeaderBadge tone="trust">Verified records only</PageHeaderBadge>
                  <PageHeaderBadge tone="accent">Private by default</PageHeaderBadge>
                </>
              )}
            />
            <div className="rounded-[24px] border border-orange-100 bg-white p-5" role="status" aria-busy="true" aria-label="Loading chat">
              <SkeletonLine className="h-5 w-40" />
              <SkeletonLine className="mt-3 h-4 w-full" />
              <SkeletonLine className="mt-2 h-4 w-2/3" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-orange-50 via-rose-50 to-emerald-50">
      <div className="container mx-auto max-w-5xl px-4 pt-4 pb-6 md:py-8">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <section className="rounded-[30px] border border-orange-100/80 bg-white/90 p-5 shadow-[0_24px_80px_rgba(234,88,12,0.10)] backdrop-blur md:p-8">
            <PageHeader
              eyebrow="Seeker assistant"
              title="Find Services"
              subtitle={
                <>
                  Ask in your own words, or prefer browsing in{' '}
                  <Link href={directoryHref} className="font-medium text-action-base hover:underline">Directory</Link>
                  {' '}or{' '}
                  <Link href={mapHref} className="font-medium text-action-base hover:underline">Map</Link>.
                </>
              }
              badges={(
                <>
                  <PageHeaderBadge tone="trust">Verified records only</PageHeaderBadge>
                  <PageHeaderBadge tone="accent">
                    {savedSyncEnabled ? 'Saves can sync to your account' : 'Saves stay on this device'}
                  </PageHeaderBadge>
                  <PageHeaderBadge>Session-based guidance</PageHeaderBadge>
                </>
              )}
            />
            <ErrorBoundary>
              <ChatWindow
                sessionId={sessionId}
                initialPrompt={initialPrompt}
                initialNeedId={discoveryIntent.needId}
                initialTrustFilter={discoveryIntent.confidenceFilter}
                initialSortBy={discoveryIntent.sortBy}
                initialPage={discoveryIntent.page}
                initialTaxonomyTermIds={discoveryIntent.taxonomyTermIds}
                initialAttributeFilters={discoveryIntent.attributeFilters}
              />
            </ErrorBoundary>
          </section>

          <aside className="space-y-4 lg:sticky lg:top-6">
            <div className="rounded-[24px] border border-rose-100 bg-gradient-to-br from-rose-50 to-orange-50 p-5 shadow-[0_12px_40px_rgba(251,113,133,0.10)]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-rose-700">How it works</p>
              <h2 className="mt-2 text-lg font-semibold text-stone-900">Gentle guidance, grounded in records</h2>
              <ul className="mt-3 space-y-3 text-sm leading-6 text-stone-600">
                <li>Results come from stored verified listings only.</li>
                <li>The chat keeps lightweight session scope, not raw conversation memory.</li>
                <li>You can move the same search into Directory or Map at any time.</li>
              </ul>
            </div>

            <div className="rounded-[24px] border border-emerald-100 bg-gradient-to-br from-emerald-50 to-orange-50 p-5 shadow-[0_12px_40px_rgba(16,185,129,0.10)]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Safety note</p>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                If you or someone nearby is in immediate danger, use 911 or 988 first. The chat will route crisis language immediately and then help narrow local support.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
