/**
 * Seeker Layout Shell
 *
 * Provides the navigation chrome for all seeker pages:
 * - Top bar: ORAN name, sign-in placeholder
 * - Bottom nav (mobile): Find · Directory · Map
 * - Desktop: nav items in top bar
 *
 * Per docs/UI_UX_CONTRACT.md §3.3:
 * - Bottom nav on mobile with word labels (not icon-only)
 * - Active destination clearly indicated
 * - Minimal top bar for identity/trust
 * - No admin links on public surfaces
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, List, MapPin, User } from 'lucide-react';

// ============================================================
// NAV ITEMS
// ============================================================

const NAV_ITEMS = [
  { href: '/chat', label: 'Find', icon: MessageCircle },
  { href: '/directory', label: 'Directory', icon: List },
  { href: '/map', label: 'Map', icon: MapPin },
] as const;

// ============================================================
// LAYOUT
// ============================================================

export default function SeekerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      {/* Skip to main content — keyboard / screen-reader affordance */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      {/* ── Top bar ─────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="container mx-auto max-w-6xl flex items-center justify-between px-4 h-14">
          {/* Brand */}
          <Link
            href="/"
            className="flex items-center gap-2 font-bold text-gray-900 text-lg tracking-tight"
          >
            ORAN
          </Link>

          {/* Desktop nav (hidden on mobile — bottom nav used instead) */}
          <nav
            className="hidden md:flex items-center gap-1"
            aria-label="Primary"
          >
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive(href)
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
                aria-current={isActive(href) ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </nav>

          {/* Account area */}
          <div className="flex items-center gap-2">
            <Link
              href="/auth/signin"
              className="flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors min-w-[44px] min-h-[44px] px-2 py-2 rounded-md hover:bg-gray-50"
              aria-label="Sign in with Microsoft"
            >
              <User className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Sign in</span>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────── */}
      {/* pb-16 on mobile to clear the fixed bottom nav */}
      <div id="main-content" className="flex-1 pb-16 md:pb-0">
        {children}
      </div>

      {/* ── Bottom nav (mobile only) ────────────────────── */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 border-t border-gray-200 bg-white md:hidden"
        aria-label="Mobile navigation"
      >
        <div className="flex items-center justify-around h-14 max-w-md mx-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs font-medium transition-colors ${
                isActive(href)
                  ? 'text-blue-600'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
              aria-current={isActive(href) ? 'page' : undefined}
            >
              <Icon
                className={`h-5 w-5 ${isActive(href) ? 'text-blue-600' : ''}`}
                aria-hidden="true"
              />
              {label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
