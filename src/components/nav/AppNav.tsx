/**
 * ORAN Global Navigation
 *
 * Persistent top navigation bar shown on all pages.
 * Route-aware active state, role-adaptive links, accessible.
 */

'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageCircle, List, MapPin, Bookmark, User,
  Menu, X, Flag,
} from 'lucide-react';
import { NotificationBell } from './NotificationBell';

// ============================================================
// NAV ITEMS
// ============================================================

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  /** If set, only show when current path starts with one of these prefixes */
  showPrefixes?: string[];
}

const SEEKER_NAV: NavItem[] = [
  { href: '/chat',      label: 'Chat',      icon: MessageCircle },
  { href: '/directory', label: 'Directory',  icon: List },
  { href: '/map',       label: 'Map',        icon: MapPin },
  { href: '/saved',     label: 'Saved',      icon: Bookmark },
  { href: '/report',    label: 'Report',     icon: Flag },
  { href: '/profile',   label: 'Profile',    icon: User },
];

// ============================================================
// COMPONENT
// ============================================================

export function AppNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  return (
    <nav className="border-b border-gray-200 bg-white" aria-label="Main navigation">
      <div className="container mx-auto max-w-6xl flex items-center justify-between px-4 h-14">
        {/* Brand */}
        <Link
          href="/"
          className="font-bold text-lg tracking-tight text-gray-900 hover:text-blue-600 transition-colors"
        >
          ORAN
        </Link>

        {/* Desktop nav */}
        <div className="hidden sm:flex items-center gap-1">
          {SEEKER_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium transition-colors min-h-[44px] ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
          <NotificationBell />
        </div>

        {/* Notification bell (mobile) + Mobile menu toggle */}
        <div className="flex items-center gap-1 sm:hidden">
          <NotificationBell />
          <button
            type="button"
            className="p-2 rounded-md hover:bg-gray-100 min-w-[44px] min-h-[44px] flex items-center justify-center"
            onClick={() => setMobileOpen((v) => !v)}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
          >
            {mobileOpen
              ? <X className="h-5 w-5 text-gray-700" aria-hidden="true" />
              : <Menu className="h-5 w-5 text-gray-700" aria-hidden="true" />}
          </button>
        </div>

      </div>

      {/* Mobile nav */}
      {mobileOpen && (
        <div id="mobile-nav" className="sm:hidden border-t border-gray-100 bg-white px-4 pb-3 pt-1">
          {SEEKER_NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-medium transition-colors min-h-[44px] ${
                  active
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}

export default AppNav;
