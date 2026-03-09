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
      <div className="flex min-h-screen flex-col bg-gradient-to-b from-orange-50 via-rose-50/70 to-emerald-50/80 text-[var(--text-primary)]">
      {/* Command palette — opens on ⌘K / Ctrl+K */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* ── Top bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-[var(--z-nav)] border-b border-orange-100/80 bg-white/90 backdrop-blur">
        <div className="container mx-auto max-w-6xl flex items-center justify-between px-4 h-14">

          {/* Brand */}
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 text-lg font-bold tracking-tight text-stone-900 transition-colors hover:text-action-base"
            >
              ORAN
            </Link>
            <span className="hidden rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest text-emerald-700 md:inline-flex">
              Verified records only
            </span>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <button
              type="button"
              onClick={() => setCommandPaletteOpen(true)}
              className="inline-flex min-h-10 items-center rounded-full border border-orange-100 bg-white px-3 py-2 text-sm font-medium text-stone-600 transition-colors hover:bg-orange-50 hover:text-stone-900"
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
                    className={`relative flex min-h-[44px] items-center gap-1.5 rounded-full px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'bg-info-subtle text-action-strong font-semibold shadow-sm'
                        : 'font-medium text-stone-600 hover:bg-orange-50 hover:text-stone-900'
                    }`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {label}
                    {isSavedItem && savedCount > 0 && (
                      <span
                        className={`ml-0.5 inline-flex items-center justify-center rounded-full text-[10px] font-bold min-w-[16px] h-4 px-1 leading-none ${
                          active ? 'bg-action-base text-white' : 'bg-orange-100 text-stone-700'
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
        className="fixed bottom-0 inset-x-0 z-[var(--z-nav)] border-t border-orange-100/80 bg-white/95 backdrop-blur md:hidden"
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
                  active ? 'text-action-base' : 'text-stone-400 hover:text-stone-600'
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
