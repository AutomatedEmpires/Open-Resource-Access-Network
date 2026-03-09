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
      <main className="container mx-auto max-w-2xl px-4 py-8">
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
        <div className="rounded-lg border border-gray-200 bg-white p-4" role="status" aria-busy="true" aria-label="Loading chat">
          <SkeletonLine className="h-5 w-40" />
          <SkeletonLine className="mt-3 h-4 w-full" />
          <SkeletonLine className="mt-2 h-4 w-2/3" />
        </div>
      </main>
    );
  }

  return (
    <main className="container mx-auto max-w-2xl px-4 pt-4 pb-4 md:py-8">
      <PageHeader
        eyebrow="Seeker assistant"
        title="Find Services"
        subtitle={
          <>
            Prefer browsing?{' '}
            <Link href={directoryHref} className="text-action-base hover:underline">Directory</Link>
            {' '}or{' '}
            <Link href={mapHref} className="text-action-base hover:underline">Map</Link>.
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
    </main>
  );
}
