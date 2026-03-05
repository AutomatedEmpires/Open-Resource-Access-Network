'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, AlertTriangle, ArrowLeft, ArrowRight, MapPin } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';
import { ServiceCard } from '@/components/directory/ServiceCard';
import type { SearchResponse } from '@/services/search/types';
import { useToast } from '@/components/ui/toast';

const DEFAULT_LIMIT = 12;
const SAVED_KEY = 'oran:saved-service-ids';

/** Trust filter options — 'all' shows everything */
type ConfidenceFilter = 'all' | 'HIGH' | 'LIKELY';

const CONFIDENCE_OPTIONS: { value: ConfidenceFilter; label: string; minScore?: number }[] = [
  { value: 'all', label: 'All results' },
  { value: 'LIKELY', label: 'Likely or higher', minScore: 60 },
  { value: 'HIGH', label: 'High confidence only', minScore: 80 },
];

/** Sort options available to the directory */
type SortOption = 'relevance' | 'trust' | 'name_asc' | 'name_desc';

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
  { value: 'trust', label: 'Trust (highest)' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
];

/** Quick category chips for common service needs */
const CATEGORY_CHIPS: { value: string; label: string }[] = [
  { value: 'food', label: 'Food' },
  { value: 'housing', label: 'Housing' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'mental health', label: 'Mental Health' },
  { value: 'employment', label: 'Employment' },
  { value: 'legal aid', label: 'Legal Aid' },
  { value: 'childcare', label: 'Childcare' },
  { value: 'transportation', label: 'Transportation' },
];

