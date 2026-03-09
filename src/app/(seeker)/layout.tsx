/**
 * Seeker Layout Shell
 *
 * Navigation chrome for all seeker-facing pages.
 *
 * Design system contracts:
 * - Active nav item: bg-info-subtle text-action-strong (desktop) / text-action-base (mobile)
 * - Saved count badge: refreshes on every route transition
 * - All interactive elements meet min-h-[44px] / min-w-[44px] touch targets
 * - No admin or host links on public surfaces
 */

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, List, MapPin, Bookmark, User } from 'lucide-react';
import { CommandPalette } from '@/components/command/CommandPalette';
import { AppFooter } from '@/components/footer';
import { SeekerContextStrip } from '@/components/seeker/SeekerContextStrip';
import {
  readStoredSavedServiceCount,
  SAVED_SERVICES_UPDATED_EVENT,
} from '@/services/saved/client';

const NAV_ITEMS = [
  { href: '/chat',      label: 'Find',      icon: MessageCircle },
  { href: '/directory', label: 'Directory', icon: List },
  { href: '/map',       label: 'Map',       icon: MapPin },
  { href: '/saved',     label: 'Saved',     icon: Bookmark },
  { href: '/profile',   label: 'Profile',   icon: User },
] as const;

// ============================================================
// LAYOUT
// ============================================================

export default function SeekerLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [savedCount, setSavedCount] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // ⌘K / Ctrl+K opens the command palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSavedCount(readStoredSavedServiceCount());
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pathname]);

  useEffect(() => {
    const refreshSavedCount = () => {
      setSavedCount(readStoredSavedServiceCount());
    };

    refreshSavedCount();
    window.addEventListener('storage', refreshSavedCount);
    window.addEventListener(SAVED_SERVICES_UPDATED_EVENT, refreshSavedCount as EventListener);

    return () => {
      window.removeEventListener('storage', refreshSavedCount);
      window.removeEventListener(SAVED_SERVICES_UPDATED_EVENT, refreshSavedCount as EventListener);
    };
  }, []);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + '/');

  return (
      <div className="flex flex-col min-h-screen bg-[var(--bg-page)]">
      {/* Command palette — opens on ⌘K / Ctrl+K */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* ── Top bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-[var(--z-nav)] border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="container mx-auto max-w-6xl flex items-center justify-between px-4 h-14">

          {/* Brand */}
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 font-bold text-gray-900 text-lg tracking-tight hover:text-action-base transition-colors"
            >
              ORAN
            </Link>
            <span className="hidden rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-blue-700 md:inline-flex">
              Verified records only
            </span>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="inline-flex min-h-10 items-center rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
              aria-label="Open quick actions"
            >
              Quick actions
            </button>

            {/* Desktop nav — hidden on mobile (bottom nav takes over) */}
            <nav className="flex items-center gap-1" aria-label="Primary navigation">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const active = isActive(href);
                const isSavedItem = href === '/saved';
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`relative flex items-center gap-1.5 px-3 py-2 rounded-md text-sm transition-colors min-h-[44px] ${
                      active
                        ? 'bg-info-subtle text-action-strong font-semibold'
                        : 'font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {label}
                    {isSavedItem && savedCount > 0 && (
                      <span
                        className={`ml-0.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold min-w-[16px] h-4 px-1 leading-none ${
                          active ? 'bg-action-base text-white' : 'bg-gray-200 text-gray-700'
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
        </div>
      </header>

      <SeekerContextStrip pathname={pathname} />

      {/* ── Main content ────────────────────────────────── */}
      {/* pb-14 on mobile clears the fixed bottom nav (h-14 = 56px) */}
      <div id="main-content" className="flex-1 pb-14 md:pb-0 animate-[page-enter_var(--transition-standard)_both]">
        {children}
      </div>

      {/* Footer — extra bottom padding on mobile keeps it above the fixed nav */}
      <div className="pb-14 md:pb-0">
        <AppFooter />
      </div>

      {/* ── Bottom nav (mobile only) ────────────────────── */}
      {/*
        safe-area-inset-bottom via inline style ensures the nav clears the iOS
        home indicator on iPhone X+ without losing the h-14 fixed height visual.
        We keep h-14 on the inner flex row so items stay consistently placed;
        the outer nav just grows downward into the safe area.
      */}
      <nav
        className="fixed bottom-0 inset-x-0 z-[var(--z-nav)] border-t border-[var(--border)] bg-[var(--bg-surface)] md:hidden"
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
                  active ? 'text-action-base' : 'text-gray-400 hover:text-gray-600'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                {/* Active pill capsule behind icon */}
                <span className={`relative flex items-center justify-center rounded-full transition-colors ${
                  active ? 'bg-info-subtle px-3 py-1' : 'px-3 py-1'
                }`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {isSavedItem && savedCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 inline-flex items-center justify-center rounded-full bg-action-base text-white text-[9px] font-bold min-w-[14px] h-3.5 px-0.5 leading-none"
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
