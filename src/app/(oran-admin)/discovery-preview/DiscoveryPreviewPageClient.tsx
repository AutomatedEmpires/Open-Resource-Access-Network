'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, FlaskConical, RefreshCw, Search, WandSparkles } from 'lucide-react';

import { DiscoveryContextPanel } from '@/components/seeker/DiscoveryContextPanel';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { DISCOVERY_NEEDS, type DiscoveryNeedId } from '@/domain/discoveryNeeds';
import type { SearchResponse } from '@/services/search/types';
import {
  buildDiscoveryHref,
  buildDiscoveryUrlParams,
  buildSearchApiParamsFromDiscovery,
  buildSearchQueryFromDiscovery,
  DISCOVERY_CONFIDENCE_OPTIONS,
  DISCOVERY_SORT_OPTIONS,
  hasMeaningfulDiscoveryState,
  parseDiscoveryUrlState,
  sanitizeDiscoveryTaxonomyTermIds,
  type DiscoveryConfidenceFilter,
  type DiscoveryLinkState,
  type DiscoverySortOption,
} from '@/services/search/discovery';
import { DISCOVERY_ATTRIBUTE_LABELS } from '@/services/search/discoveryPresentation';

const PREVIEW_LIMIT = 8;

const ATTRIBUTE_GROUPS: ReadonlyArray<{
  taxonomy: string;
  label: string;
  options: readonly string[];
}> = [
  {
    taxonomy: 'delivery',
    label: 'Delivery',
    options: ['in_person', 'virtual', 'phone', 'home_delivery'],
  },
  {
    taxonomy: 'cost',
    label: 'Cost',
    options: ['free', 'sliding_scale', 'medicaid', 'medicare', 'no_insurance_required', 'ebt_snap'],
  },
  {
    taxonomy: 'access',
    label: 'Access',
    options: [
      'walk_in',
      'drop_in',
      'no_referral_needed',
      'no_id_required',
      'no_documentation_required',
      'no_ssn_required',
      'accepting_new_clients',
      'same_day',
      'next_day',
      'evening_hours',
      'weekend_hours',
    ],
  },
  {
    taxonomy: 'culture',
    label: 'Culture',
    options: ['child_friendly', 'language_interpretation'],
  },
] as const;

interface PreviewFormState {
  text: string;
  needId: DiscoveryNeedId | '';
  confidenceFilter: DiscoveryConfidenceFilter;
  sortBy: DiscoverySortOption;
  taxonomyInput: string;
  attributeFilters: NonNullable<DiscoveryLinkState['attributeFilters']>;
}

type DiscoveryPreviewResponse = Pick<SearchResponse, 'results' | 'total' | 'hasMore'>;

const EMPTY_FORM_STATE: PreviewFormState = {
  text: '',
  needId: '',
  confidenceFilter: 'all',
  sortBy: 'relevance',
  taxonomyInput: '',
  attributeFilters: {},
};

function discoveryStateToFormState(state: DiscoveryLinkState): PreviewFormState {
  return {
    text: state.text ?? '',
    needId: state.needId ?? '',
    confidenceFilter: state.confidenceFilter ?? 'all',
    sortBy: state.sortBy ?? 'relevance',
    taxonomyInput: (state.taxonomyTermIds ?? []).join(', '),
    attributeFilters: Object.fromEntries(
      Object.entries(state.attributeFilters ?? {}).filter(([, values]) => values.length > 0),
    ),
  };
}

function formStateToDiscoveryState(form: PreviewFormState): DiscoveryLinkState {
  const taxonomyTermIds = sanitizeDiscoveryTaxonomyTermIds(form.taxonomyInput);
  const attributeFilters = Object.fromEntries(
    Object.entries(form.attributeFilters).filter(([, values]) => values.length > 0),
  );

  return {
    text: form.text.trim() || undefined,
    needId: form.needId || null,
    confidenceFilter: form.confidenceFilter,
    sortBy: form.sortBy,
    taxonomyTermIds,
    attributeFilters: Object.keys(attributeFilters).length > 0 ? attributeFilters : undefined,
  };
}

function toggleAttributeValue(
  filters: PreviewFormState['attributeFilters'],
  taxonomy: string,
  value: string,
): PreviewFormState['attributeFilters'] {
  const current = filters[taxonomy] ?? [];
  const nextValues = current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];

  if (nextValues.length === 0) {
    const { [taxonomy]: _removed, ...rest } = filters;
    return rest;
  }

  return {
    ...filters,
    [taxonomy]: nextValues,
  };
}

