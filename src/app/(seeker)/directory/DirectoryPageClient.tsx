'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X, AlertTriangle, ArrowLeft, ArrowRight, MapPin, ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DEFAULT_SEARCH_RADIUS_METERS } from '@/domain/constants';
import { SERVICE_ATTRIBUTES_TAXONOMY } from '@/domain/taxonomy';
import {
  type DiscoveryNeedId,
  getDiscoveryNeedLabel,
  getDiscoveryNeedSearchText,
  isDiscoveryNeedSearchText,
  resolveDiscoveryNeedId,
} from '@/domain/discoveryNeeds';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { SkeletonCard } from '@/components/ui/skeleton';
import { ServiceCard } from '@/components/directory/ServiceCard';
import { DiscoveryContextPanel } from '@/components/seeker/DiscoveryContextPanel';
import { DiscoverySurfaceTabs } from '@/components/seeker/DiscoverySurfaceTabs';
import { SeekerAppliedFilters, type SeekerAppliedFilterItem } from '@/components/seeker/SeekerAppliedFilters';
import { SeekerDiscoveryFilters } from '@/components/seeker/SeekerDiscoveryFilters';
import { readStoredDiscoveryPreference } from '@/services/profile/discoveryPreference';
import { isServerSyncEnabledOnDevice } from '@/services/profile/syncPreference';
import {
  addServerSaved,
  readStoredSavedServiceIdSet,
  removeServerSaved,
  writeStoredSavedServiceIds,
} from '@/services/saved/client';
import { getSavedTogglePresentation } from '@/services/saved/presentation';
import {
  buildDiscoveryHref,
  buildDiscoveryUrlParams,
  buildSearchApiParamsFromDiscovery,
  DISCOVERY_CONFIDENCE_OPTIONS,
  DISCOVERY_SORT_OPTIONS,
  hasMeaningfulDiscoveryState,
  parseDiscoveryUrlState,
  resolveDiscoverySearchText,
  type DiscoveryConfidenceFilter,
  type DiscoverySortOption,
} from '@/services/search/discovery';
import { DISCOVERY_ATTRIBUTE_LABELS } from '@/services/search/discoveryPresentation';
import type { SearchResponse } from '@/services/search/types';
import { useToast } from '@/components/ui/toast';
import { trackInteraction } from '@/services/telemetry/sentry';

const DEFAULT_LIMIT = 12;
type ConfidenceFilter = DiscoveryConfidenceFilter;
type SortOption = DiscoverySortOption;

const CONFIDENCE_OPTIONS = DISCOVERY_CONFIDENCE_OPTIONS;
const SORT_OPTIONS = DISCOVERY_SORT_OPTIONS;

/** Seeker-facing attribute dimensions — show common tags as quick filter chips */
const SEEKER_ATTRIBUTE_DIMENSIONS = ['delivery', 'cost', 'access'] as const;

