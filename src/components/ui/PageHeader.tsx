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

// ============================================================
// TYPES
// ============================================================

export interface PageHeaderProps {
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
  /** Right-aligned action slot — buttons, toggles, etc. */
  actions?: React.ReactNode;
  /** Additional className on the outer wrapper */
  className?: string;
}

// ============================================================
// COMPONENT
// ============================================================

export function PageHeader({ title, icon, subtitle, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-4 mb-6 ${className}`}>

      {/* Left: icon + title + subtitle */}
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight text-gray-900 leading-tight">
          {icon && (
            <span className="flex-shrink-0 text-blue-600" aria-hidden="true">
              {icon}
            </span>
          )}
          {title}
        </h1>

        {/* div not p — accepts any ReactNode incl. inline links and multi-line content */}
        {subtitle && (
          <div className="mt-1.5 text-sm text-gray-500 leading-relaxed">
            {subtitle}
          </div>
        )}
      </div>

      {/* Right: optional actions */}
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
          {actions}
        </div>
      )}
    </div>
  );
}

export default PageHeader;