function PreviewResultList({
  data,
  discoveryState,
}: {
  data: DiscoveryPreviewResponse;
  discoveryState: DiscoveryLinkState;
}) {
  if (data.total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-6 text-sm text-gray-600">
        No published services matched this selector bundle.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
        <span>
          Previewing {Math.min(data.results.length, PREVIEW_LIMIT)} of {data.total} matching services
          {data.hasMore ? ' with additional matches behind the preview limit.' : '.'}
        </span>
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildDiscoveryHref('/directory', discoveryState)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:border-blue-200 hover:text-blue-800"
          >
            Directory
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <Link
            href={buildDiscoveryHref('/map', discoveryState)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:border-blue-200 hover:text-blue-800"
          >
            Map
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <Link
            href={buildDiscoveryHref('/chat', discoveryState)}
            className="inline-flex min-h-[44px] items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-xs font-medium text-gray-700 hover:border-blue-200 hover:text-blue-800"
          >
            Chat
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <ul className="space-y-3">
        {data.results.map(({ service }) => (
          <li key={service.service.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-gray-900">{service.service.name}</p>
                <p className="text-xs text-gray-500">{service.organization.name}</p>
                {service.service.description ? (
                  <p className="text-sm text-gray-600 line-clamp-2">{service.service.description}</p>
                ) : null}
              </div>
              <div className="text-right text-xs text-gray-500">
                {service.confidenceScore ? (
                  <>
                    <p className="font-medium text-gray-700">Trust {service.confidenceScore.verificationConfidence}</p>
                    <p>Score {service.confidenceScore.score}</p>
                  </>
                ) : (
                  <p>No confidence score</p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DiscoveryPreviewPageClient() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSearchParams = searchParams.toString();
  const urlState = useMemo(() => parseDiscoveryUrlState(searchParams), [searchParams]);
  const canonicalUrlKey = useMemo(() => buildDiscoveryUrlParams(urlState).toString(), [urlState]);

  const [formState, setFormState] = useState<PreviewFormState>(() => discoveryStateToFormState(urlState));
  const [previewState, setPreviewState] = useState<DiscoveryLinkState | null>(
    hasMeaningfulDiscoveryState(urlState) ? urlState : null,
  );
  const [previewData, setPreviewData] = useState<DiscoveryPreviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastExecutedKeyRef = useRef<string>('');

  useEffect(() => {
    setFormState(discoveryStateToFormState(urlState));
  }, [canonicalUrlKey, urlState]);

  const currentDiscoveryState = useMemo(() => formStateToDiscoveryState(formState), [formState]);
  const compiledQuery = useMemo(
    () => buildSearchQueryFromDiscovery({ ...currentDiscoveryState, limit: PREVIEW_LIMIT }),
    [currentDiscoveryState],
  );
  const compiledApiParams = useMemo(
    () => buildSearchApiParamsFromDiscovery({ ...currentDiscoveryState, limit: PREVIEW_LIMIT }),
    [currentDiscoveryState],
  );

  const runPreview = useCallback(async (state: DiscoveryLinkState, options?: { syncUrl?: boolean }) => {
    const normalizedState = {
      ...state,
      confidenceFilter: state.confidenceFilter ?? 'all',
      sortBy: state.sortBy ?? 'relevance',
    } satisfies DiscoveryLinkState;
    const normalizedKey = buildDiscoveryUrlParams(normalizedState).toString();
    lastExecutedKeyRef.current = normalizedKey;

    if (options?.syncUrl) {
      const href = normalizedKey ? buildDiscoveryHref(pathname, normalizedState) : pathname;
      router.replace(href, { scroll: false });
    }

    if (!hasMeaningfulDiscoveryState(normalizedState)) {
      setPreviewState(null);
      setPreviewData(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    setPreviewState(normalizedState);

    try {
      const params = buildSearchApiParamsFromDiscovery({ ...normalizedState, limit: PREVIEW_LIMIT });
      const response = await fetch(`/api/search?${params.toString()}`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load preview results');
      }

      const json = (await response.json()) as DiscoveryPreviewResponse;
      setPreviewData(json);
    } catch (previewError) {
      setPreviewData(null);
      setError(previewError instanceof Error ? previewError.message : 'Failed to load preview results');
    } finally {
      setIsLoading(false);
    }
  }, [pathname, router]);

  useEffect(() => {
    if (!hasMeaningfulDiscoveryState(urlState)) {
      setPreviewState(null);
      setPreviewData(null);
      setError(null);
      lastExecutedKeyRef.current = '';
      return;
    }

    if (lastExecutedKeyRef.current === canonicalUrlKey) {
      return;
    }

    void runPreview(urlState, { syncUrl: canonicalUrlKey !== currentSearchParams });
  }, [canonicalUrlKey, currentSearchParams, runPreview, urlState]);

  const handlePreview = useCallback(async () => {
    await runPreview(currentDiscoveryState, { syncUrl: true });
  }, [currentDiscoveryState, runPreview]);

  const handleReset = useCallback(() => {
    lastExecutedKeyRef.current = '';
    setFormState(EMPTY_FORM_STATE);
    setPreviewState(null);
    setPreviewData(null);
    setError(null);
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  return (
    <ErrorBoundary>
      <PageHeader
        eyebrow="ORAN Admin"
        title="Discovery Preview"
        icon={<FlaskConical className="h-6 w-6 text-blue-600" aria-hidden="true" />}
        subtitle="Preview the exact seeker-facing discovery grammar used by Directory, Map, and Chat before changing trust, taxonomy, or routing behavior."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Shared compiler</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Shareable canonical URL state</PageHeaderBadge>
            <PageHeaderBadge>{previewData ? `${previewData.total} preview matches` : 'No preview loaded'}</PageHeaderBadge>
          </>
        )}
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={handleReset}>
              Reset
            </Button>
            <Button type="button" size="sm" className="gap-1" onClick={() => void handlePreview()} disabled={isLoading}>
              {isLoading ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
              Preview matches
            </Button>
          </div>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-medium text-gray-900">Search text</span>
              <input
                value={formState.text}
                onChange={(event) => setFormState((current) => ({ ...current, text: event.target.value }))}
                placeholder="Optional free-text query"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </label>

            <label className="space-y-2 text-sm">
              <span className="font-medium text-gray-900">Primary need</span>
              <select
                value={formState.needId}
                onChange={(event) => {
                  setFormState((current) => ({
                    ...current,
                    needId: (event.target.value || '') as DiscoveryNeedId | '',
                  }));
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                <option value="">No preset need</option>
                {DISCOVERY_NEEDS.map((need) => (
                  <option key={need.id} value={need.id}>
                    {need.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="font-medium text-gray-900">Trust floor</span>
              <select
                value={formState.confidenceFilter}
                onChange={(event) => {
                  setFormState((current) => ({
                    ...current,
                    confidenceFilter: event.target.value as DiscoveryConfidenceFilter,
                  }));
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {DISCOVERY_CONFIDENCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="font-medium text-gray-900">Sort order</span>
              <select
                value={formState.sortBy}
                onChange={(event) => {
                  setFormState((current) => ({
                    ...current,
                    sortBy: event.target.value as DiscoverySortOption,
                  }));
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              >
                {DISCOVERY_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-2 text-sm">
            <span className="font-medium text-gray-900">Taxonomy term IDs</span>
            <textarea
              value={formState.taxonomyInput}
              onChange={(event) => setFormState((current) => ({ ...current, taxonomyInput: event.target.value }))}
              rows={3}
              placeholder="Comma or space separated UUIDs"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </label>

          <div className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Attribute filters</h2>
              <p className="mt-1 text-xs text-gray-500">
                These stay human-readable in admin review, but compile through the same machine grammar as seeker flows.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {ATTRIBUTE_GROUPS.map((group) => (
                <fieldset key={group.taxonomy} className="rounded-xl border border-gray-200 p-3">
                  <legend className="px-1 text-sm font-medium text-gray-900">{group.label}</legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {group.options.map((option) => {
                      const selected = (formState.attributeFilters[group.taxonomy] ?? []).includes(option);
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => {
                            setFormState((current) => ({
                              ...current,
                              attributeFilters: toggleAttributeValue(current.attributeFilters, group.taxonomy, option),
                            }));
                          }}
                          className={`inline-flex min-h-[44px] items-center rounded-full border px-3 text-xs font-medium transition-colors ${
                            selected
                              ? 'border-blue-600 bg-blue-600 text-white'
                              : 'border-gray-200 bg-white text-gray-700 hover:border-blue-200 hover:text-blue-800'
                          }`}
                          aria-pressed={selected}
                        >
                          {DISCOVERY_ATTRIBUTE_LABELS[option] ?? option}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <DiscoveryContextPanel
            discoveryContext={currentDiscoveryState}
            title="Canonical discovery scope"
            description="This is the same selector bundle Directory, Map, and Chat now share."
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                <WandSparkles className="h-4 w-4 text-blue-600" aria-hidden="true" />
                Compiled SearchQuery
              </div>
              <pre className="overflow-x-auto rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
                {JSON.stringify(compiledQuery, null, 2)}
              </pre>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Search className="h-4 w-4 text-blue-600" aria-hidden="true" />
                Compiled API params
              </div>
              <code className="block break-all rounded-xl bg-slate-950 p-3 text-xs text-slate-100">
                /api/search?{compiledApiParams.toString()}
              </code>
            </div>
          </div>

          {error ? <FormAlert variant="error" message={error} /> : null}

          {!previewState && !isLoading ? (
            <FormAlert
              variant="info"
              message="Set a need, text query, trust floor, taxonomy term, or attribute filter to preview the seeker-visible match universe."
            />
          ) : null}

          {previewState && previewData ? <PreviewResultList data={previewData} discoveryState={previewState} /> : null}
        </section>
      </div>
    </ErrorBoundary>
  );
}
