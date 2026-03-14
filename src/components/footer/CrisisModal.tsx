/**
 * Crisis Resources Modal
 *
 * Full-screen on mobile, large centered panel on desktop.
 * Category-filterable, searchable grid of verified national crisis hotlines.
 *
 * Safety contract: emergency resources always rendered first (data order).
 * The emergency quick-access strip (911 / 988 / 211) is always visible
 * regardless of active filter or search state.
 */

'use client';

import React, { useState, useMemo } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, Phone, MessageSquare, AlertTriangle, Globe, ExternalLink, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  CRISIS_RESOURCES,
  CRISIS_CATEGORY_LABELS,
  CRISIS_CATEGORY_COLORS,
  type CrisisCategory,
  type CrisisResource,
} from './crisisData';

// ============================================================
// RESOURCE CARD
// ============================================================

function buildTelHref(phone: string): string {
  // 3-digit numbers (911, 988, 211) and short codes use bare format
  if (phone.length <= 6) return `tel:${phone}`;
  // 10/11-digit US numbers
  return `tel:+${phone}`;
}

function ResourceCard({ resource }: { resource: CrisisResource }) {
  const colors = CRISIS_CATEGORY_COLORS[resource.category];
  const isEmergency = resource.phone === '911';

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-xl border p-4 bg-white transition-all hover:shadow-md',
        resource.featured ? 'border-2' : 'border',
        colors.border,
      )}
    >
      {/* Category badge + website link */}
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            'inline-block w-fit text-xs font-medium px-2 py-0.5 rounded-full',
            colors.bg,
            colors.text,
          )}
        >
          {CRISIS_CATEGORY_LABELS[resource.category]}
        </span>
        {resource.website && (
          <a
            href={resource.website}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label={`Visit ${resource.name} website (opens in new tab)`}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>

      {/* Name */}
      <h3 className="text-sm font-semibold text-gray-900 leading-snug">
        {resource.name}
      </h3>

      {/* Description */}
      <p className="text-xs text-gray-500 leading-relaxed flex-1">
        {resource.description}
      </p>

      {/* Language / accessibility tags */}
      {resource.languages && resource.languages.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {resource.languages.map((lang) => (
            <span
              key={lang}
              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600"
            >
              <Globe className="h-2.5 w-2.5 text-gray-400" aria-hidden="true" />
              {lang}
            </span>
          ))}
        </div>
      )}

      {/* Contact actions */}
      <div className="flex flex-wrap gap-2 pt-0.5">
        {resource.textOnly ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm font-bold text-gray-900">
            <MessageSquare className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
            {resource.phoneDisplay}
          </span>
        ) : (
          <a
            href={buildTelHref(resource.phone)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-bold transition-colors min-h-[40px]',
              isEmergency
                ? 'bg-red-600 text-white border border-red-700 hover:bg-red-700'
                : 'bg-green-600 text-white border border-green-700 hover:bg-green-700',
            )}
            aria-label={`Call ${resource.name}: ${resource.phoneDisplay}`}
          >
            <Phone className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            {resource.phoneDisplay}
          </a>
        )}

        {resource.textOption && (
          <span className="inline-flex items-center gap-1 rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-500">
            <MessageSquare className="h-3 w-3" aria-hidden="true" />
            {resource.textOption}
          </span>
        )}

        {resource.chatAvailable && (
          <span className="inline-flex items-center gap-1 rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-xs text-gray-500">
            <Globe className="h-3 w-3" aria-hidden="true" />
            Chat available
          </span>
        )}
      </div>

      {/* Availability */}
      <p className="text-[11px] text-gray-400 mt-0.5">{resource.available}</p>
    </div>
  );
}

// ============================================================
// CATEGORY FILTER CHIPS
// ============================================================

const ALL_FILTER = '__all__' as const;
type FilterValue = CrisisCategory | typeof ALL_FILTER;

// ============================================================
// MODAL
// ============================================================

interface CrisisModalProps {
  open: boolean;
  onClose: () => void;
}

