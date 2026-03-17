/**
 * AllTagsBrowser
 *
 * Collapsible panel that exposes the complete SERVICE_ATTRIBUTES_TAXONOMY
 * to form users — all 75+ labels across 6 dimensions (Delivery, Cost,
 * Access, Culture, Population, Situation).
 *
 * Tags are added directly to `customTerms`. Already-added tags appear
 * checked rather than being hidden. Supports free-text search/filter.
 *
 * Placement: taxonomy card in ResourceSubmissionWorkspace, below CoTagSuggestionPanel.
 */

'use client';

import React, { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Plus, Search, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAllServiceAttributeTags } from '@/services/tags/coTagSuggestions';

interface AllTagsBrowserProps {
  customTerms: string[];
  onAddTag: (updatedTerms: string[]) => void;
  readOnly?: boolean;
  className?: string;
}

const DIMENSION_ORDER = ['Delivery', 'Cost', 'Access', 'Culture', 'Population', 'Situation'];

export function AllTagsBrowser({
  customTerms,
  onAddTag,
  readOnly = false,
  className,
}: AllTagsBrowserProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const allTags = useMemo(() => getAllServiceAttributeTags(), []);

  const byDimension = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map: Record<string, typeof allTags> = {};
    for (const t of allTags) {
      if (
        q &&
        !t.label.toLowerCase().includes(q) &&
        !t.tag.toLowerCase().includes(q) &&
        !t.dimension.toLowerCase().includes(q)
      ) {
        continue;
      }
      if (!map[t.dimension]) map[t.dimension] = [];
      map[t.dimension].push(t);
    }
    return map;
  }, [allTags, search]);

  const sortedDimensions = DIMENSION_ORDER.filter((d) => byDimension[d]?.length);
  const addedCount = customTerms.filter((t) => allTags.some((a) => a.tag === t)).length;

  const handleAdd = (tag: string) => {
    if (readOnly || customTerms.includes(tag)) return;
    onAddTag([...customTerms, tag]);
  };

  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left transition-colors hover:bg-slate-50"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Tag className="h-4 w-4 text-slate-500" aria-hidden="true" />
          <span className="text-sm font-medium text-slate-800">Browse all attribute labels</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {allTags.length} labels · 6 dimensions
          </span>
          {addedCount > 0 && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700">
              {addedCount} added
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div className="border-t border-slate-200 px-4 pb-4 pt-3">
          <div className="relative mb-4">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter labels by keyword…"
              className="w-full rounded-xl border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:border-blue-500"
              aria-label="Filter attribute labels"
            />
          </div>

          {sortedDimensions.length === 0 ? (
            <p className="text-sm text-slate-500">No labels match your filter.</p>
          ) : (
            <div className="space-y-4">
              {sortedDimensions.map((dimension) => (
                <div key={dimension}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {dimension}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {byDimension[dimension].map(({ tag, label }) => {
                      const added = customTerms.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          disabled={readOnly || added}
                          onClick={() => handleAdd(tag)}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                            'focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-1',
                            added
                              ? 'cursor-default border-emerald-200 bg-emerald-50 text-emerald-700'
                              : readOnly
                                ? 'cursor-default border-slate-100 bg-white text-slate-400 opacity-60'
                                : 'cursor-pointer border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 active:scale-95',
                          )}
                          aria-pressed={added}
                          aria-label={added ? `${label} — already added` : `Add label: ${label}`}
                          title={tag}
                        >
                          {added ? (
                            <Check
                              className="h-3 w-3 shrink-0 text-emerald-500"
                              aria-hidden="true"
                            />
                          ) : (
                            <Plus
                              className="h-3 w-3 shrink-0 text-slate-400"
                              aria-hidden="true"
                            />
                          )}
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!readOnly && (
            <p className="mt-4 text-xs text-slate-400">
              Click any label to add it to custom terms. Labels help seekers and the ORAN matching
              engine find this resource. Hover a chip to see its canonical tag ID.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