/** Human-readable labels for taxonomy dimension keys */
const DIMENSION_LABELS: Record<string, string> = {
  delivery: 'Delivery Method',
  cost: 'Cost & Payment',
  access: 'Access',
  eligibility: 'Eligibility',
  languages: 'Languages',
  temporal: 'Schedule',
};

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
  const initialCategoryFromUrl = resolveDiscoveryNeedId(searchParams.get('category'));

  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ── Seed state from URL params so filters are linkable/shareable ──
  const [query, setQuery] = useState(() => {
    const urlQuery = searchParams.get('q');
    if (urlQuery) return urlQuery;
    return getDiscoveryNeedSearchText(initialCategoryFromUrl) ?? '';
  });
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
  const [activeCategory, setActiveCategory] = useState<DiscoveryNeedId | null>(initialCategoryFromUrl);

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
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Opt-in device geolocation (in-session only; never stored; not reflected in URL)
  const [isLocating, setIsLocating] = useState(false);
  const [deviceLocation, setDeviceLocation] = useState<{ lat: number; lng: number } | null>(null);

  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());
  const savedIdsRef = useRef<Set<string>>(new Set());
  const { success, error: toastError, info } = useToast();

  // Ref for focus management after search
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Accumulated results across infinite-scroll pages
  const [allResults, setAllResults] = useState<SearchResponse['results']>([]);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<(() => void) | null>(null);

  const inFlightControllerRef = useRef<AbortController | null>(null);

  const hasSearchContext = useCallback((
    nextQuery: string,
    nextCategory: DiscoveryNeedId | null,
    nextLocation: { lat: number; lng: number } | null,
    nextTaxonomyIds: string[],
    nextAttributes: Record<string, string[]>,
  ) => {
    return Boolean(resolveDiscoverySearchText(nextQuery, nextCategory))
      || nextLocation != null
      || nextTaxonomyIds.length > 0
      || Object.keys(nextAttributes).length > 0;
  }, []);

  /** Push current filter state to the URL without adding history entries */
  const pushUrlState = useCallback((
    q: string,
    confidence: ConfidenceFilter,
    sort: SortOption,
    category: DiscoveryNeedId | null,
    taxonomyIds: string[],
    p: number,
    attributes?: Record<string, string[]>,
  ) => {
    const attrs = attributes ?? selectedAttributes;
    const params = buildDiscoveryUrlParams({
      text: q,
      needId: category,
      confidenceFilter: confidence,
      sortBy: sort,
      taxonomyTermIds: taxonomyIds,
      attributeFilters: attrs,
      page: p,
    });
    const qs = params.toString();
    router.replace(qs ? `/directory?${qs}` : '/directory', { scroll: false });
  }, [router, selectedAttributes]);

  // Load saved IDs from localStorage on mount
  useEffect(() => {
    const next = readStoredSavedServiceIdSet();
    savedIdsRef.current = next;
    setSavedIds(next);
  }, []);

  // Keep ref in sync in case savedIds is updated elsewhere.
  useEffect(() => {
    savedIdsRef.current = savedIds;
  }, [savedIds]);

  const toggleSave = useCallback((serviceId: string) => {
    const wasSaved = savedIdsRef.current.has(serviceId);
    const toggleCopy = getSavedTogglePresentation(wasSaved, savedSyncEnabled);
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) { next.delete(serviceId); } else { next.add(serviceId); }
      savedIdsRef.current = next;
      writeStoredSavedServiceIds(next);
      return next;
    });
    if (savedSyncEnabled) {
      if (wasSaved) {
        void removeServerSaved(serviceId);
      } else {
        void addServerSaved(serviceId);
      }
    }
    success(toggleCopy.toastMessage);
  }, [savedSyncEnabled, success]);

  const canSearch = useMemo(() => {
    return hasSearchContext(query, activeCategory, deviceLocation, selectedTaxonomyIds, selectedAttributes);
  }, [activeCategory, deviceLocation, hasSearchContext, query, selectedAttributes, selectedTaxonomyIds]);

  const resetResultsToEmpty = useCallback(() => {
    setData(null);
    setAllResults([]);
    setError(null);
    setPage(1);
    pushUrlState('', 'all', 'relevance', null, [], 1, {});
  }, [pushUrlState]);

  const roundForPrivacy = useCallback((value: number): number => {
    // ~0.01° ≈ 1km (varies by latitude); used to reduce precision exposure.
    return Math.round(value * 100) / 100;
  }, []);

  const mapHref = useMemo(() => {
    if (!resolveDiscoverySearchText(query, activeCategory)) {
      return '/map';
    }

    const params = buildDiscoveryUrlParams({
      text: query,
      needId: activeCategory,
      confidenceFilter,
      sortBy,
      taxonomyTermIds: selectedTaxonomyIds,
      attributeFilters: selectedAttributes,
    });
    const qs = params.toString();
    return qs ? `/map?${qs}` : '/map';
  }, [activeCategory, confidenceFilter, query, selectedAttributes, selectedTaxonomyIds, sortBy]);

  const chatHref = useMemo(() => {
    return buildDiscoveryHref('/chat', {
      text: query,
      needId: activeCategory,
      confidenceFilter,
      sortBy,
      taxonomyTermIds: selectedTaxonomyIds,
      attributeFilters: selectedAttributes,
    });
  }, [activeCategory, confidenceFilter, query, selectedAttributes, selectedTaxonomyIds, sortBy]);

  const surfaceTabs = useMemo(
    () => [
      { href: chatHref, label: 'Chat' },
      { href: '/directory', label: 'Directory' },
      { href: mapHref, label: 'Map' },
    ],
    [chatHref, mapHref],
  );

  const directoryDiscoveryContext = useMemo(() => {
    return {
      text: query,
      needId: activeCategory,
      confidenceFilter,
      sortBy,
      taxonomyTermIds: selectedTaxonomyIds,
      attributeFilters: selectedAttributes,
      page,
    };
  }, [activeCategory, confidenceFilter, page, query, selectedAttributes, selectedTaxonomyIds, sortBy]);

  const buildServiceDetailHref = useCallback((serviceId: string) => {
    return buildDiscoveryHref(`/service/${serviceId}`, directoryDiscoveryContext);
  }, [directoryDiscoveryContext]);

  const runSearch = useCallback(async (
    nextPage: number,
    confidence: ConfidenceFilter = confidenceFilter,
    sort: SortOption = sortBy,
    searchText?: string,
    category?: DiscoveryNeedId | null,
    locationOverride?: { lat: number; lng: number } | null,
    taxonomyOverride?: string[],
    append = false,
    attributesOverride?: Record<string, string[]>,
  ) => {
    const effectiveLocation = locationOverride !== undefined ? locationOverride : deviceLocation;
    const effectiveTaxonomyIds = taxonomyOverride !== undefined ? taxonomyOverride : selectedTaxonomyIds;
    const effectiveAttributes = attributesOverride !== undefined ? attributesOverride : selectedAttributes;
    const effectiveCategory = category !== undefined ? category : activeCategory;
    const categorySearchText = getDiscoveryNeedSearchText(effectiveCategory) ?? '';
    const trimmed = (searchText ?? query).trim();
    const effectiveSearchText = trimmed || categorySearchText;

    if (!effectiveSearchText && !effectiveLocation && effectiveTaxonomyIds.length === 0 && Object.keys(effectiveAttributes).length === 0) return;

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
      const params = buildSearchApiParamsFromDiscovery({
        text: effectiveSearchText,
        needId: effectiveCategory,
        taxonomyTermIds: effectiveTaxonomyIds,
        attributeFilters: effectiveAttributes,
        confidenceFilter: confidence,
        sortBy: sort,
        page: nextPage,
        limit: DEFAULT_LIMIT,
        geo: effectiveLocation
          ? {
              type: 'radius',
              lat: effectiveLocation.lat,
              lng: effectiveLocation.lng,
              radiusMeters: DEFAULT_SEARCH_RADIUS_METERS,
            }
          : undefined,
      });

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
      pushUrlState(effectiveSearchText, confidence, sort, effectiveCategory, effectiveTaxonomyIds, nextPage, effectiveAttributes);
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

  // Keyboard shortcut: "/" focuses the search input (standard for search-centric pages)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
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

  // Auto-run search on first render if URL has a query param
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    const urlDiscoveryIntent = parseDiscoveryUrlState(searchParams);
    const storedDiscoveryIntent = hasMeaningfulDiscoveryState(urlDiscoveryIntent)
      ? {}
      : readStoredDiscoveryPreference();
    const effectiveDiscoveryIntent = hasMeaningfulDiscoveryState(urlDiscoveryIntent)
      ? urlDiscoveryIntent
      : storedDiscoveryIntent;
    const effectiveCategory = effectiveDiscoveryIntent.needId ?? null;
    const effectiveQuery = resolveDiscoverySearchText(effectiveDiscoveryIntent.text, effectiveCategory);
    const effectiveConfidence = effectiveDiscoveryIntent.confidenceFilter ?? confidenceFilter;
    const effectiveSort = effectiveDiscoveryIntent.sortBy ?? sortBy;
    const effectiveTaxonomyIds = (effectiveDiscoveryIntent.taxonomyTermIds ?? []).filter((value) => isUuid(value));
    const effectiveAttributes = effectiveDiscoveryIntent.attributeFilters ?? {};
    const effectivePage = hasMeaningfulDiscoveryState(urlDiscoveryIntent)
      ? urlDiscoveryIntent.page
      : (effectiveDiscoveryIntent.page ?? 1);

    if (!hasMeaningfulDiscoveryState(effectiveDiscoveryIntent)) return;

    didAutoRun.current = true;
    setQuery(effectiveQuery);
    setActiveCategory(effectiveCategory);
    setConfidenceFilter(effectiveConfidence);
    setSortBy(effectiveSort);
    setPage(effectivePage);
    setSelectedTaxonomyIds(effectiveTaxonomyIds);
    setSelectedAttributes(effectiveAttributes);
    void runSearch(
      effectivePage,
      effectiveConfidence,
      effectiveSort,
      effectiveQuery,
      effectiveCategory,
      undefined,
      effectiveTaxonomyIds,
      false,
      effectiveAttributes,
    );
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

  /** Terms grouped by taxonomy dimension — used in the "More filters" dialog */
  const groupedTaxonomyTerms = useMemo(() => {
    const groups: Record<string, TaxonomyTermDTO[]> = {};
    for (const t of visibleTaxonomyTermsSorted) {
      const key = t.taxonomy ?? 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    return groups;
  }, [visibleTaxonomyTermsSorted]);

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
      if (!hasSearchContext(query, activeCategory, deviceLocation, next, selectedAttributes)) {
        resetResultsToEmpty();
      } else {
        void runSearch(1, confidenceFilter, sortBy, undefined, undefined, undefined, next);
      }
      return next;
    });
  }, [activeCategory, confidenceFilter, deviceLocation, hasSearchContext, query, resetResultsToEmpty, runSearch, selectedAttributes, sortBy]);

  const clearTaxonomyFilters = useCallback(() => {
    setSelectedTaxonomyIds([]);
    if (!hasSearchContext(query, activeCategory, deviceLocation, [], selectedAttributes)) {
      resetResultsToEmpty();
      return;
    }
    void runSearch(1, confidenceFilter, sortBy, undefined, undefined, undefined, []);
  }, [activeCategory, confidenceFilter, deviceLocation, hasSearchContext, query, resetResultsToEmpty, runSearch, selectedAttributes, sortBy]);

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
    if (!hasSearchContext(query, activeCategory, deviceLocation, selectedTaxonomyIds, {})) {
      resetResultsToEmpty();
      return;
    }
    void runSearch(1, confidenceFilter, sortBy, undefined, undefined, undefined, undefined, false, {});
  }, [activeCategory, confidenceFilter, deviceLocation, hasSearchContext, query, resetResultsToEmpty, runSearch, selectedTaxonomyIds, sortBy]);

  const hasActiveAttributes = useMemo(() => Object.keys(selectedAttributes).length > 0, [selectedAttributes]);
  const hasActiveRefinements = useMemo(
    () => Boolean(
      activeCategory
      || deviceLocation
      || selectedTaxonomyIds.length > 0
      || hasActiveAttributes
      || confidenceFilter !== 'all'
      || sortBy !== 'relevance',
    ),
    [activeCategory, confidenceFilter, deviceLocation, hasActiveAttributes, selectedTaxonomyIds.length, sortBy],
  );

  const clearCategory = useCallback(() => {
    const nextQuery = isDiscoveryNeedSearchText(activeCategory, query) ? '' : query;
    setActiveCategory(null);
    setQuery(nextQuery);
    if (!hasSearchContext(nextQuery, null, deviceLocation, selectedTaxonomyIds, selectedAttributes)) {
      resetResultsToEmpty();
      return;
    }
    void runSearch(1, confidenceFilter, sortBy, nextQuery, null);
  }, [activeCategory, confidenceFilter, deviceLocation, hasSearchContext, query, resetResultsToEmpty, runSearch, selectedAttributes, selectedTaxonomyIds, sortBy]);

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

  const clearDeviceLocation = useCallback(() => {
    setDeviceLocation(null);
    if (!hasSearchContext(query, activeCategory, null, selectedTaxonomyIds, selectedAttributes)) {
      resetResultsToEmpty();
      return;
    }
    void runSearch(1, confidenceFilter, sortBy, undefined, undefined, null);
  }, [activeCategory, confidenceFilter, hasSearchContext, query, resetResultsToEmpty, runSearch, selectedAttributes, selectedTaxonomyIds, sortBy]);

  const clearAllFilters = useCallback(() => {
    const nextQuery = isDiscoveryNeedSearchText(activeCategory, query)
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

  const appliedFilterItems = useMemo<SeekerAppliedFilterItem[]>(() => {
    const items: SeekerAppliedFilterItem[] = [];

    if (deviceLocation) {
      items.push({
        id: 'location',
        label: 'Near you (approx.)',
        onClick: clearDeviceLocation,
        ariaLabel: 'Clear location filter',
      });
    }

    if (activeCategory) {
      items.push({
        id: 'category',
        label: `Category: ${getDiscoveryNeedLabel(activeCategory) ?? activeCategory}`,
        onClick: clearCategory,
        ariaLabel: 'Clear category filter',
      });
    }

    appliedTagChips.chips.forEach((tag) => {
      items.push({
        id: `tag-${tag.id}`,
        label: `Tag: ${tag.term}`,
        onClick: () => toggleTaxonomyId(tag.id),
        ariaLabel: `Remove tag ${tag.term}`,
        title: 'Remove tag',
      });
    });

    if (appliedTagChips.remaining > 0) {
      items.push({
        id: 'tags-more',
        label: `+${appliedTagChips.remaining} more`,
        onClick: () => handleTaxonomyOpenChange(true),
        ariaLabel: `View ${appliedTagChips.remaining} more tag filters`,
        title: 'View more tags',
        showRemoveIcon: false,
      });
    }

    if (appliedTagChips.hasUnknown && appliedTagChips.chips.length === 0) {
      items.push({
        id: 'tags-summary',
        label: selectedTagLabel ?? `Tags: ${selectedTaxonomyIds.length}`,
        onClick: () => handleTaxonomyOpenChange(true),
        ariaLabel: `View tag filters (${selectedTaxonomyIds.length})`,
        title: 'View tag filters',
        showRemoveIcon: false,
      });
    }

    if (hasActiveAttributes) {
      items.push({
        id: 'service-type',
        label: `Service type (${Object.values(selectedAttributes).flat().length})`,
        onClick: clearAttributes,
        ariaLabel: 'Clear service type filters',
      });
    }

    if (confidenceFilter !== 'all') {
      items.push({
        id: 'trust',
        label: `Trust: ${confidenceFilter === 'HIGH' ? 'High' : 'Likely+'}`,
        onClick: clearTrust,
        ariaLabel: 'Clear trust filter',
      });
    }

    if (sortBy !== 'relevance') {
      items.push({
        id: 'sort',
        label: `Sort: ${SORT_OPTIONS.find((option) => option.value === sortBy)?.label ?? sortBy}`,
        onClick: clearSort,
        ariaLabel: 'Clear sort option',
      });
    }

    return items;
  }, [
    activeCategory,
    appliedTagChips.chips,
    appliedTagChips.hasUnknown,
    appliedTagChips.remaining,
    clearAttributes,
    clearCategory,
    clearDeviceLocation,
    clearSort,
    clearTrust,
    confidenceFilter,
    deviceLocation,
    handleTaxonomyOpenChange,
    hasActiveAttributes,
    selectedAttributes,
    selectedTagLabel,
    selectedTaxonomyIds.length,
    sortBy,
    toggleTaxonomyId,
  ]);

  const taxonomyLabelById = useMemo<Record<string, string>>(() => {
    return taxonomyTerms.reduce<Record<string, string>>((acc, term) => {
      acc[term.id] = term.term;
      return acc;
    }, {});
  }, [taxonomyTerms]);

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

  const handleCategoryClick = (category: DiscoveryNeedId) => {
    if (activeCategory === category) {
      const nextQuery = isDiscoveryNeedSearchText(activeCategory, query) ? '' : query;
      setActiveCategory(null);
      setQuery(nextQuery);
      if (!hasSearchContext(nextQuery, null, deviceLocation, selectedTaxonomyIds, selectedAttributes)) {
        resetResultsToEmpty();
        return;
      }
      void runSearch(1, confidenceFilter, sortBy, nextQuery, null);
    } else {
      const searchText = getDiscoveryNeedSearchText(category) ?? '';
      setActiveCategory(category);
      setQuery(searchText);
      void runSearch(1, confidenceFilter, sortBy, searchText, category);
    }
  };

  const handleClearSearch = useCallback(() => {
    setQuery('');
    setActiveCategory(null);
    if (!hasSearchContext('', null, deviceLocation, selectedTaxonomyIds, selectedAttributes)) {
      resetResultsToEmpty();
      return;
    }
    void runSearch(1, confidenceFilter, sortBy, '', null);
  }, [confidenceFilter, deviceLocation, hasSearchContext, resetResultsToEmpty, runSearch, selectedAttributes, selectedTaxonomyIds, sortBy]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.32),_transparent_26%),linear-gradient(180deg,_#f7fafc_0%,_#f8fbfd_48%,_#f2f7fb_100%)]">
      <div className="container mx-auto max-w-6xl px-4 pt-4 pb-8 md:py-8">
        <section className="rounded-[30px] border border-slate-200/80 bg-white/92 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-8">
            <PageHeader
              eyebrow="Verified discovery"
              title="Service Directory"
              subtitle="Browse verified services in a quieter, easier-to-scan layout. Refine only when you need to."
              actions={<DiscoverySurfaceTabs items={surfaceTabs} currentHref="/directory" />}
              badges={(
                <>
                  <PageHeaderBadge tone="trust">Verified records only</PageHeaderBadge>
                  {deviceLocation ? <PageHeaderBadge tone="accent">Approximate location active</PageHeaderBadge> : null}
                  {hasActiveRefinements ? <PageHeaderBadge>Refinements on</PageHeaderBadge> : null}
                </>
              )}
            />

            <ErrorBoundary>
              <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] md:p-4">
                <FormSection
                  title="Search the directory"
                  description="Start simple, then open refinements only if you need them."
                  className="mb-3"
                >
                  <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                    <FormField id="directory-search" label="Search services" className="w-full">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
                        <input
                          ref={searchInputRef}
                          id="directory-search"
                          value={query}
                          onChange={(e) => {
                            setQuery(e.target.value);
                            if (activeCategory && !isDiscoveryNeedSearchText(activeCategory, e.target.value)) {
                              setActiveCategory(null);
                            }
                          }}
                          type="search"
                          placeholder="Search for services (e.g., rent help, food pantry, job training)"
                          className="min-h-[46px] w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
                          aria-label="Search services"
                        />
                        {query && (
                          <button
                            type="button"
                            onClick={handleClearSearch}
                            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
                            aria-label="Clear search"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </FormField>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Button type="submit" disabled={!canSearch || isLoading} className="w-full sm:w-auto">
                        Search
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleUseMyLocation}
                        disabled={isLocating}
                        title="Opt-in: uses device location in-session only; not stored"
                        className="w-full gap-1.5 sm:w-auto"
                      >
                        <MapPin className="h-4 w-4" aria-hidden="true" />
                        {isLocating ? 'Locating…' : 'Use my location'}
                      </Button>
                    </div>
                  </form>
                </FormSection>

                {deviceLocation && (
                  <div className="mb-3">
                    <button
                      type="button"
                      onClick={clearDeviceLocation}
                      className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700 shadow-sm hover:bg-white"
                      aria-label="Clear location filter"
                      title="Clear location (not saved)"
                    >
                      Near you (approx.)
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}

                <div className="mb-4 rounded-[20px] border border-slate-200 bg-slate-50/80 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedFilters((current) => !current)}
                      className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
                      aria-expanded={showAdvancedFilters || hasActiveRefinements}
                    >
                      Refine results
                      {hasActiveRefinements ? (
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                          {appliedFilterItems.length || 1}
                        </span>
                      ) : null}
                      {showAdvancedFilters || hasActiveRefinements ? (
                        <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                    <p className="text-xs text-slate-500">
                      {savedSyncEnabled ? 'Saves can sync to your account.' : 'Saves stay on this device.'}
                    </p>
                  </div>

                  {(showAdvancedFilters || hasActiveRefinements) && (
                    <div className="mt-4 space-y-4">
                      <SeekerDiscoveryFilters
                        activeCategory={activeCategory}
                        onCategoryClick={handleCategoryClick}
                        taxonomyError={taxonomyError}
                        taxonomyTerms={taxonomyTerms}
                        isLoadingTaxonomy={isLoadingTaxonomy}
                        quickTaxonomyTerms={topTaxonomyTerms}
                        selectedTaxonomyIds={selectedTaxonomyIds}
                        onToggleTaxonomyId={toggleTaxonomyId}
                        taxonomyDialogOpen={taxonomyDialogOpen}
                        onTaxonomyOpenChange={handleTaxonomyOpenChange}
                        taxonomySearch={taxonomySearch}
                        onTaxonomySearchChange={setTaxonomySearch}
                        onClearTaxonomyFilters={clearTaxonomyFilters}
                        groupedTaxonomyTerms={groupedTaxonomyTerms}
                        visibleTaxonomyTermsCount={visibleTaxonomyTerms.length}
                        dimensionLabels={DIMENSION_LABELS}
                      />

                      <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                  <button
                    type="button"
                    onClick={() => setAttributeSectionOpen((v) => !v)}
                    className="mb-2 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                    aria-expanded={attributeSectionOpen || hasActiveAttributes}
                  >
                    Service type filters
                    {hasActiveAttributes && (
                      <span className="ml-1 rounded-full bg-info-muted px-1.5 py-0.5 text-[10px] font-semibold text-action-strong">
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
                          <div key={dim} className="flex flex-col gap-1.5" role="group" aria-label={def.name}>
                            <span className="text-xs font-medium text-slate-500">{def.name}:</span>
                            <div className="flex flex-wrap gap-1.5">
                            {commonTags.map((t) => {
                              const isActive = activeTags.includes(t.tag);
                              return (
                                <button
                                  key={t.tag}
                                  type="button"
                                  onClick={() => toggleAttribute(dim, t.tag)}
                                  className={`min-h-[44px] flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                    isActive
                                        ? 'bg-slate-900 text-white shadow-sm'
                                        : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                  }`}
                                  aria-pressed={isActive}
                                  title={t.description}
                                >
                                  {DISCOVERY_ATTRIBUTE_LABELS[t.tag] ?? t.tag.replace(/_/g, ' ')}
                                </button>
                              );
                            })}
                            </div>
                          </div>
                        );
                      })}
                      {hasActiveAttributes && (
                        <button
                          type="button"
                          onClick={clearAttributes}
                          className="text-xs font-medium text-sky-700 hover:underline"
                        >
                          Clear service type filters
                        </button>
                      )}
                    </div>
                  )}
                      </div>

                      <FormSection
                        title="Trust and sort"
                        description="Change confidence or ordering without resetting the current search."
                        className="rounded-[18px] border border-slate-200 bg-white p-4"
                      >
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2">
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Trust filter">
                      <span className="text-xs font-medium text-slate-500">Trust:</span>
                      {CONFIDENCE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleConfidenceChange(opt.value)}
                          className={`min-h-[44px] flex-shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            confidenceFilter === opt.value
                              ? 'bg-slate-900 text-white shadow-sm'
                              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                          aria-pressed={confidenceFilter === opt.value}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 sm:ml-auto">
                      <FormField id="sort-select" label="Sort:" className="w-44 max-w-full">
                        <select
                          id="sort-select"
                          value={sortBy}
                          onChange={handleSortChange}
                          className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
                        >
                          {SORT_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </FormField>
                    </div>
                  </div>
                      </FormSection>
                    </div>
                  )}
                </div>

                <SeekerAppliedFilters items={appliedFilterItems} onClearAll={clearAllFilters} />
                {hasActiveRefinements && (
                  <DiscoveryContextPanel
                    discoveryContext={directoryDiscoveryContext}
                    taxonomyLabelById={taxonomyLabelById}
                    title="Current search scope"
                    description="Results stay inside this scope until you change or clear it."
                    className="mb-4 border-slate-200 bg-slate-50"
                  />
                )}

                {error && (
                  <div
                    role="alert"
                    className="mb-6 flex items-start gap-2 rounded-[20px] border border-error-soft bg-error-subtle p-4 text-sm text-error-deep shadow-[0_12px_32px_rgba(127,29,29,0.08)]"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    <div>
                      <p className="font-medium">Search failed</p>
                      <p className="mt-0.5 text-xs">{error}</p>
                    </div>
                  </div>
                )}

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

                {!isLoading && !data && !error && (
                  <div className="rounded-[24px] border border-orange-100 bg-gradient-to-br from-white via-orange-50/70 to-rose-50/50 p-8 text-center shadow-[0_18px_50px_rgba(234,88,12,0.06)]">
                    <p className="text-base font-semibold text-stone-800">Start with a search</p>
                    <p className="mt-1 text-sm text-stone-500">Results are from verified service records only.</p>
                  </div>
                )}

                {!isLoading && data && (
                  <div ref={resultsContainerRef} tabIndex={-1} className="space-y-4 outline-none">
                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-slate-200 bg-slate-50/80 px-4 py-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
                      <p className="text-sm text-stone-600" role="status" aria-live="polite">
                        {allResults.length === 0 ? `0 of ${data.total} results` : `Showing ${allResults.length} of ${data.total}`}
                      </p>

                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void runSearch(Math.max(1, page - 1))}
                          disabled={page <= 1 || isLoading || isFetchingMore}
                          className="gap-1"
                          aria-label="Previous page of results"
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
                          aria-label="Next page of results"
                        >
                          Next
                          <ArrowRight className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>

                    {allResults.length === 0 ? (
                      <div className="rounded-[24px] border border-orange-100 bg-gradient-to-br from-white to-orange-50/60 p-8 text-center shadow-[0_18px_50px_rgba(234,88,12,0.06)]">
                        <p className="text-base font-semibold text-stone-800">No matches</p>
                        <p className="mt-1 text-sm text-stone-500">Try different keywords, broaden trust filters, or clear tags.</p>
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
                          <Link href={chatHref} className="inline-flex items-center rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-orange-50">
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
                              savedSyncEnabled={savedSyncEnabled}
                              href={buildServiceDetailHref(r.service.service.id)}
                              discoveryContext={directoryDiscoveryContext}
                            />
                          ))}
                        </div>
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

                    {allResults.length > 0 && (
                      <div className="flex items-center justify-between gap-4 border-t border-orange-100 pt-3">
                        <p className="text-xs text-stone-400">Page {page}{data.hasMore ? '' : ' · end of results'}</p>
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
              </div>
            </ErrorBoundary>
        </section>
      </div>
    </main>
  );
}