export function CrisisModal({ open, onClose }: CrisisModalProps) {
  const [activeFilter, setActiveFilter] = useState<FilterValue>(ALL_FILTER);
  const [search, setSearch] = useState('');

  // Preserve the order categories appear in data (emergency first)
  const orderedCategories = useMemo<CrisisCategory[]>(() => {
    const seen = new Set<CrisisCategory>();
    const out: CrisisCategory[] = [];
    for (const r of CRISIS_RESOURCES) {
      if (!seen.has(r.category)) {
        seen.add(r.category);
        out.push(r.category);
      }
    }
    return out;
  }, []);

  // Count per category for filter chip badges
  const categoryCounts = useMemo(() => {
    const counts: Partial<Record<CrisisCategory, number>> = {};
    for (const r of CRISIS_RESOURCES) {
      counts[r.category] = (counts[r.category] ?? 0) + 1;
    }
    return counts;
  }, []);

  // Combined search + category filter
  const filtered = useMemo(() => {
    const byCategory =
      activeFilter === ALL_FILTER
        ? CRISIS_RESOURCES
        : CRISIS_RESOURCES.filter((r) => r.category === activeFilter);

    const q = search.trim().toLowerCase();
    if (!q) return byCategory;

    return byCategory.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.phoneDisplay.toLowerCase().includes(q),
    );
  }, [activeFilter, search]);

  function handleOpenChange(next: boolean) {
    if (!next) {
      onClose();
      setSearch('');
      setActiveFilter(ALL_FILTER);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        {/* Overlay */}
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[var(--z-modal)] bg-black/60',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          )}
        />

        {/* Panel */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            // Mobile: full screen
            'fixed inset-0 z-[var(--z-modal)] flex flex-col bg-[var(--bg-surface)]',
            // Desktop: centered large panel
            'md:inset-auto md:left-1/2 md:top-1/2',
            'md:-translate-x-1/2 md:-translate-y-1/2',
            'md:w-full md:max-w-4xl md:max-h-[90vh]',
            'md:rounded-xl md:shadow-2xl',
            // Animation
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          )}
        >
          {/* ── Header ─────────────────────────────────── */}
          <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-gray-100 bg-red-50 px-4 py-4 md:rounded-t-xl">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
                <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden="true" />
              </div>
              <div>
                <DialogPrimitive.Title className="text-base font-bold text-gray-900 leading-tight">
                  Crisis Resources
                </DialogPrimitive.Title>
                <p className="text-xs text-gray-500 mt-0.5">
                  {CRISIS_RESOURCES.length} verified national hotlines — available 24/7 and free
                </p>
              </div>
            </div>

            <DialogPrimitive.Close
              onClick={onClose}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              aria-label="Close crisis resources"
            >
              <X className="h-5 w-5 text-gray-600" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          {/* ── Search ─────────────────────────────────── */}
          <div className="flex-shrink-0 border-b border-gray-100 px-4 py-2.5">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                aria-hidden="true"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search resources by name, description, or phone…"
                className={cn(
                  'w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-4 text-sm text-gray-900 placeholder:text-gray-400',
                  'focus:border-red-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-red-200',
                )}
                aria-label="Search crisis resources"
              />
            </div>
          </div>

          {/* ── Category filter chips ───────────────────── */}
          <div
            className="flex flex-shrink-0 gap-2 overflow-x-auto border-b border-gray-100 px-4 py-3"
            role="group"
            aria-label="Filter by category"
          >
            <button
              type="button"
              onClick={() => setActiveFilter(ALL_FILTER)}
              aria-pressed={activeFilter === ALL_FILTER}
              className={cn(
                'flex-shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap',
                activeFilter === ALL_FILTER
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              All ({CRISIS_RESOURCES.length})
            </button>

            {orderedCategories.map((cat) => {
              const colors = CRISIS_CATEGORY_COLORS[cat];
              const isActive = activeFilter === cat;
              const count = categoryCounts[cat] ?? 0;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveFilter(cat)}
                  aria-pressed={isActive}
                  className={cn(
                    'flex-shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap',
                    isActive
                      ? cn(colors.bg, colors.text, colors.border)
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
                  )}
                >
                  {CRISIS_CATEGORY_LABELS[cat]} ({count})
                </button>
              );
            })}
          </div>

          {/* ── Scrollable resource grid ────────────────── */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* Always-visible emergency quick-access strip */}
            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-red-700">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                Immediate emergency:
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href="tel:911"
                  className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-red-700 transition-colors"
                  aria-label="Call 911 for emergencies"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  911
                </a>
                <a
                  href="tel:988"
                  className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-purple-700 transition-colors"
                  aria-label="Call or text 988 for mental health crisis"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  988 Crisis
                </a>
                <a
                  href="tel:211"
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-blue-700 transition-colors"
                  aria-label="Call 211 for community services"
                >
                  <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                  211 Help
                </a>
              </div>
            </div>

            {/* Result count + empty state */}
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <Search className="h-8 w-8 text-gray-300" aria-hidden="true" />
                <p className="text-sm font-medium text-gray-500">No resources found</p>
                <p className="text-xs text-gray-400">Try a different search term or category</p>
                <button
                  type="button"
                  onClick={() => { setSearch(''); setActiveFilter(ALL_FILTER); }}
                  className="mt-2 text-xs font-medium text-red-600 underline hover:text-red-800"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <>
                {(search || activeFilter !== ALL_FILTER) && (
                  <p className="mb-3 text-xs text-gray-400">
                    Showing {filtered.length} resource{filtered.length !== 1 ? 's' : ''}
                    {activeFilter !== ALL_FILTER && ` in ${CRISIS_CATEGORY_LABELS[activeFilter]}`}
                    {search && ` matching "${search}"`}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((resource: CrisisResource) => (
                    <ResourceCard key={resource.id} resource={resource} />
                  ))}
                </div>
              </>
            )}

            {/* Footer note */}
            <p className="mt-8 pb-2 text-center text-xs text-gray-400">
              If you are in immediate danger, call{' '}
              <a
                href="tel:911"
                className="font-bold text-gray-600 underline hover:text-gray-900"
              >
                911
              </a>{' '}
              now. This list covers major national hotlines — search our{' '}
              <a
                href="/directory"
                onClick={onClose}
                className="underline hover:text-gray-600"
              >
                service directory
              </a>{' '}
              for local resources near you.
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