export default function DirectoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // ── Seed state from URL params so filters are linkable/shareable ──
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const [page, setPage] = useState(() => {
    const p = parseInt(searchParams.get('page') ?? '1', 10);
    return isNaN(p) || p < 1 ? 1 : p;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>(() => {
    const v = searchParams.get('confidence');
    return (v === 'HIGH' || v === 'LIKELY') ? v : 'all';
  });
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    const v = searchParams.get('sort');
    const valid: SortOption[] = ['relevance', 'trust', 'name_asc', 'name_desc'];
    return valid.includes(v as SortOption) ? (v as SortOption) : 'relevance';
  });
  const [activeCategory, setActiveCategory] = useState<string | null>(() => searchParams.get('category'));

  // Opt-in device geolocation (in-session only; never stored; not reflected in URL)
  const [isLocating, setIsLocating] = useState(false);
  const [deviceLocation, setDeviceLocation] = useState<{ lat: number; lng: number } | null>(null);

  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const savedIdsRef = useRef<Set<string>>(new Set());
  const { success, error: toastError, info } = useToast();

  // Ref for focus management after search
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  /** Push current filter state to the URL without adding history entries */
  const pushUrlState = useCallback((
    q: string,
    confidence: ConfidenceFilter,
    sort: SortOption,
    category: string | null,
    p: number,
  ) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (confidence !== 'all') params.set('confidence', confidence);
    if (sort !== 'relevance') params.set('sort', sort);
    if (category) params.set('category', category);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    router.replace(qs ? `/directory?${qs}` : '/directory', { scroll: false });
  }, [router]);

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const next = new Set(parsed.filter((v): v is string => typeof v === 'string'));
          savedIdsRef.current = next;
          setSavedIds(next);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Keep ref in sync in case savedIds is updated elsewhere.
  useEffect(() => {
    savedIdsRef.current = savedIds;
  }, [savedIds]);

  const toggleSave = useCallback((serviceId: string) => {
    // Read from ref so this callback never goes stale — no savedIds in dep array.
    const wasSaved = savedIdsRef.current.has(serviceId);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) { next.delete(serviceId); } else { next.add(serviceId); }
      savedIdsRef.current = next;
      try { localStorage.setItem(SAVED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
    success(wasSaved ? 'Removed from saved' : 'Saved');
  }, [success]);

  const canSearch = useMemo(() => query.trim().length > 0 || deviceLocation != null, [query, deviceLocation]);

  const roundForPrivacy = useCallback((value: number): number => {
    // ~0.01° ≈ 1km (varies by latitude); used to reduce precision exposure.
    return Math.round(value * 100) / 100;
  }, []);

  const handleUseMyLocation = useCallback(() => {
    if (isLocating) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      toastError('Device location is not available in this browser.');
      return;
    }

    setIsLocating(true);
    info('Requesting device location…');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = roundForPrivacy(pos.coords.latitude);
        const lng = roundForPrivacy(pos.coords.longitude);
        const next = { lat, lng };
        setDeviceLocation(next);
        success('Showing results near your location (approximate, not saved).');
        setIsLocating(false);
        void runSearch(1, confidenceFilter, sortBy, undefined, undefined, next);
      },
      (err) => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied.'
            : err.code === err.TIMEOUT
              ? 'Location request timed out.'
              : 'Location unavailable.';
        toastError(message);
        setIsLocating(false);
      },
      {
        enableHighAccuracy: false,
        timeout: 10_000,
        maximumAge: 60_000,
      },
    );
  }, [confidenceFilter, info, isLocating, roundForPrivacy, runSearch, sortBy, success, toastError]);

  const runSearch = useCallback(async (
    nextPage: number,
    confidence: ConfidenceFilter = confidenceFilter,
    sort: SortOption = sortBy,
    searchText?: string,
    category?: string | null,
    locationOverride?: { lat: number; lng: number } | null,
  ) => {
    const trimmed = (searchText ?? query).trim();

    const effectiveLocation = locationOverride !== undefined ? locationOverride : deviceLocation;
    if (!trimmed && !effectiveLocation) return;

    const effectiveCategory = category !== undefined ? category : activeCategory;

    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ status: 'active', page: String(nextPage), limit: String(DEFAULT_LIMIT) });

      if (trimmed) {
        params.set('q', trimmed);
      }

      if (effectiveLocation) {
        params.set('lat', String(effectiveLocation.lat));
        params.set('lng', String(effectiveLocation.lng));
      }

      if (sort !== 'relevance') {
        params.set('sortBy', sort);
      }

      const option = CONFIDENCE_OPTIONS.find((o) => o.value === confidence);
      if (option?.minScore) {
        params.set('minConfidenceScore', String(option.minScore));
      }

      const res = await fetch(`/api/search?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Search failed');
      }

      const json = (await res.json()) as SearchResponse;
      setData(json);
      setPage(nextPage);
      // Sync filter state to URL so results are shareable
      pushUrlState(trimmed, confidence, sort, effectiveCategory, nextPage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [query, confidenceFilter, sortBy, activeCategory, deviceLocation, pushUrlState]);

  // Auto-run search on first render if URL has a query param
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    const urlQuery = searchParams.get('q');
    if (urlQuery?.trim()) {
      didAutoRun.current = true;
      void runSearch(page, confidenceFilter, sortBy, urlQuery.trim(), activeCategory);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus results container after search completes with results
  useEffect(() => {
    if (data && !isLoading && resultsContainerRef.current) {
      resultsContainerRef.current.focus();
    }
  }, [data, isLoading]);

  useEffect(() => {
    setPage(1);
  }, [query, deviceLocation]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(1);
  };

  const handleConfidenceChange = (value: ConfidenceFilter) => {
    setConfidenceFilter(value);
    if (data) {
      // re-search with the new filter
      void runSearch(1, value);
    }
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as SortOption;
    setSortBy(value);
    if (data) {
      void runSearch(1, confidenceFilter, value);
    }
  };

  const handleCategoryClick = (category: string) => {
    if (activeCategory === category) {
      // Deselect — clear category and push URL
      setActiveCategory(null);
      setQuery('');
      pushUrlState('', confidenceFilter, sortBy, null, 1);
    } else {
      setActiveCategory(category);
      setQuery(category);
      void runSearch(1, confidenceFilter, sortBy, category, category);
    }
  };

  const handleClearSearch = useCallback(() => {
    setQuery('');
    setData(null);
    setError(null);
    setPage(1);
    setActiveCategory(null);
    pushUrlState('', confidenceFilter, sortBy, null, 1);
  }, [confidenceFilter, sortBy, pushUrlState]);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="Service Directory"
        subtitle={
          <>
            Search verified listings. Also try{' '}
            <Link href="/chat" className="text-blue-600 hover:underline">Chat</Link>
            {' '}or{' '}
            <Link href="/map" className="text-blue-600 hover:underline">Map view</Link>.
          </>
        }
      />

      <ErrorBoundary>
        {/* Search + filters */}
        <form onSubmit={handleSubmit} className="flex gap-2 items-center mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              placeholder="Search for services (e.g., rent help, food pantry, job training)"
              className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              aria-label="Search services"
            />
            {query && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <Button type="submit" disabled={!canSearch || isLoading}>
            Search
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleUseMyLocation}
            disabled={isLocating}
            title="Opt-in: uses device location in-session only; not stored"
            className="gap-1.5"
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {isLocating ? 'Locating…' : 'Use my location'}
          </Button>
        </form>

        <p className="-mt-2 mb-3 text-xs text-gray-600">
          Location is optional. If you choose “Use my location”, ORAN uses an approximate location to show nearby results in-session only and does not store it.
        </p>

        {/* Category chips */}
        <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label="Quick category filters">
          <span className="text-xs font-medium text-gray-500">Categories:</span>
          {CATEGORY_CHIPS.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => handleCategoryClick(cat.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeCategory === cat.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
              }`}
              aria-pressed={activeCategory === cat.value}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Confidence + sort controls — always visible, no toggle required */}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Trust filter">
            <span className="text-xs font-medium text-gray-500">Trust:</span>
            {CONFIDENCE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleConfidenceChange(opt.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  confidenceFilter === opt.value
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                }`}
                aria-pressed={confidenceFilter === opt.value}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <label htmlFor="sort-select" className="text-xs font-medium text-gray-500 whitespace-nowrap">
              Sort:
            </label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={handleSortChange}
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[32px]"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Search failed</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            role="status"
            aria-busy="true"
            aria-label="Loading search results"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={`skeleton-${i}`} />
            ))}
          </div>
        )}

        {/* Empty state before search */}
        {!isLoading && !data && !error && (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="text-gray-700 font-medium">Start with a search</p>
            <p className="mt-1 text-sm text-gray-500">
              Results are from verified service records only.
            </p>
          </div>
        )}

        {/* Results */}
        {!isLoading && data && (
          <div
            ref={resultsContainerRef}
            tabIndex={-1}
            className="space-y-4 outline-none"
          >
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-gray-600" role="status" aria-live="polite">
                {data.results.length === 0
                  ? `0 of ${data.total} results`
                  : `Showing ${(page - 1) * DEFAULT_LIMIT + 1}–${(page - 1) * DEFAULT_LIMIT + data.results.length} of ${data.total}`
                }
              </p>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runSearch(Math.max(1, page - 1))}
                  disabled={page <= 1 || isLoading}
                  className="gap-1"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runSearch(page + 1)}
                  disabled={!data.hasMore || isLoading}
                  className="gap-1"
                >
                  Next
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            {data.results.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
                <p className="text-gray-700 font-medium">No matches</p>
                <p className="mt-1 text-sm text-gray-500">
                  Try different keywords, or use chat for guided searching.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.results.map((r) => (
                  <ServiceCard
                    key={r.service.service.id}
                    enriched={r.service}
                    isSaved={savedIds.has(r.service.service.id)}
                    onToggleSave={toggleSave}
                    href={`/service/${r.service.service.id}`}
                  />
                ))}
              </div>
            )}

            {/* Bottom pagination — mirrors top bar so users don’t scroll back up */}
            {data.results.length > 0 && (
              <div className="flex items-center justify-between gap-4 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  Page {page}{data.hasMore ? '' : ' · end of results'}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void runSearch(Math.max(1, page - 1))}
                    disabled={page <= 1 || isLoading}
                    className="gap-1"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Prev
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void runSearch(page + 1)}
                    disabled={!data.hasMore || isLoading}
                    className="gap-1"
                  >
                    Next
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </ErrorBoundary>
    </main>
  );
}
