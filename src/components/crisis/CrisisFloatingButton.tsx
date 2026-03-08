/**
 * CrisisFloatingButton
 *
 * Persistent floating action button rendered on every page (via root layout).
 * Positioned bottom-right so it never obscures primary content.
 * Opens the shared CrisisModal via CrisisContext — zero duplicate modal DOM.
 *
 * Safety contract: this component must never be removed without an equivalent
 * always-visible entry point to CrisisModal being added elsewhere.
 */

'use client';

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCrisisModal } from './CrisisContext';

export function CrisisFloatingButton() {
  const { openCrisis } = useCrisisModal();

  return (
    <button
      type="button"
      onClick={openCrisis}
      // bottom offset includes env(safe-area-inset-bottom) for notched iPhones
      style={{ bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
      className={cn(
        // Positioning — sits above nav, below modal overlay
        'fixed right-6 z-[var(--z-fab)]',
        // Shape & size — pill, min 44 px touch target (WCAG 2.5.5)
        'inline-flex items-center gap-2 rounded-full',
        'min-h-[44px] px-4 py-2.5',
        // Color — white base, red accent; noticeable but not alarming
        'border border-red-200 bg-white text-red-700',
        // Elevation — shadow signals floating layer
        'shadow-md',
        // Motion
        'transition-all duration-150 hover:bg-red-50 hover:shadow-lg',
        // Focus ring — a11y
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2',
        // Typography
        'text-sm font-semibold select-none',
      )}
      aria-haspopup="dialog"
      aria-label="Open crisis resources and emergency hotlines"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      {/* Label always visible — users in crisis must not hunt for text */}
      <span>Crisis Help</span>
    </button>
  );
}
