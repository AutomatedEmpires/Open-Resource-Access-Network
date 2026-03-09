/**
 * CoTagSuggestionPanel
 *
 * Shown inside the taxonomy card of ResourceSubmissionWorkspace.
 * When a host selects categories (via CategoryPicker), this panel surfaces
 * contextually relevant SERVICE_ATTRIBUTES_TAXONOMY tags as one-click chips.
 *
 * Tags are added to `customTerms` on click.
 * Already-added tags are shown as dimmed (not removed from the panel).
 */

'use client';

import React, { useMemo } from 'react';
import { Sparkles, Plus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCoTagSuggestions } from '@/services/tags/coTagSuggestions';

interface CoTagSuggestionPanelProps {
  /** Currently selected PRESET_CATEGORY ids */
  selectedCategories: string[];
  /** Current custom terms already on the draft */
  customTerms: string[];
  /** Called with the full updated customTerms array */
  onAddTag: (updatedTerms: string[]) => void;
  readOnly?: boolean;
  className?: string;
}

export function CoTagSuggestionPanel({
  selectedCategories,
  customTerms,
  onAddTag,
  readOnly = false,
  className,
}: CoTagSuggestionPanelProps) {
  const suggestions = useMemo(
    () => getCoTagSuggestions(selectedCategories, []),
    [selectedCategories],
  );

  if (selectedCategories.length === 0 || suggestions.length === 0) return null;

  const handleAdd = (tag: string) => {
    if (readOnly) return;
    if (customTerms.includes(tag)) return;
    onAddTag([...customTerms, tag]);
  };

  // Group by dimension for readable layout
  const byDimension: Record<string, typeof suggestions> = {};
  for (const s of suggestions) {
    if (!byDimension[s.dimension]) byDimension[s.dimension] = [];
    byDimension[s.dimension].push(s);
  }

  const dimensionCount = Object.keys(byDimension).length;

  return (
    <div
      className={cn(
        'rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-4',
        className,
      )}
      role="region"
      aria-label="Suggested attribute tags"
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-500" aria-hidden="true" />
        <p className="text-sm font-medium text-blue-800">
          Suggested tags for your{' '}
          {selectedCategories.length === 1 ? 'category' : `${selectedCategories.length} categories`}
        </p>
        <span className="ml-auto text-xs text-blue-500">
          {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''} across{' '}
          {dimensionCount} dimension{dimensionCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Chips grouped by dimension */}
      <div className="space-y-3">
        {Object.entries(byDimension).map(([dimension, tags]) => (
          <div key={dimension}>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-blue-600/70">
              {dimension}
            </p>
            <div className="flex flex-wrap gap-2">
              {tags.map(({ tag, label, reason }) => {
                const alreadyAdded = customTerms.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    disabled={readOnly || alreadyAdded}
                    title={reason}
                    onClick={() => handleAdd(tag)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
                      'border transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1',
                      alreadyAdded
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 cursor-default'
                        : readOnly
                          ? 'border-blue-100 bg-white text-blue-500 cursor-default opacity-60'
                          : 'border-blue-200 bg-white text-blue-700 hover:border-blue-400 hover:bg-blue-50 hover:shadow-sm active:scale-95',
                    )}
                    aria-label={alreadyAdded ? `${label} — already added` : `Add tag: ${label}`}
                    aria-pressed={alreadyAdded}
                  >
                    {alreadyAdded ? (
                      <Check className="h-3 w-3 flex-shrink-0 text-emerald-500" aria-hidden="true" />
                    ) : (
                      <Plus className="h-3 w-3 flex-shrink-0 text-blue-400" aria-hidden="true" />
                    )}
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {!readOnly && (
        <p className="mt-3 text-xs text-blue-500/80">
          Click any chip to add it to your custom terms. Tags help seekers and algorithms find your service.
        </p>
      )}
    </div>
  );
}
