'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, AlertTriangle, ArrowLeft, ArrowRight, MapPin, ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SERVICE_ATTRIBUTES_TAXONOMY } from '@/domain/taxonomy';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { PageHeader } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';
import { ServiceCard } from '@/components/directory/ServiceCard';
import type { SearchResponse } from '@/services/search/types';
import { useToast } from '@/components/ui/toast';
import { trackInteraction } from '@/services/telemetry/sentry';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

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

/** Seeker-facing attribute dimensions — show common tags as quick filter chips */
const SEEKER_ATTRIBUTE_DIMENSIONS = ['delivery', 'cost', 'access'] as const;

const ATTRIBUTE_CHIP_LABELS: Record<string, string> = {
  // Delivery
  in_person: 'In-Person',
  virtual: 'Virtual',
  phone: 'By Phone',
  home_delivery: 'Home Delivery',
  // Cost
  free: 'Free',
  sliding_scale: 'Sliding Scale',
  medicaid: 'Medicaid',
  medicare: 'Medicare',
  no_insurance_required: 'No Insurance Needed',
  ebt_snap: 'EBT/SNAP',
  // Access
  walk_in: 'Walk-In',
  no_id_required: 'No ID Required',
  no_referral_needed: 'No Referral',
  drop_in: 'Drop-In',
  accepting_new_clients: 'Accepting New Clients',
  weekend_hours: 'Weekend Hours',
  evening_hours: 'Evening Hours',
};

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

