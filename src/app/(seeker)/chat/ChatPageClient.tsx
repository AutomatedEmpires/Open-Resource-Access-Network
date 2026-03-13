'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { DiscoverySurfaceTabs } from '@/components/seeker/DiscoverySurfaceTabs';
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
  const surfaceTabs = useMemo(
    () => [
      { href: '/chat', label: 'Chat' },
      { href: directoryHref, label: 'Directory' },
      { href: mapHref, label: 'Map' },
    ],
    [directoryHref, mapHref],
  );

  useEffect(() => {
    // sessionStorage unavailable on SSR — initialising via effect ensures SSR and first client
    // render produce identical '' output, eliminating hydration mismatch / skeleton flash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionId(generateSessionId());
  }, []);

  if (!sessionId) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.32),_transparent_26%),linear-gradient(180deg,_#f7fafc_0%,_#f8fbfd_48%,_#f2f7fb_100%)]">
        <div className="container mx-auto max-w-6xl px-4 py-6 md:py-8">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/92 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-8">
            <PageHeader
              eyebrow="Seeker assistant"
              title="Find Services"
              subtitle="A calmer way to start: one search box, one conversation, and verified records only."
              actions={<DiscoverySurfaceTabs items={surfaceTabs} currentHref="/chat" />}
              badges={(
                <>
                  <PageHeaderBadge tone="trust">Verified records only</PageHeaderBadge>
                </>
              )}
            />
            <div className="rounded-[24px] border border-slate-200 bg-white p-5" role="status" aria-busy="true" aria-label="Loading chat">
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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.32),_transparent_26%),linear-gradient(180deg,_#f7fafc_0%,_#f8fbfd_48%,_#f2f7fb_100%)]">
      <div className="container mx-auto max-w-6xl px-4 pt-4 pb-6 md:py-8">
        <section className="rounded-[30px] border border-slate-200/80 bg-white/92 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-8">
            <PageHeader
              eyebrow="Seeker assistant"
              title="Find Services"
              subtitle="Ask in your own words. Keep the experience focused here, then move into the directory or map only when you want a different view."
              actions={<DiscoverySurfaceTabs items={surfaceTabs} currentHref="/chat" />}
              badges={(
                <>
                  <PageHeaderBadge tone="trust">Verified records only</PageHeaderBadge>
                  <PageHeaderBadge>{savedSyncEnabled ? 'Saves can sync' : 'Local device saves'}</PageHeaderBadge>
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
      </div>
    </main>
  );
}
