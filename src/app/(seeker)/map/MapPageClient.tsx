'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, MapPin, List, AlertTriangle, X, ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  type DiscoveryNeedId,
  resolveDiscoveryNeedId,
  isDiscoveryNeedSearchText,
  getDiscoveryNeedSearchText,
} from '@/domain/discoveryNeeds';
import { SERVICE_ATTRIBUTES_TAXONOMY } from '@/domain/taxonomy';
import { ErrorBoundary } from '@/components/ui/error-boundary';
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
  parseDiscoveryAttributeFilters,
  parseDiscoveryUrlState,
  resolveDiscoverySearchText,
  type DiscoveryConfidenceFilter,
  type DiscoverySortOption,
} from '@/services/search/discovery';
import type { SearchResponse } from '@/services/search/types';
import type { EnrichedService } from '@/domain/types';
import { FormField } from '@/components/ui/form-field';
import { FormSection } from '@/components/ui/form-section';
import { useToast } from '@/components/ui/toast';
import { DISCOVERY_ATTRIBUTE_LABELS } from '@/services/search/discoveryPresentation';

// Azure Maps SDK accesses `window` at module evaluation time — must be loaded
// client-side only. The ssr:false dynamic import prevents SSR prerender errors.
const MapContainer = dynamic(
  () => import('@/components/map/MapContainer').then((m) => m.MapContainer),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[60vh] rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-sm">
        Loading map…
      </div>
    ),
  }
);

const DEFAULT_LIMIT = 12;
const DEBOUNCE_MS = 600;
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

interface Bounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

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