type TaxonomyTermDTO = {
  id: string;
  term: string;
  description: string | null;
  parentId: string | null;
  taxonomy: string | null;
  serviceCount: number;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export default function DirectoryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const [taxonomyDialogOpen, setTaxonomyDialogOpen] = useState(false);
  const [taxonomyTerms, setTaxonomyTerms] = useState<TaxonomyTermDTO[]>([]);
  const [isLoadingTaxonomy, setIsLoadingTaxonomy] = useState(false);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [taxonomySearch, setTaxonomySearch] = useState('');
  const [selectedTaxonomyIds, setSelectedTaxonomyIds] = useState<string[]>(() => {
    const raw = searchParams.get('taxonomyIds');
    if (!raw) return [];
    return raw.split(',').map((s) => s.trim()).filter((s) => s && isUuid(s));
  });
  const hasLoadedTaxonomyRef = useRef(false);
  const taxonomyLoadInFlightRef = useRef(false);

  // Service attribute dimension filters (delivery, cost, access)
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, string[]>>(() => {
    const raw = searchParams.get('attributes');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const result: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
            result[key] = value as string[];
          }
        }
        return result;
      }
    } catch { /* ignore invalid JSON */ }
    return {};
  });
  const [attributeSectionOpen, setAttributeSectionOpen] = useState(false);

  // Opt-in device geolocation (in-session only; never stored; not reflected in URL)
  const [isLocating, setIsLocating] = useState(false);
  const [deviceLocation, setDeviceLocation] = useState<{ lat: number; lng: number } | null>(null);

  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const savedIdsRef = useRef<Set<string>>(new Set());
  const { success, error: toastError, info } = useToast();

  // Ref for focus management after search
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  // Accumulated results across infinite-scroll pages
  const [allResults, setAllResults] = useState<SearchResponse['results']>([]);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<(() => void) | null>(null);

  const inFlightControllerRef = useRef<AbortController | null>(null);

  /** Push current filter state to the URL without adding history entries */
  const pushUrlState = useCallback((
    q: string,
    confidence: ConfidenceFilter,
    sort: SortOption,
    category: string | null,
    taxonomyIds: string[],
    p: number,
    attributes?: Record<string, string[]>,
  ) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (confidence !== 'all') params.set('confidence', confidence);
    if (sort !== 'relevance') params.set('sort', sort);
    if (category) params.set('category', category);
    if (taxonomyIds.length > 0) params.set('taxonomyIds', taxonomyIds.join(','));
    const attrs = attributes ?? selectedAttributes;
    if (Object.keys(attrs).length > 0) params.set('attributes', JSON.stringify(attrs));
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    router.replace(qs ? `/directory?${qs}` : '/directory', { scroll: false });
  }, [router, selectedAttributes]);

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

  const canSearch = useMemo(() => {
    return query.trim().length > 0 || deviceLocation != null || selectedTaxonomyIds.length > 0 || Object.keys(selectedAttributes).length > 0;
  }, [query, deviceLocation, selectedTaxonomyIds.length, selectedAttributes]);

  const resetResultsToEmpty = useCallback(() => {
    setData(null);
    setAllResults([]);
    setError(null);
    setPage(1);
    pushUrlState('', 'all', 'relevance', null, [], 1);
  }, [pushUrlState]);

  const roundForPrivacy = useCallback((value: number): number => {
    // ~0.01° ≈ 1km (varies by latitude); used to reduce precision exposure.
    return Math.round(value * 100) / 100;
  }, []);

  const runSearch = useCallback(async (
    nextPage: number,
    confidence: ConfidenceFilter = confidenceFilter,
    sort: SortOption = sortBy,
    searchText?: string,
    category?: string | null,
    locationOverride?: { lat: number; lng: number } | null,
    taxonomyOverride?: string[],
    append = false,
    attributesOverride?: Record<string, string[]>,
  ) => {
    const trimmed = (searchText ?? query).trim();

    const effectiveLocation = locationOverride !== undefined ? locationOverride : deviceLocation;
    const effectiveTaxonomyIds = taxonomyOverride !== undefined ? taxonomyOverride : selectedTaxonomyIds;
    const effectiveAttributes = attributesOverride !== undefined ? attributesOverride : selectedAttributes;
    if (!trimmed && !effectiveLocation && effectiveTaxonomyIds.length === 0 && Object.keys(effectiveAttributes).length === 0) return;

    const effectiveCategory = category !== undefined ? category : activeCategory;

    if (append) {
      setIsFetchingMore(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    // Abort any in-flight request to avoid stale results.
    inFlightControllerRef.current?.abort();
    const controller = new AbortController();
    inFlightControllerRef.current = controller;

    try {
      const params = new URLSearchParams({ status: 'active', page: String(nextPage), limit: String(DEFAULT_LIMIT) });

      if (trimmed) {
        params.set('q', trimmed);
      }

      if (effectiveLocation) {
        params.set('lat', String(effectiveLocation.lat));
        params.set('lng', String(effectiveLocation.lng));
      }

      if (effectiveTaxonomyIds.length > 0) {
        params.set('taxonomyIds', effectiveTaxonomyIds.join(','));
      }

      if (Object.keys(effectiveAttributes).length > 0) {
        params.set('attributes', JSON.stringify(effectiveAttributes));
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
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Search failed');
      }

      const json = (await res.json()) as SearchResponse;
      setData(json);
      setPage(nextPage);
      if (append) {
        setAllResults((prev) => {
          const seen = new Set(prev.map((r) => r.service.service.id));
          return [...prev, ...json.results.filter((r) => !seen.has(r.service.service.id))];
        });
      } else {
        setAllResults(json.results);
        // Track non-append searches only (page 1 new queries)
        trackInteraction('search_executed', {
          page: nextPage,
          has_category: (effectiveCategory ?? 'general') !== 'general',
          result_count: json.total,
        });
      }
      // Sync filter state to URL so results are shareable
      pushUrlState(trimmed, confidence, sort, effectiveCategory, effectiveTaxonomyIds, nextPage, effectiveAttributes);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        return;
      }
      setError(e instanceof Error ? e.message : 'Search failed');
      setData(null);
    } finally {
      if (append) {
        setIsFetchingMore(false);
      } else {
        setIsLoading(false);
      }
    }
  }, [query, confidenceFilter, sortBy, activeCategory, deviceLocation, pushUrlState, selectedTaxonomyIds, selectedAttributes]);

  // Keep ref current so the IntersectionObserver callback always sees the latest state.
  loadMoreRef.current = () => {
    if (data?.hasMore && !isLoading && !isFetchingMore) {
      void runSearch(page + 1, confidenceFilter, sortBy, undefined, undefined, undefined, undefined, true);
    }
  };

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMoreRef.current?.();
      },
      { rootMargin: '0px 0px 200px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []); // empty: all state access goes via loadMoreRef

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

  // Auto-run search on first render if URL has a query param
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    const urlQuery = searchParams.get('q');
    const urlTaxonomyIds = searchParams.get('taxonomyIds');
    const parsedTaxonomyIds = urlTaxonomyIds
      ? urlTaxonomyIds.split(',').map((s) => s.trim()).filter((s) => s && isUuid(s))
      : [];
    if (parsedTaxonomyIds.length > 0) {
      setSelectedTaxonomyIds(parsedTaxonomyIds);
    }

    if (urlQuery?.trim() || parsedTaxonomyIds.length > 0 || Object.keys(selectedAttributes).length > 0) {
      didAutoRun.current = true;
      void runSearch(page, confidenceFilter, sortBy, urlQuery?.trim() ?? '', activeCategory, undefined, parsedTaxonomyIds);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTaxonomyTermsIfNeeded = useCallback(async () => {
    if (hasLoadedTaxonomyRef.current) return;
    if (taxonomyLoadInFlightRef.current) return;
    taxonomyLoadInFlightRef.current = true;

    setIsLoadingTaxonomy(true);
    setTaxonomyError(null);
    try {
      const res = await fetch('/api/taxonomy/terms?limit=250', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load filters');
      }
      const json = (await res.json()) as { terms: TaxonomyTermDTO[] };
      if (!isMountedRef.current) return;
      setTaxonomyTerms(Array.isArray(json.terms) ? json.terms : []);
      hasLoadedTaxonomyRef.current = true;
    } catch (e) {
      if (!isMountedRef.current) return;
      setTaxonomyError(e instanceof Error ? e.message : 'Failed to load filters');
    } finally {
      if (isMountedRef.current) setIsLoadingTaxonomy(false);
      taxonomyLoadInFlightRef.current = false;
    }
  }, []);

  // Load taxonomy terms on mount so we can show taxonomy-backed “top tags” chips.
  useEffect(() => {
    void loadTaxonomyTermsIfNeeded();
  }, [loadTaxonomyTermsIfNeeded]);

  const handleTaxonomyOpenChange = useCallback((next: boolean) => {
    setTaxonomyDialogOpen(next);
    if (next) {
      void loadTaxonomyTermsIfNeeded();
    }
  }, [loadTaxonomyTermsIfNeeded]);

  const visibleTaxonomyTerms = useMemo(() => {
    const trimmed = taxonomySearch.trim().toLowerCase();
    if (!trimmed) return taxonomyTerms;
    return taxonomyTerms.filter((t) => t.term.toLowerCase().includes(trimmed));
  }, [taxonomySearch, taxonomyTerms]);

  const visibleTaxonomyTermsSorted = useMemo(() => {
    const selected = new Set(selectedTaxonomyIds);
    return [...visibleTaxonomyTerms].sort((a, b) => {
      const aSel = selected.has(a.id);
      const bSel = selected.has(b.id);
      if (aSel !== bSel) return aSel ? -1 : 1;

      const aCount = typeof a.serviceCount === 'number' ? a.serviceCount : 0;
      const bCount = typeof b.serviceCount === 'number' ? b.serviceCount : 0;
      if (aCount !== bCount) return bCount - aCount;

      return a.term.localeCompare(b.term);
    });
  }, [selectedTaxonomyIds, visibleTaxonomyTerms]);

  const topTaxonomyTerms = useMemo(() => {
    if (taxonomyTerms.length === 0) return [] as TaxonomyTermDTO[];
    return [...taxonomyTerms]
      .filter((t) => typeof t.serviceCount === 'number' && t.serviceCount > 0)
      .sort((a, b) => b.serviceCount - a.serviceCount)
      .slice(0, 8);
  }, [taxonomyTerms]);

  const selectedTagLabel = useMemo(() => {
    if (selectedTaxonomyIds.length === 0) return null;
    const byId = new Map(taxonomyTerms.map((t) => [t.id, t.term] as const));
    const names = selectedTaxonomyIds.map((id) => byId.get(id)).filter((v): v is string => Boolean(v));
    const total = selectedTaxonomyIds.length;

    if (names.length === 0) return `Tags: ${total}`;
    if (total === 1) return `Tag: ${names[0]}`;
    if (names.length === 1) return `Tags: ${names[0]} +${total - 1}`;

    const first = names[0];
    const second = names[1];
    if (total === 2) return `Tags: ${first}, ${second}`;
    return `Tags: ${first}, ${second} +${total - 2}`;
  }, [selectedTaxonomyIds, taxonomyTerms]);

  const selectedTagsKnown = useMemo(() => {
    if (selectedTaxonomyIds.length === 0) return [] as Array<{ id: string; term: string }>;
    const byId = new Map(taxonomyTerms.map((t) => [t.id, t.term] as const));
    return selectedTaxonomyIds
      .map((id) => {
        const term = byId.get(id);
        return term ? { id, term } : null;
      })
      .filter((v): v is { id: string; term: string } => Boolean(v));
  }, [selectedTaxonomyIds, taxonomyTerms]);

  const appliedTagChips = useMemo(() => {
    if (selectedTaxonomyIds.length === 0) {
      return {
        chips: [] as Array<{ id: string; term: string }>,
        remaining: 0,
        hasUnknown: false,
      };
    }

    const known = selectedTagsKnown;
    const unknown = selectedTaxonomyIds.length - known.length;
    const chips = known.slice(0, 2);
    const remaining = Math.max(0, selectedTaxonomyIds.length - chips.length);
    return { chips, remaining, hasUnknown: unknown > 0 };
  }, [selectedTagsKnown, selectedTaxonomyIds.length]);

  const toggleTaxonomyId = useCallback((id: string) => {
    setSelectedTaxonomyIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (next.length === 0 && !query.trim() && !deviceLocation) {
        resetResultsToEmpty();
      } else {
        void runSearch(1, confidenceFilter, sortBy, undefined, undefined, undefined, next);
      }
      return next;
    });
  }, [confidenceFilter, deviceLocation, query, resetResultsToEmpty, runSearch, sortBy]);

  const clearTaxonomyFilters = useCallback(() => {
    setSelectedTaxonomyIds([]);
    if (!query.trim() && !deviceLocation) {
      resetResultsToEmpty();
      return;
    }
    void runSearch(1, confidenceFilter, sortBy, undefined, undefined, undefined, []);
  }, [confidenceFilter, deviceLocation, query, resetResultsToEmpty, runSearch, sortBy]);

  const toggleAttribute = useCallback((dimension: string, tag: string) => {
    setSelectedAttributes((prev) => {
      const current = prev[dimension] ?? [];
      const hasTag = current.includes(tag);
      const nextTags = hasTag ? current.filter((t) => t !== tag) : [...current, tag];
      const next = { ...prev };
      if (nextTags.length === 0) {
        delete next[dimension];
      } else {
        next[dimension] = nextTags;
      }
      void runSearch(1, confidenceFilter, sortBy, undefined, undefined, undefined, undefined, false, next);
      return next;
    });
  }, [confidenceFilter, runSearch, sortBy]);

  const clearAttributes = useCallback(() => {
    setSelectedAttributes({});
    if (!query.trim() && !deviceLocation && selectedTaxonomyIds.length === 0) {
      resetResultsToEmpty();
      return;
    }
    void runSearch(1, confidenceFilter, sortBy, undefined, undefined, undefined, undefined, false, {});
  }, [confidenceFilter, deviceLocation, query, resetResultsToEmpty, runSearch, selectedTaxonomyIds.length, sortBy]);

  const hasActiveAttributes = useMemo(() => Object.keys(selectedAttributes).length > 0, [selectedAttributes]);

  const clearCategory = useCallback(() => {
    setActiveCategory(null);
    if (!query.trim() && !deviceLocation && selectedTaxonomyIds.length === 0) {
      resetResultsToEmpty();
      return;
    }
    void runSearch(1, confidenceFilter, sortBy, undefined, null);
  }, [confidenceFilter, deviceLocation, query, resetResultsToEmpty, runSearch, selectedTaxonomyIds.length, sortBy]);

  const clearTrust = useCallback(() => {
    setConfidenceFilter('all');
    if (data) {
      void runSearch(1, 'all', sortBy);
    }
  }, [data, runSearch, sortBy]);

  const clearSort = useCallback(() => {
    setSortBy('relevance');
    if (data) {
      void runSearch(1, confidenceFilter, 'relevance');
    }
  }, [confidenceFilter, data, runSearch]);

  const clearAllFilters = useCallback(() => {
    const nextQuery = (activeCategory && query.trim().toLowerCase() === activeCategory.toLowerCase())
      ? ''
      : query;

    setConfidenceFilter('all');
    setSortBy('relevance');
    setActiveCategory(null);
    setSelectedTaxonomyIds([]);
    setSelectedAttributes({});
    setTaxonomySearch('');
    setDeviceLocation(null);

    if (!nextQuery.trim()) {
      setQuery('');
      resetResultsToEmpty();
      return;
    }
    setQuery(nextQuery);
    void runSearch(1, 'all', 'relevance', nextQuery, null, null, [], false, {});
  }, [activeCategory, query, resetResultsToEmpty, runSearch]);

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
      pushUrlState('', confidenceFilter, sortBy, null, selectedTaxonomyIds, 1);
    } else {
      setActiveCategory(category);
      setQuery(category);
      void runSearch(1, confidenceFilter, sortBy, category, category);
    }
  };

  const handleClearSearch = useCallback(() => {
    setQuery('');
    setData(null);
    setAllResults([]);
    setError(null);
    setPage(1);
    setActiveCategory(null);
    setSelectedTaxonomyIds([]);
    setSelectedAttributes({});
    pushUrlState('', confidenceFilter, sortBy, null, [], 1, {});
  }, [confidenceFilter, sortBy, pushUrlState]);

  const clearDeviceLocation = useCallback(() => {
    setDeviceLocation(null);
    if (!query.trim() && selectedTaxonomyIds.length === 0) {
      resetResultsToEmpty();
      return;
    }
    void runSearch(1);
  }, [query, resetResultsToEmpty, runSearch, selectedTaxonomyIds.length]);

  return (
    <main className="container mx-auto max-w-6xl px-4 py-8">
      <PageHeader
        title="Service Directory"
        subtitle={
          <>
            Search verified listings. Also try{' '}
            <Link href="/chat" className="text-action-base hover:underline">Chat</Link>
            {' '}or{' '}
            <Link href="/map" className="text-action-base hover:underline">Map view</Link>.
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
              className="w-full rounded-lg border border-gray-300 bg-white pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
              aria-label="Search services"
            />
            {query && (
              <button
                type="button"
                onClick={handleClearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-action"
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

        {deviceLocation && (
          <div className="mb-3">
            <button
              type="button"
              onClick={clearDeviceLocation}
              className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
              aria-label="Clear location filter"
              title="Clear location (not saved)"
            >
              Near you (approx.)
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

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
                  ? 'bg-action-base text-white'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
              }`}
              aria-pressed={activeCategory === cat.value}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Taxonomy tag filters (multi-select) */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-gray-500">Tags:</span>

          {taxonomyError && taxonomyTerms.length === 0 && (
            <span className="text-xs text-error-strong" role="status">Filters unavailable</span>
          )}

          {!taxonomyError && !isLoadingTaxonomy && topTaxonomyTerms.length > 0 && (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Top tags">
              {topTaxonomyTerms.map((t) => {
                const selected = selectedTaxonomyIds.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTaxonomyId(t.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      selected
                        ? 'bg-action-base text-white'
                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                    }`}
                    aria-pressed={selected}
                    title={`${t.serviceCount} services`}
                  >
                    {t.term}
                  </button>
                );
              })}
            </div>
          )}

          <Dialog open={taxonomyDialogOpen} onOpenChange={handleTaxonomyOpenChange}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                More filters{selectedTaxonomyIds.length > 0 ? ` (${selectedTaxonomyIds.length})` : ''}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Filter by service tags</DialogTitle>
                <DialogDescription>
                  Tags come from stored taxonomy terms. You may need to confirm details with the provider.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={taxonomySearch}
                    onChange={(e) => setTaxonomySearch(e.target.value)}
                    type="search"
                    placeholder="Search tags…"
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                    aria-label="Search service tags"
                  />
                  {selectedTaxonomyIds.length > 0 && (
                    <Button type="button" variant="outline" onClick={clearTaxonomyFilters}>
                      Clear
                    </Button>
                  )}
                </div>

                {taxonomyError && (
                  <p className="text-sm text-error-strong" role="alert">{taxonomyError}</p>
                )}

                {isLoadingTaxonomy ? (
                  <p className="text-sm text-gray-600">Loading tags…</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 p-2">
                    <div className="flex flex-wrap gap-2">
                      {visibleTaxonomyTermsSorted.map((t) => {
                        const selected = selectedTaxonomyIds.includes(t.id);
                        return (
                          <Button
                            key={t.id}
                            type="button"
                            size="sm"
                            variant={selected ? 'secondary' : 'outline'}
                            onClick={() => toggleTaxonomyId(t.id)}
                            title={t.description ?? undefined}
                            className="text-xs"
                          >
                            {t.term}
                          </Button>
                        );
                      })}
                      {visibleTaxonomyTerms.length === 0 && (
                        <p className="text-sm text-gray-600 p-2">No matching tags.</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {selectedTaxonomyIds.length > 0 && (
            <button
              type="button"
              onClick={clearTaxonomyFilters}
              className="text-xs text-action-strong hover:underline"
            >
              Clear tags
            </button>
          )}
        </div>

        {/* Service attribute dimension filters (delivery, cost, access) */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setAttributeSectionOpen((v) => !v)}
            className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 mb-2"
            aria-expanded={attributeSectionOpen || hasActiveAttributes}
          >
            Service type filters
            {hasActiveAttributes && (
              <span className="ml-1 rounded-full bg-info-muted text-action-strong px-1.5 py-0.5 text-[10px] font-semibold">
                {Object.values(selectedAttributes).flat().length}
              </span>
            )}
            {attributeSectionOpen ? (
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            )}
          </button>

          {(attributeSectionOpen || hasActiveAttributes) && (
            <div className="space-y-2">
              {SEEKER_ATTRIBUTE_DIMENSIONS.map((dim) => {
                const def = SERVICE_ATTRIBUTES_TAXONOMY[dim];
                if (!def) return null;
                const commonTags = def.tags.filter((t) => t.common);
                const activeTags = selectedAttributes[dim] ?? [];
                return (
                  <div key={dim} className="flex flex-wrap items-center gap-2" role="group" aria-label={def.name}>
                    <span className="text-xs font-medium text-gray-500 w-20 flex-shrink-0">{def.name}:</span>
                    {commonTags.map((t) => {
                      const isActive = activeTags.includes(t.tag);
                      return (
                        <button
                          key={t.tag}
                          type="button"
                          onClick={() => toggleAttribute(dim, t.tag)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            isActive
                              ? 'bg-action-base text-white'
                              : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                          }`}
                          aria-pressed={isActive}
                          title={t.description}
                        >
                          {ATTRIBUTE_CHIP_LABELS[t.tag] ?? t.tag.replace(/_/g, ' ')}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {hasActiveAttributes && (
                <button
                  type="button"
                  onClick={clearAttributes}
                  className="text-xs text-action-strong hover:underline"
                >
                  Clear service type filters
                </button>
              )}
            </div>
          )}
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
                    ? 'bg-action-base text-white'
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
              className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-action min-h-[32px]"
            >
              {SORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {(deviceLocation || activeCategory || selectedTaxonomyIds.length > 0 || hasActiveAttributes || confidenceFilter !== 'all' || sortBy !== 'relevance') && (
          <div
            className="mb-4 flex flex-nowrap items-center gap-2 overflow-x-auto md:flex-wrap md:overflow-visible"
            aria-label="Applied filters"
          >
            <span className="text-xs font-medium text-gray-500">Applied:</span>

            {deviceLocation && (
              <button
                type="button"
                onClick={clearDeviceLocation}
                className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                aria-label="Clear location filter"
              >
                Near you (approx.)
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}

            {activeCategory && (
              <button
                type="button"
                onClick={clearCategory}
                className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                aria-label="Clear category filter"
              >
                Category: {activeCategory}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}

            {selectedTaxonomyIds.length > 0 && (
              <>
                {appliedTagChips.chips.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTaxonomyId(t.id)}
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    aria-label={`Remove tag ${t.term}`}
                    title="Remove tag"
                  >
                    Tag: {t.term}
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                ))}

                {appliedTagChips.remaining > 0 && (
                  <button
                    type="button"
                    onClick={() => handleTaxonomyOpenChange(true)}
                    className="inline-flex flex-shrink-0 items-center rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    aria-label={`View ${appliedTagChips.remaining} more tag filters`}
                    title="View more tags"
                  >
                    +{appliedTagChips.remaining} more
                  </button>
                )}

                {appliedTagChips.hasUnknown && appliedTagChips.chips.length === 0 && (
                  <button
                    type="button"
                    onClick={() => handleTaxonomyOpenChange(true)}
                    className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                    aria-label={`View tag filters (${selectedTaxonomyIds.length})`}
                    title="View tag filters"
                  >
                    {selectedTagLabel ?? `Tags: ${selectedTaxonomyIds.length}`}
                  </button>
                )}
              </>
            )}

            {hasActiveAttributes && (
              <button
                type="button"
                onClick={clearAttributes}
                className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                aria-label="Clear service type filters"
              >
                Service type ({Object.values(selectedAttributes).flat().length})
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}

            {confidenceFilter !== 'all' && (
              <button
                type="button"
                onClick={clearTrust}
                className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                aria-label="Clear trust filter"
              >
                Trust: {confidenceFilter === 'HIGH' ? 'High' : 'Likely+'}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}

            {sortBy !== 'relevance' && (
              <button
                type="button"
                onClick={clearSort}
                className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                aria-label="Clear sort option"
              >
                Sort: {SORT_OPTIONS.find((s) => s.value === sortBy)?.label ?? sortBy}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              onClick={clearAllFilters}
              className="ml-auto text-xs text-action-strong hover:underline"
            >
              Clear all
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-start gap-2 rounded-lg border border-error-soft bg-error-subtle p-3 text-sm text-error-deep"
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
                {allResults.length === 0
                  ? `0 of ${data.total} results`
                  : `Showing ${allResults.length} of ${data.total}`
                }
              </p>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runSearch(Math.max(1, page - 1))}
                  disabled={page <= 1 || isLoading || isFetchingMore}
                  className="gap-1"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Prev
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void runSearch(page + 1, confidenceFilter, sortBy, undefined, undefined, undefined, undefined, true)}
                  disabled={!data.hasMore || isLoading || isFetchingMore}
                  className="gap-1"
                >
                  Next
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            {allResults.length === 0 ? (
              <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
                <p className="text-gray-700 font-medium">No matches</p>
                <p className="mt-1 text-sm text-gray-500">
                  Try different keywords, broaden trust filters, or clear tags.
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {selectedTaxonomyIds.length > 0 && (
                    <Button type="button" variant="outline" size="sm" onClick={clearTaxonomyFilters}>
                      Clear tags
                    </Button>
                  )}
                  {hasActiveAttributes && (
                    <Button type="button" variant="outline" size="sm" onClick={clearAttributes}>
                      Clear service type filters
                    </Button>
                  )}
                  {confidenceFilter !== 'all' && (
                    <Button type="button" variant="outline" size="sm" onClick={clearTrust}>
                      Show all trust levels
                    </Button>
                  )}
                  {activeCategory && (
                    <Button type="button" variant="outline" size="sm" onClick={clearCategory}>
                      Clear category
                    </Button>
                  )}
                  {deviceLocation && (
                    <Button type="button" variant="outline" size="sm" onClick={clearDeviceLocation}>
                      Clear location
                    </Button>
                  )}
                  <Link href="/chat" className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-100">
                    Try Chat
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {allResults.map((r) => (
                    <ServiceCard
                      key={r.service.service.id}
                      enriched={r.service}
                      isSaved={savedIds.has(r.service.service.id)}
                      onToggleSave={toggleSave}
                      href={`/service/${r.service.service.id}`}
                    />
                  ))}
                </div>
                {/* Sentinel for infinite scroll — IntersectionObserver auto-loads next page */}
                <div ref={sentinelRef} aria-hidden="true" className="h-4" />
                {isFetchingMore && (
                  <div
                    className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
                    role="status"
                    aria-label="Loading more results"
                  >
                    {Array.from({ length: 3 }).map((_, i) => (
                      <SkeletonCard key={`more-skeleton-${i}`} />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Bottom pagination — fallback for when infinite scroll hasn’t triggered */}
            {allResults.length > 0 && (
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
                    disabled={page <= 1 || isLoading || isFetchingMore}
                    className="gap-1"
                  >
                    <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                    Prev
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void runSearch(page + 1, confidenceFilter, sortBy, undefined, undefined, undefined, undefined, true)}
                    disabled={!data.hasMore || isLoading || isFetchingMore}
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
