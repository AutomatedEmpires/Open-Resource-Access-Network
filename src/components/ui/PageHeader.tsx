/**
 * PageHeader — Seeker page heading shell
 *
 * Visual contract for every seeker-facing page:
 *   - Single `h1` with standardized size / weight / tracking
 *   - Optional `icon` rendered inline-left of the title text (trust / context signal)
 *   - Optional subtitle (ReactNode rendered in a `<div>`, not `<p>`, so block
 *     children such as links wrapped in spans, or multiple lines, are valid HTML)
 *   - Optional right-aligned actions slot (buttons, toggles, counts, etc.)
 *
 * Width and padding live on the enclosing `<main>` — PageHeader never sets max-width.
 *
 * Usage:
 *   <PageHeader
 *     icon={<Bookmark className="h-6 w-6 text-blue-600" aria-hidden="true" />}
 *     title="Saved Services"
 *     subtitle="Bookmarks are stored on your device."
 *     actions={<ClearButton />}
 *   />
 */

import React from 'react';

type PageHeaderBadgeTone = 'neutral' | 'accent' | 'trust';

interface PageHeaderBadgeProps {
  children: React.ReactNode;
  tone?: PageHeaderBadgeTone;
}

const PAGE_HEADER_BADGE_STYLES: Record<PageHeaderBadgeTone, string> = {
  neutral: 'border-slate-200 bg-white/90 text-slate-600',
  accent: 'border-sky-100 bg-sky-50 text-sky-700',
  trust: 'border-emerald-100 bg-emerald-50 text-emerald-700',
};

// ============================================================
// TYPES
// ============================================================

export interface PageHeaderProps {
  /** Small contextual label rendered above the page title */
  eyebrow?: React.ReactNode;
  /** Primary page title — becomes the accessible h1 text */
  title: string;
  /**
   * Optional icon rendered as a flex sibling left of the title text.
   * Pass a sized, aria-hidden Lucide icon (or similar).
   * Example: <User className="h-6 w-6 text-blue-600" aria-hidden="true" />
   */
  icon?: React.ReactNode;
  /**
   * Supporting copy rendered below the h1.
   * Uses a <div> (not <p>) so nested block elements are valid HTML.
   */
  subtitle?: React.ReactNode;
  /** Optional chips or metadata rendered below the subtitle */
  badges?: React.ReactNode;
  /** Right-aligned action slot — buttons, toggles, etc. */
  actions?: React.ReactNode;
  /** Additional className on the outer wrapper */
  className?: string;
}

export function PageHeaderBadge({ children, tone = 'neutral' }: PageHeaderBadgeProps) {
  return (
    <span
      className={`inline-flex min-h-[28px] items-center rounded-full border px-2.5 py-1 text-xs font-medium ${PAGE_HEADER_BADGE_STYLES[tone]}`}
    >
      {children}
    </span>
  );
}

// ============================================================
// COMPONENT
// ============================================================

export function PageHeader({ eyebrow, title, icon, subtitle, badges, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`mb-4 sm:mb-6 ${className}`}>
      {/* On mobile: stacked column. On sm+: side-by-side with actions right-aligned */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">

        {/* Left: icon + title + subtitle + badges */}
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              {eyebrow}
            </div>
          )}
          <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-slate-950 leading-tight sm:text-2xl md:text-[2rem]">
            {icon && (
              <span className="flex-shrink-0 text-sky-600" aria-hidden="true">
                {icon}
              </span>
            )}
            {title}
          </h1>

          {/* div not p — accepts any ReactNode incl. inline links and multi-line content */}
          {subtitle && (
            <div className="mt-1.5 text-sm text-slate-600 leading-relaxed md:text-[15px]">
              {subtitle}
            </div>
          )}

          {badges && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {badges}
            </div>
          )}
        </div>

        {/* Right: optional actions — scrollable on very small screens, right-aligned on sm+ */}
        {actions && (
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2 sm:mt-0.5">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