export default function MapPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCategoryFromUrl = resolveDiscoveryNeedId(searchParams.get('category'));

  const [query, setQuery] = useState(() => {
    const urlQuery = searchParams.get('q');
    if (urlQuery) return urlQuery;
    return getDiscoveryNeedSearchText(initialCategoryFromUrl) ?? '';
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  // Default to bbox mode so panning/zooming can re-query immediately.
  const [searchMode, setSearchMode] = useState<'text' | 'bbox'>('bbox');

  // Opt-in device geolocation (in-session only; never stored)
  const [isLocating, setIsLocating] = useState(false);
  const [deviceCenter, setDeviceCenter] = useState<{ lat: number; lng: number } | null>(null);

  // Taxonomy filters (IDs are canonical DB UUIDs)
  const [taxonomyTerms, setTaxonomyTerms] = useState<TaxonomyTermDTO[]>([]);
  const [isLoadingTaxonomy, setIsLoadingTaxonomy] = useState(false);
  const [taxonomyError, setTaxonomyError] = useState<string | null>(null);
  const [selectedTaxonomyIds, setSelectedTaxonomyIds] = useState<string[]>(() => {
    const raw = searchParams.get('taxonomyIds');
    if (!raw) return [];
    return raw.split(',').map((s) => s.trim()).filter((s) => s && isUuid(s));
  });
  const [selectedAttributes, setSelectedAttributes] = useState<Record<string, string[]>>(
    () => parseDiscoveryAttributeFilters(searchParams.get('attributes')) ?? {},
  );
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [attributeSectionOpen, setAttributeSectionOpen] = useState(false);
  const [taxonomyDialogOpen, setTaxonomyDialogOpen] = useState(false);
  const [taxonomySearch, setTaxonomySearch] = useState('');

  // Track latest bounds from the map for bbox-on-pan queries
  const boundsRef = useRef<Bounds | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isAreaDirty, setIsAreaDirty] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savedSyncEnabled] = useState(() => isServerSyncEnabledOnDevice());
  const savedIdsRef = useRef<Set<string>>(new Set());
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  /** Mobile-only toggle between map and list view */
  const [mobileView, setMobileView] = useState<'map' | 'list'>('map');
  const [activeCategory, setActiveCategory] = useState<DiscoveryNeedId | null>(initialCategoryFromUrl);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>(() => {
    const value = searchParams.get('confidence');
    return value === 'HIGH' || value === 'LIKELY' ? value : 'all';
  });
  const [sortBy, setSortBy] = useState<SortOption>(() => {
    const value = searchParams.get('sort');
    const valid: SortOption[] = ['relevance', 'trust', 'name_asc', 'name_desc'];
    return valid.includes(value as SortOption) ? (value as SortOption) : 'relevance';
  });
  const { success, error: toastError, info } = useToast();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadTerms() {
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
        if (!cancelled) {
          setTaxonomyTerms(Array.isArray(json.terms) ? json.terms : []);
        }
      } catch (e) {
        if (!cancelled) {
          setTaxonomyError(e instanceof Error ? e.message : 'Failed to load filters');
        }
      } finally {
        if (!cancelled) setIsLoadingTaxonomy(false);
      }
    }

    void loadTerms();
    return () => {
      cancelled = true;
    };
  }, []);

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
        setDeviceCenter({ lat, lng });
        setMobileView('map');
        setSearchMode('bbox');
        setIsAreaDirty(true);
        success('Centered near your location (not saved).');
        setIsLocating(false);
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
  }, [info, isLocating, roundForPrivacy, success, toastError]);

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

  const hasSearchContext = useCallback((
    nextQuery: string,
    nextCategory: DiscoveryNeedId | null,
    nextTaxonomyIds: string[],
    nextAttributes: Record<string, string[]>,
    hasBounds = false,
  ) => {
    return Boolean(resolveDiscoverySearchText(nextQuery, nextCategory))
      || nextTaxonomyIds.length > 0
      || Object.keys(nextAttributes).length > 0
      || hasBounds;
  }, []);

  const hasShareableIntent = useCallback((
    nextQuery: string,
    nextCategory: DiscoveryNeedId | null,
    nextTaxonomyIds: string[],
    nextAttributes: Record<string, string[]>,
  ) => hasSearchContext(nextQuery, nextCategory, nextTaxonomyIds, nextAttributes, false), [hasSearchContext]);

  const pushUrlState = useCallback((
    nextQuery: string,
    nextConfidence: ConfidenceFilter,
    nextSort: SortOption,
    nextCategory: DiscoveryNeedId | null,
    nextTaxonomyIds: string[],
    nextAttributes: Record<string, string[]>,
  ) => {
    if (!hasShareableIntent(nextQuery, nextCategory, nextTaxonomyIds, nextAttributes)) {
      router.replace('/map', { scroll: false });
      return;
    }

    const params = buildDiscoveryUrlParams({
      text: nextQuery,
      needId: nextCategory,
      confidenceFilter: nextConfidence,
      sortBy: nextSort,
      taxonomyTermIds: nextTaxonomyIds,
      attributeFilters: nextAttributes,
    });
    const qs = params.toString();
    router.replace(qs ? `/map?${qs}` : '/map', { scroll: false });
  }, [hasShareableIntent, router]);

  const resetResultsToEmpty = useCallback(() => {
    setData(null);
    setError(null);
    pushUrlState('', 'all', 'relevance', null, [], {});
  }, [pushUrlState]);

  const canSearch = useMemo(
    () => hasSearchContext(query, activeCategory, selectedTaxonomyIds, selectedAttributes, false),
    [activeCategory, hasSearchContext, query, selectedAttributes, selectedTaxonomyIds],
  );

  const taxonomyIdsParam = useMemo(() => {
    return selectedTaxonomyIds.length > 0 ? selectedTaxonomyIds.join(',') : '';
  }, [selectedTaxonomyIds]);

  // Sort by service count so the most-used tags surface first (H3)
  const quickTaxonomyTerms = useMemo(
    () => [...taxonomyTerms].sort((a, b) => b.serviceCount - a.serviceCount).slice(0, 6),
    [taxonomyTerms],
  );

  const visibleTaxonomyTerms = useMemo(() => {
    const trimmed = taxonomySearch.trim().toLowerCase();
    if (!trimmed) return taxonomyTerms;
    return taxonomyTerms.filter((t) => t.term.toLowerCase().includes(trimmed));
  }, [taxonomySearch, taxonomyTerms]);

  /** Terms grouped by taxonomy dimension — used in the "More filters" dialog */
  const groupedTaxonomyTerms = useMemo(() => {
    const groups: Record<string, TaxonomyTermDTO[]> = {};
    for (const t of visibleTaxonomyTerms) {
      const key = t.taxonomy ?? 'other';
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    return groups;
  }, [visibleTaxonomyTerms]);

  const services: EnrichedService[] = useMemo(() => {
    return data?.results?.map((r) => r.service) ?? [];
  }, [data]);

  const pinnedCount = useMemo(
    () => services.filter((s) => s.location?.latitude != null && s.location?.longitude != null).length,
    [services],
  );

  const directoryHref = useMemo(() => {
    const params = buildDiscoveryUrlParams({
      text: query,
      needId: activeCategory,
      confidenceFilter,
      sortBy,
      taxonomyTermIds: selectedTaxonomyIds,
      attributeFilters: selectedAttributes,
    });
    const qs = params.toString();
    return qs ? `/directory?${qs}` : '/directory';
  }, [activeCategory, confidenceFilter, query, selectedAttributes, selectedTaxonomyIds, sortBy]);

  const selectedTagLabel = useMemo(() => {
    if (selectedTaxonomyIds.length === 0) return null;
    const byId = new Map(taxonomyTerms.map((term) => [term.id, term.term] as const));
    const names = selectedTaxonomyIds.map((id) => byId.get(id)).filter((value): value is string => Boolean(value));
    const total = selectedTaxonomyIds.length;

    if (names.length === 0) return `Tags: ${total}`;
    if (total === 1) return `Tag: ${names[0]}`;
    if (names.length === 1) return `Tags: ${names[0]} +${total - 1}`;
    if (total === 2) return `Tags: ${names[0]}, ${names[1]}`;
    return `Tags: ${names[0]}, ${names[1]} +${total - 2}`;
  }, [selectedTaxonomyIds, taxonomyTerms]);

  const selectedTagsKnown = useMemo(() => {
    if (selectedTaxonomyIds.length === 0) return [] as Array<{ id: string; term: string }>;
    const byId = new Map(taxonomyTerms.map((term) => [term.id, term.term] as const));
    return selectedTaxonomyIds
      .map((id) => {
        const term = byId.get(id);
        return term ? { id, term } : null;
      })
      .filter((value): value is { id: string; term: string } => Boolean(value));
  }, [selectedTaxonomyIds, taxonomyTerms]);

  const appliedTagChips = useMemo(() => {
    if (selectedTaxonomyIds.length === 0) {
      return {
        chips: [] as Array<{ id: string; term: string }>,
        remaining: 0,
        hasUnknown: false,
      };
    }

    const chips = selectedTagsKnown.slice(0, 2);
    const unknown = selectedTaxonomyIds.length - selectedTagsKnown.length;
    return {
      chips,
      remaining: Math.max(0, selectedTaxonomyIds.length - chips.length),
      hasUnknown: unknown > 0,
    };
  }, [selectedTagsKnown, selectedTaxonomyIds.length]);

  const mapDiscoveryContext = useMemo(() => {
    return {
      text: query,
      needId: activeCategory,
      confidenceFilter,
      sortBy,
      taxonomyTermIds: selectedTaxonomyIds,
      attributeFilters: selectedAttributes,
    };
  }, [activeCategory, confidenceFilter, query, selectedAttributes, selectedTaxonomyIds, sortBy]);

  const chatHref = useMemo(() => {
    return buildDiscoveryHref('/chat', mapDiscoveryContext);
  }, [mapDiscoveryContext]);

  const surfaceTabs = useMemo(
    () => [
      { href: chatHref, label: 'Chat' },
      { href: directoryHref, label: 'Directory' },
      { href: '/map', label: 'Map' },
    ],
    [chatHref, directoryHref],
  );

  const taxonomyLabelById = useMemo<Record<string, string>>(() => {
    return taxonomyTerms.reduce<Record<string, string>>((acc, term) => {
      acc[term.id] = term.term;
      return acc;
    }, {});
  }, [taxonomyTerms]);

  const buildServiceDetailHref = useCallback((serviceId: string) => {
    return buildDiscoveryHref(`/service/${serviceId}`, mapDiscoveryContext);
  }, [mapDiscoveryContext]);

  // ── fetch services (text OR bbox) ─────────────────────────
  const runSearch = useCallback(
    async (opts?: {
      bbox?: Bounds;
      taxonomyIds?: string;
      attributes?: Record<string, string[]>;
      confidence?: ConfidenceFilter;
      sort?: SortOption;
      category?: DiscoveryNeedId | null;
      text?: string;
    }) => {
      const trimmed = (opts?.text ?? query).trim();
      const bbox = opts?.bbox;
      const taxonomyIds = opts?.taxonomyIds;
      const effectiveAttributes = opts?.attributes ?? selectedAttributes;
      const effectiveConfidence = opts?.confidence !== undefined ? opts.confidence : confidenceFilter;
      const effectiveSort = opts?.sort !== undefined ? opts.sort : sortBy;
      // category is passed explicitly when a chip is toggled so the state update
      // and the fetch are always in sync
      const effectiveCategory = opts?.category !== undefined ? opts.category : activeCategory;
      const categorySearchText = getDiscoveryNeedSearchText(effectiveCategory) ?? '';

      setIsLoading(true);
      setError(null);

      try {
        const effectiveTaxonomyIds = taxonomyIds ?? taxonomyIdsParam;
        const effectiveTaxonomyIdList = effectiveTaxonomyIds ? effectiveTaxonomyIds.split(',').filter(Boolean) : [];
        if (!hasSearchContext(trimmed, effectiveCategory, effectiveTaxonomyIdList, effectiveAttributes, Boolean(bbox))) {
          setIsLoading(false);
          return;
        }
        const params = buildSearchApiParamsFromDiscovery({
          text: trimmed || categorySearchText,
          needId: effectiveCategory,
          taxonomyTermIds: effectiveTaxonomyIdList,
          attributeFilters: effectiveAttributes,
          confidenceFilter: effectiveConfidence,
          sortBy: effectiveSort,
          page: 1,
          limit: DEFAULT_LIMIT,
          geo: bbox
            ? {
                type: 'bbox',
                minLat: bbox.minLat,
                minLng: bbox.minLng,
                maxLat: bbox.maxLat,
                maxLng: bbox.maxLng,
              }
            : undefined,
        });

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
        setIsAreaDirty(false);
        pushUrlState(
          trimmed || categorySearchText,
          effectiveConfidence,
          effectiveSort,
          effectiveCategory,
          effectiveTaxonomyIdList,
          effectiveAttributes,
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Search failed');
        setData(null);
      } finally {
        setIsLoading(false);
      }
    },
    [activeCategory, confidenceFilter, hasSearchContext, pushUrlState, query, selectedAttributes, sortBy, taxonomyIdsParam],
  );

  const toggleTaxonomyId = useCallback((id: string) => {
    setSelectedTaxonomyIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      const nextParam = next.length > 0 ? next.join(',') : '';

      // Re-run the current search context so filters feel immediate.
      if (boundsRef.current) {
        void runSearch({ bbox: boundsRef.current, taxonomyIds: nextParam });
      } else if (hasSearchContext(query, activeCategory, next, selectedAttributes, false)) {
        void runSearch({ taxonomyIds: nextParam });
      }

      return next;
    });
  }, [activeCategory, hasSearchContext, query, runSearch, selectedAttributes]);

  const clearTaxonomyFilters = useCallback(() => {
    setSelectedTaxonomyIds([]);
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, taxonomyIds: '' });
    } else if (hasSearchContext(query, activeCategory, [], selectedAttributes, false)) {
      void runSearch({ taxonomyIds: '' });
    }
  }, [activeCategory, hasSearchContext, query, runSearch, selectedAttributes]);

  const clearCategory = useCallback(() => {
    setActiveCategory(null);
    if (!hasSearchContext(query, null, selectedTaxonomyIds, selectedAttributes, Boolean(boundsRef.current))) {
      resetResultsToEmpty();
      return;
    }
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, category: null, attributes: selectedAttributes });
      return;
    }
    void runSearch({ category: null, attributes: selectedAttributes });
  }, [hasSearchContext, query, resetResultsToEmpty, runSearch, selectedAttributes, selectedTaxonomyIds]);

  const clearTrust = useCallback(() => {
    setConfidenceFilter('all');
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, confidence: 'all' });
    } else if (hasSearchContext(query, activeCategory, selectedTaxonomyIds, selectedAttributes, false)) {
      void runSearch({ confidence: 'all' });
    }
  }, [activeCategory, hasSearchContext, query, runSearch, selectedAttributes, selectedTaxonomyIds]);

  const clearSort = useCallback(() => {
    setSortBy('relevance');
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, sort: 'relevance' });
    } else if (hasSearchContext(query, activeCategory, selectedTaxonomyIds, selectedAttributes, false)) {
      void runSearch({ sort: 'relevance' });
    }
  }, [activeCategory, hasSearchContext, query, runSearch, selectedAttributes, selectedTaxonomyIds]);

  const clearAttributes = useCallback(() => {
    setSelectedAttributes({});
    if (!hasSearchContext(query, activeCategory, selectedTaxonomyIds, {}, Boolean(boundsRef.current))) {
      resetResultsToEmpty();
      return;
    }
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, attributes: {} });
      return;
    }
    void runSearch({ attributes: {} });
  }, [activeCategory, hasSearchContext, query, resetResultsToEmpty, runSearch, selectedTaxonomyIds]);

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
      if (boundsRef.current) {
        void runSearch({ bbox: boundsRef.current, attributes: next });
      } else if (hasSearchContext(query, activeCategory, selectedTaxonomyIds, next, false)) {
        void runSearch({ attributes: next });
      }
      return next;
    });
  }, [activeCategory, hasSearchContext, query, runSearch, selectedTaxonomyIds]);

  const hasActiveAttributes = useMemo(() => Object.keys(selectedAttributes).length > 0, [selectedAttributes]);
  const hasActiveRefinements = useMemo(
    () => Boolean(
      activeCategory
      || deviceCenter
      || selectedTaxonomyIds.length > 0
      || hasActiveAttributes
      || confidenceFilter !== 'all'
      || sortBy !== 'relevance',
    ),
    [activeCategory, confidenceFilter, deviceCenter, hasActiveAttributes, selectedTaxonomyIds.length, sortBy],
  );

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

  const clearAllFilters = useCallback(() => {
    setQuery('');
    setActiveCategory(null);
    setSelectedTaxonomyIds([]);
    setSelectedAttributes({});
    setTaxonomySearch('');
    setConfidenceFilter('all');
    setSortBy('relevance');
    if (boundsRef.current) {
      void runSearch({
        bbox: boundsRef.current,
        text: '',
        category: null,
        taxonomyIds: '',
        attributes: {},
        confidence: 'all',
        sort: 'relevance',
      });
      return;
    }
    resetResultsToEmpty();
  }, [resetResultsToEmpty, runSearch]);

  const appliedFilterItems = useMemo<SeekerAppliedFilterItem[]>(() => {
    const items: SeekerAppliedFilterItem[] = [];

    if (activeCategory) {
      items.push({
        id: 'category',
        label: `Category: ${activeCategory.replace(/_/g, ' ')}`,
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
        onClick: () => setTaxonomyDialogOpen(true),
        ariaLabel: `View ${appliedTagChips.remaining} more tag filters`,
        title: 'View more tags',
        showRemoveIcon: false,
      });
    }

    if (appliedTagChips.hasUnknown && appliedTagChips.chips.length === 0) {
      items.push({
        id: 'tags-summary',
        label: selectedTagLabel ?? `Tags: ${selectedTaxonomyIds.length}`,
        onClick: () => setTaxonomyDialogOpen(true),
        ariaLabel: `View tag filters (${selectedTaxonomyIds.length})`,
        title: 'View tag filters',
        showRemoveIcon: false,
      });
    }

    if (Object.keys(selectedAttributes).length > 0) {
      items.push({
        id: 'service-filters',
        label: `Service filters (${Object.values(selectedAttributes).flat().length})`,
        onClick: clearAttributes,
        ariaLabel: 'Clear service filters',
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
    clearSort,
    clearTrust,
    confidenceFilter,
    selectedAttributes,
    selectedTagLabel,
    selectedTaxonomyIds.length,
    sortBy,
    toggleTaxonomyId,
  ]);

  const handleCategoryClick = useCallback((category: DiscoveryNeedId) => {
    const next = activeCategory === category ? null : category;
    setActiveCategory(next);
    setQuery('');
    if (boundsRef.current) {
      void runSearch({ bbox: boundsRef.current, category: next, text: '' });
    } else {
      void runSearch({ category: next, text: '' });
    }
  }, [activeCategory, runSearch]);

  // ── text search submit ────────────────────────────────────
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Keep bbox mode so results remain tied to the visible map area.
    setSearchMode('bbox');
    setIsAreaDirty(false);
    void runSearch({ bbox: boundsRef.current ?? undefined });
  };

  // ── toggle to "search this area" mode ─────────────────────
  const searchThisArea = useCallback(() => {
    if (!boundsRef.current) return;
    setSearchMode('bbox');
    setIsAreaDirty(false);
    void runSearch({ bbox: boundsRef.current });
  }, [runSearch]);

  // ── handle map bounds change (debounced bbox re-query) ────
  const handleBoundsChange = useCallback(
    (bounds: Bounds) => {
      boundsRef.current = bounds;
      if (searchMode !== 'bbox') return; // only auto re-query in bbox mode

      // Mobile behavior: Zillow-like “Search this area” CTA.
      if (isMobile) {
        setIsAreaDirty(true);
        return;
      }

      // Desktop behavior: auto refresh (debounced).
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void runSearch({ bbox: bounds });
      }, DEBOUNCE_MS);
    },
    [isMobile, searchMode, runSearch],
  );

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Focus results container when results arrive for keyboard users
  useEffect(() => {
    if (data && !isLoading && resultsContainerRef.current) {
      resultsContainerRef.current.focus();
    }
  }, [data, isLoading]);

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
    if (!hasSearchContext(effectiveQuery, effectiveCategory, effectiveTaxonomyIds, effectiveAttributes, false)) return;

    didAutoRun.current = true;
    setQuery(effectiveQuery);
    setActiveCategory(effectiveCategory);
    setConfidenceFilter(effectiveConfidence);
    setSortBy(effectiveSort);
    setSelectedTaxonomyIds(effectiveTaxonomyIds);
    setSelectedAttributes(effectiveAttributes);
    void runSearch({
      text: effectiveQuery,
      category: effectiveCategory,
      taxonomyIds: effectiveTaxonomyIds.length > 0 ? effectiveTaxonomyIds.join(',') : undefined,
      attributes: effectiveAttributes,
      confidence: effectiveConfidence,
      sort: effectiveSort,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearSearch = useCallback(() => {
    setQuery('');
    setActiveCategory(null);

    if (!hasSearchContext('', null, selectedTaxonomyIds, selectedAttributes, Boolean(boundsRef.current))) {
      resetResultsToEmpty();
      return;
    }

    if (boundsRef.current) {
      void runSearch({
        bbox: boundsRef.current,
        text: '',
        category: null,
        taxonomyIds: taxonomyIdsParam || undefined,
        attributes: selectedAttributes,
      });
      return;
    }

    void runSearch({
      text: '',
      category: null,
      taxonomyIds: taxonomyIdsParam || undefined,
      attributes: selectedAttributes,
    });
  }, [hasSearchContext, resetResultsToEmpty, runSearch, selectedAttributes, selectedTaxonomyIds, taxonomyIdsParam]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(186,230,253,0.32),_transparent_26%),linear-gradient(180deg,_#f7fafc_0%,_#f8fbfd_48%,_#f2f7fb_100%)]">
      <div className="container mx-auto max-w-6xl px-4 pt-4 pb-8 md:py-8">
        <section className="rounded-[30px] border border-slate-200/80 bg-white/92 p-4 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur md:p-8">
            <PageHeader
              eyebrow="Verified discovery"
              title="Service Map"
              actions={<DiscoverySurfaceTabs items={surfaceTabs} currentHref="/map" />}
              badges={(
                <>
                  <PageHeaderBadge tone="trust">Verified records only</PageHeaderBadge>
                  {deviceCenter ? <PageHeaderBadge tone="accent">Approximate location active</PageHeaderBadge> : null}
                  {hasActiveRefinements ? <PageHeaderBadge>Refinements on</PageHeaderBadge> : null}
                </>
              )}
            />

            <ErrorBoundary>
              <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.96))] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] md:p-4">
        {/* Search bar */}
        <FormSection
          className="mb-3"
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-2">
            <FormField id="map-search" label="Search services to plot" className="w-full">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" aria-hidden="true" />
                <input
                  ref={searchInputRef}
                  id="map-search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    if (activeCategory && !isDiscoveryNeedSearchText(activeCategory, e.target.value)) {
                      setActiveCategory(null);
                    }
                  }}
                  type="search"
                  placeholder="Search for services (e.g., food bank, shelter)"
                  className="min-h-[46px] w-full rounded-2xl border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
                  aria-label="Search services to plot"
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
                className="w-full sm:w-auto"
              >
                {isLocating ? 'Locating…' : 'Use my location'}
              </Button>
            </div>
          </form>
        </FormSection>

        <div className="mb-3 rounded-[20px] border border-slate-200 bg-slate-50/80 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShowAdvancedFilters((current) => !current)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              aria-expanded={showAdvancedFilters || hasActiveRefinements}
            >
              Refine map
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
                quickTaxonomyTerms={quickTaxonomyTerms}
                selectedTaxonomyIds={selectedTaxonomyIds}
                onToggleTaxonomyId={toggleTaxonomyId}
                taxonomyDialogOpen={taxonomyDialogOpen}
                onTaxonomyOpenChange={setTaxonomyDialogOpen}
                taxonomySearch={taxonomySearch}
                onTaxonomySearchChange={setTaxonomySearch}
                onClearTaxonomyFilters={clearTaxonomyFilters}
                groupedTaxonomyTerms={groupedTaxonomyTerms}
                visibleTaxonomyTermsCount={visibleTaxonomyTerms.length}
                dimensionLabels={DIMENSION_LABELS}
                categoryGroupLabel="Filter by service category"
                showCategoryLabel={false}
              />

              {/* Service attribute dimension filters (delivery, cost, access) */}
              <div className="rounded-[18px] border border-slate-200 bg-white p-4">
          <button
            type="button"
            onClick={() => setAttributeSectionOpen((v) => !v)}
            className="mb-2 flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
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
                  <div key={dim} className="flex flex-col gap-1.5" role="group" aria-label={def.name}>
                    <span className="text-xs font-medium text-stone-500">{def.name}:</span>
                    <div className="flex flex-wrap gap-1.5">
                    {commonTags.map((t) => {
                      const isActive = activeTags.includes(t.tag);
                      return (
                        <button
                          key={t.tag}
                          type="button"
                          onClick={() => toggleAttribute(dim, t.tag)}
                          className={`inline-flex items-center justify-center rounded-full px-3 py-1 text-xs font-medium transition-colors min-h-[44px] flex-shrink-0 ${
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

              {/* Confidence + sort controls */}
              <FormSection
                className="rounded-[18px] border border-slate-200 bg-white p-4"
              >
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <FormField id="map-confidence" label="Trust:" className="w-40 max-w-full">
              <select
                id="map-confidence"
                value={confidenceFilter}
                onChange={(e) => {
                  const next = e.target.value as ConfidenceFilter;
                  setConfidenceFilter(next);
                  if (boundsRef.current) {
                    void runSearch({ bbox: boundsRef.current, confidence: next });
                  } else if (hasSearchContext(query, activeCategory, selectedTaxonomyIds, selectedAttributes, false)) {
                    void runSearch({ confidence: next });
                  }
                }}
                className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                {CONFIDENCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </FormField>
            <FormField id="map-sort" label="Sort:" className="w-44 max-w-full">
              <select
                id="map-sort"
                value={sortBy}
                onChange={(e) => {
                  const next = e.target.value as SortOption;
                  setSortBy(next);
                  if (boundsRef.current) {
                    void runSearch({ bbox: boundsRef.current, sort: next });
                  } else if (hasSearchContext(query, activeCategory, selectedTaxonomyIds, selectedAttributes, false)) {
                    void runSearch({ sort: next });
                  }
                }}
                className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-400"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </FormField>
          </div>
              </FormSection>
            </div>
          )}
        </div>

        <SeekerAppliedFilters items={appliedFilterItems} onClearAll={clearAllFilters} />
        {hasActiveRefinements && (
          <DiscoveryContextPanel
            discoveryContext={mapDiscoveryContext}
            taxonomyLabelById={taxonomyLabelById}
            title="Current map scope"
            description="The map and list stay inside this scope until you change it."
            className="mb-3 border-slate-200 bg-slate-50"
          />
        )}

        {/* Mobile view toggle — only visible below md */}
        <div className="mb-3 flex gap-1 rounded-[18px] border border-orange-100 bg-white/80 p-1 shadow-[0_8px_24px_rgba(234,88,12,0.04)] md:hidden">
          <button
            type="button"
            onClick={() => setMobileView('map')}
            className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium transition-colors flex-1 justify-center ${
              mobileView === 'map'
                ? 'bg-action-base text-white shadow-sm'
                : 'border border-orange-200 bg-white text-stone-700 hover:bg-orange-50'
            }`}
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            Map view
          </button>
          <button
            type="button"
            onClick={() => setMobileView('list')}
            className={`flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg text-xs font-medium transition-colors flex-1 justify-center ${
              mobileView === 'list'
                ? 'bg-action-base text-white shadow-sm'
                : 'border border-orange-200 bg-white text-stone-700 hover:bg-orange-50'
            }`}
          >
            <List className="h-3.5 w-3.5" aria-hidden="true" />
            List ({data?.total ?? 0})
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-2 rounded-[20px] border border-error-soft bg-error-subtle p-4 text-sm text-error-deep shadow-[0_12px_32px_rgba(127,29,29,0.08)]"
          >
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">Search failed</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Split-pane layout: stacked on mobile, side-by-side on desktop */}
        <div className="md:grid md:grid-cols-[1fr_380px] md:gap-4 md:items-start">
          {/* Map column */}
          <div className={`overflow-hidden rounded-[24px] border border-slate-200 bg-white/92 p-2 shadow-[0_18px_50px_rgba(15,23,42,0.06)] md:sticky md:top-24 ${
            mobileView === 'list' ? 'hidden md:block' : ''
          }`}>
            <div className="relative">
              <MapContainer
                className="w-full h-[50vh] md:h-[calc(100vh-16rem)]"
                centerLat={deviceCenter?.lat}
                centerLng={deviceCenter?.lng}
                zoom={deviceCenter ? 12 : undefined}
                services={services}
                discoveryContext={mapDiscoveryContext}
                onBoundsChange={handleBoundsChange}
              />

              {/* Mobile: show CTA only after pan/zoom */}
              {isMobile && isAreaDirty && (
                <div className="absolute left-0 right-0 top-3 flex justify-center px-3 pointer-events-none">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={searchThisArea}
                    className="gap-1.5 text-xs pointer-events-auto"
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                    Search this area
                  </Button>
                </div>
              )}
            </div>

            {/* Desktop: always-visible control */}
            <div className="mt-3 hidden items-center gap-3 px-2 pb-1 md:flex">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={searchThisArea}
                className="gap-1.5 text-xs"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                Search this area
              </Button>
              {searchMode === 'bbox' && (
                <span className="text-xs text-stone-500">Updates as you pan.</span>
              )}
            </div>
          </div>

          {/* Results column */}
          <div
            ref={resultsContainerRef}
            tabIndex={-1}
            className={`mt-4 rounded-[24px] border border-slate-200 bg-white/92 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)] outline-none md:mt-0 md:max-h-[calc(100vh-16rem)] md:overflow-y-auto ${
              mobileView === 'map' ? 'hidden md:block' : ''
            }`}
          >
            {isLoading && (
              <div
                className="space-y-3"
                role="status"
                aria-busy="true"
                aria-label="Loading map results"
              >
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonCard key={`map-skeleton-${i}`} />
                ))}
              </div>
            )}

            {!isLoading && !data && !error && (
              <div className="rounded-[20px] border border-orange-100 bg-gradient-to-br from-white to-orange-50/70 p-6 text-center shadow-[0_10px_30px_rgba(234,88,12,0.04)]">
                <MapPin className="mx-auto mb-2 h-8 w-8 text-orange-200" aria-hidden="true" />
                <p className="text-sm font-semibold text-stone-800">Ready to search</p>
                <p className="mt-1 text-xs text-stone-500">
                  Type a keyword above, tap a category chip, or pan the map and tap <strong>Search this area</strong>.
                </p>
              </div>
            )}

            {!isLoading && data && (
              <>
                <p className="mb-3 text-xs text-stone-500" role="status" aria-live="polite">
                  {data.results.length === 0
                    ? 'No matches'
                    : `${data.results.length} of ${data.total} shown`}
                  {pinnedCount > 0 && data.results.length > 0 && (
                    <span className="ml-1">· {pinnedCount} pinned</span>
                  )}
                </p>
                {data.results.length === 0 ? (
                  <div className="rounded-[20px] border border-orange-100 bg-gradient-to-br from-white to-orange-50/60 p-6 text-center shadow-[0_10px_30px_rgba(234,88,12,0.04)]">
                    <p className="text-sm font-semibold text-stone-800">No matches in this area</p>
                    <p className="mt-1 text-xs text-stone-500">Try different keywords, a broader category, or pan to a new area.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {data.results.map((r) => (
                      <div key={r.service.service.id} className="flex items-stretch gap-3">
                        <ConfidenceRing enriched={r.service} />
                        <div className="flex-1">
                          <ServiceCard
                            enriched={r.service}
                            compact
                            isSaved={savedIds.has(r.service.service.id)}
                            onToggleSave={toggleSave}
                            savedSyncEnabled={savedSyncEnabled}
                            href={buildServiceDetailHref(r.service.service.id)}
                            discoveryContext={mapDiscoveryContext}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
              </div>
        </div>
              </div>
            </ErrorBoundary>
        </section>
      </div>
    </main>
  );
}

function getConfidenceScore(enriched: EnrichedService): number | null {
  const score = enriched.confidenceScore?.score;
  return typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
}

function ConfidenceRing({ enriched }: { enriched: EnrichedService }) {
  const score = getConfidenceScore(enriched);
  const value = score ?? 0;
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const dash = (value / 100) * circumference;

  const strokeClass =
    score == null ? 'stroke-gray-300' :
      value >= 80 ? 'stroke-green-600' :
      value >= 60 ? 'stroke-yellow-500' :
      value >= 40 ? 'stroke-orange-500' :
      'stroke-red-600';

  return (
    <div
      className="flex-shrink-0 w-10"
      aria-label={score == null ? 'Trust score unknown' : `Trust ${Math.round(value)} percent`}
      title={score == null ? 'Trust score unknown' : `Trust: ${Math.round(value)}%`}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" role="img" aria-hidden="true">
        <circle
          cx="20"
          cy="20"
          r={radius}
          className="stroke-gray-200"
          strokeWidth="4"
          fill="none"
        />
        <circle
          cx="20"
          cy="20"
          r={radius}
          className={strokeClass}
          strokeWidth="4"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          transform="rotate(-90 20 20)"
        />
        <text
          x="20"
          y="21"
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-gray-700 text-[10px] font-semibold"
        >
          {score == null ? '—' : `${Math.round(value)}%`}
        </text>
      </svg>
    </div>
  );
}
