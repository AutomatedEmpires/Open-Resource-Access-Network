'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, MessageCircle, ShieldCheck, SlidersHorizontal, Sparkles } from 'lucide-react';

import { ServiceCard } from '@/components/directory/ServiceCard';
import { Button } from '@/components/ui/button';
import { SkeletonCard } from '@/components/ui/skeleton';
import {
  getDiscoveryNeedLabel,
  getDiscoveryNeedSearchText,
  QUICK_DISCOVERY_NEEDS,
  type DiscoveryNeedId,
} from '@/domain/discoveryNeeds';
import { readStoredSeekerProfile } from '@/services/profile/clientContext';
import { buildSeekerDiscoveryProfile } from '@/services/profile/discoveryProfile';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
  addServerSaved,
  readStoredSavedServiceIdSet,
  removeServerSaved,
  writeStoredSavedServiceIds,
} from '@/services/saved/client';
import { getSavedTogglePresentation } from '@/services/saved/presentation';
import { buildDiscoveryHref, type DiscoveryLinkState } from '@/services/search/discovery';
import { isStandaloneSeekerResult } from '@/services/search/standalone';
import type { SearchResponse } from '@/services/search/types';
import { useToast } from '@/components/ui/toast';

const FEED_PAGE_SIZE = 8;

export default function ScrollPageClient() {
  const [selectedNeed, setSelectedNeed] = useState<DiscoveryNeedId | null>(null);
  const [profileNeeds, setProfileNeeds] = useState<DiscoveryNeedId[]>([]);
  const [hasPersonalization, setHasPersonalization] = useState(false);
  const [results, setResults] = useState<SearchResponse['results']>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());
  const savedIdsRef = useRef<Set<string>>(new Set());
  const requestRef = useRef<AbortController | null>(null);
  const { success } = useToast();

  const discoveryContext = useMemo<DiscoveryLinkState>(
    () => ({ needId: selectedNeed }),
    [selectedNeed],
  );
  const visibleNeeds = useMemo(
    () => profileNeeds.length > 0
      ? profileNeeds
      : QUICK_DISCOVERY_NEEDS.slice(0, 6).map((need) => need.id),
    [profileNeeds],
  );

  const loadFeed = useCallback(async (
    nextPage: number,
    need: DiscoveryNeedId | null,
    append: boolean,
  ) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setResults([]);
    }
    setError(null);

    const params = new URLSearchParams({
      page: String(nextPage),
      limit: String(FEED_PAGE_SIZE),
      standaloneOnly: 'true',
    });
    const searchText = getDiscoveryNeedSearchText(need);
    if (searchText) params.set('q', searchText);

    try {
      const response = await fetch(`/api/search?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'The resource feed is temporarily unavailable.');
      }

      const payload = (await response.json()) as SearchResponse;
      const directResources = payload.results.filter(isStandaloneSeekerResult);
      setResults((current) => {
        if (!append) return directResources;
        const seen = new Set(current.map((result) => result.service.service.id));
        return [...current, ...directResources.filter((result) => !seen.has(result.service.service.id))];
      });
      setPage(nextPage);
      setHasMore(payload.hasMore);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      setError(caught instanceof Error ? caught.message : 'The resource feed is temporarily unavailable.');
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, []);

  useEffect(() => {
    const profile = buildSeekerDiscoveryProfile(readStoredSeekerProfile());
    setSelectedNeed(profile.primaryNeedId);
    setProfileNeeds(profile.normalizedProfile.serviceInterests);
    setHasPersonalization(profile.hasPersonalization);

    const nextSavedIds = readStoredSavedServiceIdSet();
    savedIdsRef.current = nextSavedIds;
    setSavedIds(nextSavedIds);

    void loadFeed(1, profile.primaryNeedId, false);
    return () => requestRef.current?.abort();
  }, [loadFeed]);

  const toggleSave = useCallback((serviceId: string) => {
    const wasSaved = savedIdsRef.current.has(serviceId);
    const copy = getSavedTogglePresentation(wasSaved, savedSyncEnabled);
    const next = new Set(savedIdsRef.current);
    if (wasSaved) next.delete(serviceId);
    else next.add(serviceId);

    savedIdsRef.current = next;
    setSavedIds(next);
    writeStoredSavedServiceIds(next);

    if (savedSyncEnabled) {
      if (wasSaved) void removeServerSaved(serviceId);
      else void addServerSaved(serviceId);
    }
    success(copy.toastMessage);
  }, [savedSyncEnabled, success]);

  const chooseNeed = (need: DiscoveryNeedId | null) => {
    if (need === selectedNeed && !error) return;
    setSelectedNeed(need);
    void loadFeed(1, need, false);
  };

  const feedTitle = selectedNeed
    ? `${getDiscoveryNeedLabel(selectedNeed) ?? 'Resources'} for you`
    : 'Verified resources nationwide';

  return (
    <main className="min-h-screen bg-[var(--surface-page)] pb-8">
      <section className="relative isolate overflow-hidden border-b border-blue-950 bg-gradient-brand-deep px-4 py-8 text-white sm:py-12">
        <div className="pointer-events-none absolute -right-24 -top-32 -z-10 h-80 w-80 rounded-full bg-sky-300/20 blur-3xl" aria-hidden="true" />
        <div className="mx-auto max-w-3xl">
          <p className="text-sm font-extrabold uppercase tracking-widest text-sky-100">Direct help · not retailer listings</p>
          <h1 className="mt-3 font-display text-4xl font-bold tracking-tight sm:text-5xl">Resources for your next step</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-blue-50 sm:text-base">
            Scroll verified services and program navigation from government, nonprofit, and community providers. Stores where benefits are spent stay out of this feed.
          </p>
          <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-white">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 backdrop-blur">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Stored provider records
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-white/10 px-3 py-1.5 backdrop-blur">
              No inferred eligibility
            </span>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <section className="rounded-3xl bg-gradient-chrome p-px shadow-xl" aria-labelledby="feed-personalization-heading">
          <div className="rounded-3xl bg-white p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-widest text-blue-700">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {hasPersonalization ? 'Personalization active' : 'Choose your focus'}
                </p>
                <h2 id="feed-personalization-heading" className="mt-1 font-display text-xl font-bold text-[var(--brand-navy)]">
                  {feedTitle}
                </h2>
              </div>
              <Link
                href="/profile"
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-blue-200 px-3 py-2 text-xs font-bold text-blue-800 hover:bg-blue-50"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                Profile
              </Link>
            </div>

            <div className="scrollbar-none mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Resource feed topics">
              <button
                type="button"
                onClick={() => chooseNeed(null)}
                aria-pressed={selectedNeed === null}
                className={`min-h-[44px] shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition-colors ${selectedNeed === null ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-500'}`}
              >
                All resources
              </button>
              {visibleNeeds.map((need) => (
                <button
                  key={need}
                  type="button"
                  onClick={() => chooseNeed(need)}
                  aria-pressed={selectedNeed === need}
                  className={`min-h-[44px] shrink-0 rounded-full border px-4 py-2 text-sm font-bold transition-colors ${selectedNeed === need ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-500'}`}
                >
                  {getDiscoveryNeedLabel(need) ?? need}
                </button>
              ))}
            </div>

            {!hasPersonalization ? (
              <p className="mt-3 text-xs leading-5 text-slate-600">
                Add only the details you want to share. Your needs can shape this feed without creating an account.
              </p>
            ) : null}
          </div>
        </section>

        <div className="mt-6" aria-live="polite" aria-busy={isLoading || isLoadingMore}>
          {isLoading ? (
            <div className="space-y-4" aria-label="Loading resources">
              {Array.from({ length: 3 }).map((_, index) => <SkeletonCard key={index} />)}
            </div>
          ) : null}

          {!isLoading && error ? (
            <section role="alert" className="rounded-[24px] border border-red-200 bg-white p-5 shadow-sm">
              <h2 className="font-display text-xl font-bold text-slate-950">We could not load the feed</h2>
              <p className="mt-2 text-sm text-slate-600">{error}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" onClick={() => void loadFeed(1, selectedNeed, false)}>Try again</Button>
                <Button asChild type="button" variant="outline">
                  <Link href="/chat"><MessageCircle className="h-4 w-4" aria-hidden="true" /> Ask in chat</Link>
                </Button>
              </div>
            </section>
          ) : null}

          {!isLoading && !error && results.length === 0 ? (
            <section className="rounded-[24px] border border-slate-200 bg-white p-6 text-center shadow-sm">
              <h2 className="font-display text-xl font-bold text-slate-950">No direct services found yet</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Try all resources or describe what is happening in chat. ORAN will not fill the gap with retailer listings.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                {selectedNeed ? <Button type="button" variant="outline" onClick={() => chooseNeed(null)}>Show all resources</Button> : null}
                <Button asChild><Link href="/chat">Open chat</Link></Button>
              </div>
            </section>
          ) : null}

          {!isLoading && !error && results.length > 0 ? (
            <div className="space-y-4">
              {results.map((result) => (
                <ServiceCard
                  key={result.service.service.id}
                  enriched={result.service}
                  isSaved={savedIds.has(result.service.service.id)}
                  onToggleSave={toggleSave}
                  href={buildDiscoveryHref(`/service/${result.service.service.id}`, discoveryContext)}
                  discoveryContext={discoveryContext}
                  savedSyncEnabled={savedSyncEnabled}
                />
              ))}
            </div>
          ) : null}

          {!isLoading && !error && hasMore ? (
            <div className="mt-6 flex justify-center">
              <Button
                type="button"
                variant="outline"
                size="lg"
                disabled={isLoadingMore}
                onClick={() => void loadFeed(page + 1, selectedNeed, true)}
                className="min-w-44 gap-2 border-blue-300 bg-white text-blue-900"
              >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
                {isLoadingMore ? 'Loading…' : 'Show more'}
              </Button>
            </div>
          ) : null}
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-5 text-slate-600">
          Service details can change. Review trust and freshness cues, then contact the provider to confirm availability and eligibility. ORAN is not emergency response, medical advice, or legal advice.
        </p>
      </div>
    </main>
  );
}
