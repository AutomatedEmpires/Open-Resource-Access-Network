/**
 * Seeker Layout Shell
 *
 * Navigation chrome for all seeker-facing pages.
 *
 * Design system contracts:
 * - Active nav item: bg-blue-50 text-blue-700 (desktop) / text-blue-600 (mobile)
 * - Saved count badge: refreshes on every route transition
 * - All interactive elements meet min-h-[44px] / min-w-[44px] touch targets
 * - No admin or host links on public surfaces
 */

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, List, MapPin, Bookmark, User } from 'lucide-react';

// ============================================================
// CONSTANTS
// ============================================================

const SAVED_KEY = 'oran:saved-service-ids';

const NAV_ITEMS = [
  { href: '/chat',      label: 'Find',      icon: MessageCircle },
  { href: '/directory', label: 'Directory', icon: List },
  { href: '/map',       label: 'Map',       icon: MapPin },
  { href: '/saved',     label: 'Saved',     icon: Bookmark },
  { href: '/profile',   label: 'Profile',   icon: User },
] as const;

// ============================================================
// HELPERS
// ============================================================

function readSavedCount(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

// ============================================================
// LAYOUT
// ============================================================

export default function SeekerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Saved count badge — re-reads on every route change.
  // Same-tab real-time updates wired in Phase 7 via custom event.
  const [savedCount, setSavedCount] = useState(0);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSavedCount(readSavedCount());
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pathname]);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* ── Top bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="container mx-auto max-w-6xl flex items-center justify-between px-4 h-14">

          {/* Brand */}
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-gray-900 text-lg tracking-tight hover:text-blue-600 transition-colors"
          >
            ORAN
          </Link>

          {/* Desktop nav — hidden on mobile (bottom nav takes over) */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Primary navigation">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
              const active = isActive(href);
              const isSavedItem = href === '/saved';
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative flex items-center gap-1.5 px-3 py-2 rounded-md text-sm transition-colors min-h-[44px] ${
                    active
                      ? 'bg-blue-50 text-blue-700 font-semibold'
                      : 'font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                  {isSavedItem && savedCount > 0 && (
                    <span
                      className={`ml-0.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold min-w-[16px] h-4 px-1 leading-none ${
                        active ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                      aria-label={`${savedCount} saved`}
                    >
                      {savedCount > 99 ? '99+' : savedCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────── */}
      {/* pb-14 on mobile clears the fixed bottom nav (h-14 = 56px) */}
      <div id="main-content" className="flex-1 pb-14 md:pb-0">
        {children}
      </div>

      {/* ── Bottom nav (mobile only) ────────────────────── */}
      {/*
        safe-area-inset-bottom via inline style ensures the nav clears the iOS
        home indicator on iPhone X+ without losing the h-14 fixed height visual.
        We keep h-14 on the inner flex row so items stay consistently placed;
        the outer nav just grows downward into the safe area.
      */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white md:hidden"
        aria-label="Mobile navigation"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center h-14 w-full">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            const isSavedItem = href === '/saved';
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs font-medium transition-colors ${
                  active ? 'text-blue-600' : 'text-gray-400 hover:text-gray-600'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                {/* Active pill capsule behind icon */}
                <span className={`relative flex items-center justify-center rounded-full transition-colors ${
                  active ? 'bg-blue-50 px-3 py-1' : 'px-3 py-1'
                }`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {isSavedItem && savedCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 inline-flex items-center justify-center rounded-full bg-blue-600 text-white text-[9px] font-bold min-w-[14px] h-3.5 px-0.5 leading-none"
                      aria-hidden="true"
                    >
                      {savedCount > 99 ? '99+' : savedCount}
                    </span>
                  )}
                </span>
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
