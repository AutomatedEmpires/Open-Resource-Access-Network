'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search, MessageCircle, AlertTriangle, ArrowLeft, ArrowRight, MapIcon, Filter } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SkeletonCard } from '@/components/ui/skeleton';
import { ServiceCard } from '@/components/directory/ServiceCard';
import type { SearchResponse } from '@/services/search/types';

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
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Ref for focus management after search
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) setSavedIds(new Set(parsed.filter((v): v is string => typeof v === 'string')));
      }
    } catch { /* ignore */ }
  }, []);

  const toggleSave = useCallback((serviceId: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) { next.delete(serviceId); } else { next.add(serviceId); }
      try { localStorage.setItem(SAVED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const canSearch = useMemo(() => query.trim().length > 0, [query]);

  const runSearch = useCallback(async (
    nextPage: number,
    confidence: ConfidenceFilter = confidenceFilter,
    sort: SortOption = sortBy,
    searchText?: string,
  ) => {
    const trimmed = (searchText ?? query).trim();
    if (!trimmed) return;

    setIsLoading(true);
    setError(null);

    try {
      const url = new URL('/api/search', window.location.origin);
      url.searchParams.set('status', 'active');
      url.searchParams.set('q', trimmed);
      url.searchParams.set('page', String(nextPage));
      url.searchParams.set('limit', String(DEFAULT_LIMIT));

      if (sort !== 'relevance') {
        url.searchParams.set('sortBy', sort);
      }

      const option = CONFIDENCE_OPTIONS.find((o) => o.value === confidence);
      if (option?.minScore) {
        url.searchParams.set('minConfidenceScore', String(option.minScore));
      }

      const res = await fetch(url.toString(), {
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [query, confidenceFilter, sortBy]);

  // Focus results container after search completes with results
  useEffect(() => {
    if (data && !isLoading && resultsContainerRef.current) {
      resultsContainerRef.current.focus();
    }
  }, [data, isLoading]);

  useEffect(() => {
    setPage(1);
  }, [query]);

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
      // Deselect — clear category
      setActiveCategory(null);
      setQuery('');
    } else {
      setActiveCategory(category);
      setQuery(category);
      void runSearch(1, confidenceFilter, sortBy, category);
    }
  };

  return (
    <main className="container mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Service Directory</h1>
          <p className="text-gray-600">
            Search verified service listings. Try{' '}
            <Link href="/map" className="text-blue-600 hover:underline inline-flex items-center gap-1">
              <MapIcon className="h-4 w-4" aria-hidden="true" />
              Map view
            </Link>{' '}
            or{' '}
            <Link href="/chat" className="text-blue-600 hover:underline inline-flex items-center gap-1">
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              Chat
            </Link>
            .
          </p>
        </div>
      </div>

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
              className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
              aria-label="Search services"
            />
          </div>
          <Button type="submit" disabled={!canSearch || isLoading}>
            Search
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            className="gap-1 px-2.5"
            aria-expanded={showFilters}
            aria-controls="directory-filters"
          >
            <Filter className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only">Filters</span>
          </Button>
        </form>

        {/* Category chips */}
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Quick category filters">
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

        {/* Filter panel */}
        {showFilters && (
          <div
            id="directory-filters"
            className="mb-4 space-y-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
          >
            {/* Trust filter row */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-gray-700">Trust:</span>
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
              <span className="text-xs text-gray-500 ml-auto hidden sm:inline">
                Trust does not imply certainty — always confirm with the provider.
              </span>
            </div>

            {/* Sort row */}
            <div className="flex items-center gap-3">
              <label htmlFor="sort-select" className="text-xs font-medium text-gray-700">
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
        )}

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
            {Array.from({ length: DEFAULT_LIMIT }).map((_, i) => (
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
                Showing page {data.page} · {data.total} total
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
          </div>
        )}
      </ErrorBoundary>
    </main>
  );
}
