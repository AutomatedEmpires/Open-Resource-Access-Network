'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChatWindow } from '@/components/chat/ChatWindow';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Button } from '@/components/ui/button';
import { PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonLine } from '@/components/ui/skeleton';
import { readStoredDiscoveryPreference } from '@/services/profile/discoveryPreference';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
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
      attributeFilters: storedDiscoveryIntent.attributeFilters ?? urlDiscoveryIntent.attributeFilters,
      page: storedDiscoveryIntent.page ?? urlDiscoveryIntent.page,
    };
  }, [sessionId, urlDiscoveryIntent]);
  const initialPrompt = useMemo(
    () => resolveDiscoverySearchText(discoveryIntent.text, discoveryIntent.needId),
    [discoveryIntent.needId, discoveryIntent.text],
  );

  useEffect(() => {
    // sessionStorage unavailable on SSR — initialising via effect ensures SSR and first client
    // render produce identical '' output, eliminating hydration mismatch / skeleton flash.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSessionId(generateSessionId());
  }, []);

  if (!sessionId) {
    return (
      <main className="min-h-screen bg-white">
        <div className="mx-auto w-full max-w-[1740px] px-4 py-5 md:px-5 md:py-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm md:p-6">
            <div className="mb-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Seeker chat</p>
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Chat</h1>
                  <PageHeaderBadge tone="trust">Verified records only</PageHeaderBadge>
                </div>
              </div>
            </div>
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
    <main className="min-h-screen bg-white">
      <div className="mx-auto w-full max-w-[1820px] px-4 pt-3 pb-5 md:px-5 md:py-5">
        <section className="flex min-h-[800px] min-w-0 flex-col overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.07)] md:h-[calc(100dvh-6.3rem)] md:min-h-0">
          {/* ── Slim page title bar ── */}
          <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-5 py-3">
            <h1 className="text-base font-semibold tracking-tight text-slate-950">Chat</h1>
            <PageHeaderBadge tone="trust">Verified records only</PageHeaderBadge>
            <PageHeaderBadge>{savedSyncEnabled ? 'Saves can sync' : 'Local device saves'}</PageHeaderBadge>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/saved">
                <Button variant="outline" size="sm">Open Saved</Button>
              </Link>
              <Link href="/directory">
                <Button variant="outline" size="sm">Browse Directory</Button>
              </Link>
            </div>
          </div>
          <ErrorBoundary>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ChatWindow
                  sessionId={sessionId}
                  initialPrompt={initialPrompt}
                  initialNeedId={discoveryIntent.needId}
                  initialTrustFilter={discoveryIntent.confidenceFilter}
                  initialSortBy={discoveryIntent.sortBy}
                  initialPage={discoveryIntent.page}
                  initialAttributeFilters={discoveryIntent.attributeFilters}
                />
            </div>
          </ErrorBoundary>
        </section>
      </div>
    </main>
  );
}
