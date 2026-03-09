'use client';

import React from 'react';
import { QUICK_DISCOVERY_NEEDS, type DiscoveryNeedId } from '@/domain/discoveryNeeds';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type TaxonomyTermOption = {
  id: string;
  term: string;
  description: string | null;
  taxonomy: string | null;
  serviceCount?: number;
};

interface SeekerDiscoveryFiltersProps {
  activeCategory: DiscoveryNeedId | null;
  onCategoryClick: (category: DiscoveryNeedId) => void;
  taxonomyError: string | null;
  taxonomyTerms: TaxonomyTermOption[];
  isLoadingTaxonomy: boolean;
  quickTaxonomyTerms: TaxonomyTermOption[];
  selectedTaxonomyIds: string[];
  onToggleTaxonomyId: (id: string) => void;
  taxonomyDialogOpen: boolean;
  onTaxonomyOpenChange: (next: boolean) => void;
  taxonomySearch: string;
  onTaxonomySearchChange: (value: string) => void;
  onClearTaxonomyFilters: () => void;
  groupedTaxonomyTerms: Record<string, TaxonomyTermOption[]>;
  visibleTaxonomyTermsCount: number;
  dimensionLabels: Record<string, string>;
  categoryGroupLabel?: string;
  showCategoryLabel?: boolean;
  showTagsLabel?: boolean;
  className?: string;
}

export function SeekerDiscoveryFilters({
  activeCategory,
  onCategoryClick,
  taxonomyError,
  taxonomyTerms,
  isLoadingTaxonomy,
  quickTaxonomyTerms,
  selectedTaxonomyIds,
  onToggleTaxonomyId,
  taxonomyDialogOpen,
  onTaxonomyOpenChange,
  taxonomySearch,
  onTaxonomySearchChange,
  onClearTaxonomyFilters,
  groupedTaxonomyTerms,
  visibleTaxonomyTermsCount,
  dimensionLabels,
  categoryGroupLabel = 'Quick category filters',
  showCategoryLabel = true,
  showTagsLabel = true,
  className = '',
}: SeekerDiscoveryFiltersProps) {
  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-2" role="group" aria-label={categoryGroupLabel}>
        {showCategoryLabel ? (
          <span className="text-xs font-medium text-gray-500">Categories:</span>
        ) : null}
        {QUICK_DISCOVERY_NEEDS.map((need) => {
          const selected = activeCategory === need.id;
          return (
            <button
              key={need.id}
              type="button"
              onClick={() => onCategoryClick(need.id)}
              className={`inline-flex min-h-[44px] flex-shrink-0 items-center justify-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                selected
                  ? 'border-action bg-action text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
              }`}
              aria-pressed={selected}
            >
              {need.label}
            </button>
          );
        })}
      </div>

      {(isLoadingTaxonomy || taxonomyError || taxonomyTerms.length > 0) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {showTagsLabel ? <span className="text-xs font-medium text-gray-500">Tags:</span> : null}

          {taxonomyError && taxonomyTerms.length === 0 ? (
            <span className="text-xs text-error-strong" role="status">Filters unavailable</span>
          ) : null}

          {!taxonomyError && !isLoadingTaxonomy && quickTaxonomyTerms.length > 0 ? (
            <div className="flex items-center gap-2 overflow-x-auto pb-1" role="group" aria-label="Top tags">
              {quickTaxonomyTerms.map((term) => {
                const selected = selectedTaxonomyIds.includes(term.id);
                return (
                  <button
                    key={term.id}
                    type="button"
                    onClick={() => onToggleTaxonomyId(term.id)}
                    className={`inline-flex min-h-[44px] flex-shrink-0 items-center justify-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                      selected
                        ? 'border-action bg-action text-white'
                        : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                    aria-pressed={selected}
                    title={typeof term.serviceCount === 'number' ? `${term.serviceCount} services` : undefined}
                  >
                    {term.term}
                  </button>
                );
              })}
            </div>
          ) : null}

          <Dialog open={taxonomyDialogOpen} onOpenChange={onTaxonomyOpenChange}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="text-xs">
                More filters{selectedTaxonomyIds.length > 0 ? ` (${selectedTaxonomyIds.length})` : ''}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Filter by service tags</DialogTitle>
                <DialogDescription>
                  Filters are based on stored taxonomy terms. You may need to confirm details with the provider.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    value={taxonomySearch}
                    onChange={(e) => onTaxonomySearchChange(e.target.value)}
                    type="search"
                    placeholder="Search tags…"
                    className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action"
                    aria-label="Search service tags"
                  />
                  {selectedTaxonomyIds.length > 0 ? (
                    <Button type="button" variant="outline" onClick={onClearTaxonomyFilters}>
                      Clear
                    </Button>
                  ) : null}
                </div>

                {taxonomyError ? (
                  <p className="text-sm text-error-strong" role="alert">{taxonomyError}</p>
                ) : null}

                {isLoadingTaxonomy ? (
                  <p className="text-sm text-gray-600">Loading tags…</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto rounded-lg border border-gray-200 p-3 space-y-4">
                    {visibleTaxonomyTermsCount === 0 ? (
                      <p className="p-2 text-sm text-gray-600">No matching tags.</p>
                    ) : null}

                    {Object.entries(groupedTaxonomyTerms).map(([dimension, terms]) => (
                      <div key={dimension}>
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {dimensionLabels[dimension] ?? dimension}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {terms.map((term) => {
                            const selected = selectedTaxonomyIds.includes(term.id);
                            return (
                              <Button
                                key={term.id}
                                type="button"
                                size="sm"
                                variant={selected ? 'secondary' : 'outline'}
                                onClick={() => onToggleTaxonomyId(term.id)}
                                title={term.description ?? undefined}
                                className="text-xs"
                              >
                                {term.term}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {selectedTaxonomyIds.length > 0 ? (
            <button
              type="button"
              onClick={onClearTaxonomyFilters}
              className="text-xs text-action-strong hover:underline"
            >
              Clear tags
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default SeekerDiscoveryFilters;
