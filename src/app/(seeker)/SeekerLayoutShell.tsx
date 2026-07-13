'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { MessageCircle, Bookmark, User, ListTodo, LayoutDashboard } from 'lucide-react';

import AppNav from '@/components/nav/AppNav';
import { ScopedMobileNav } from '@/components/nav/ScopedMobileNav';
import { CommandPalette } from '@/components/command/CommandPalette';
import { AppFooter } from '@/components/footer';
import { SeekerFeatureFlagsProvider } from '@/components/seeker/SeekerFeatureFlags';
import { SeekerContextStrip } from '@/components/seeker/SeekerContextStrip';
import {
  readStoredSavedServiceCount,
  SAVED_SERVICES_UPDATED_EVENT,
} from '@/services/saved/client';

const BASE_NAV_ITEMS = [
  { href: '/chat', label: 'Chat', icon: MessageCircle },
  { href: '/profile', label: 'Profile', icon: User },
  { href: '/saved', label: 'Saved', icon: Bookmark },
] as const;

const DASHBOARD_NAV_ITEM = { href: '/plan/dashboard', label: 'Dashboard', icon: LayoutDashboard } as const;
const PLAN_NAV_ITEM = { href: '/plan', label: 'Plan', icon: ListTodo } as const;

export function SeekerLayoutShell({
  children,
  planEnabled,
  reminderEnabled = false,
  dashboardEnabled = false,
}: {
  children: React.ReactNode;
  planEnabled: boolean;
  reminderEnabled?: boolean;
  dashboardEnabled?: boolean;
}) {
  const pathname = usePathname();

  const [savedCount, setSavedCount] = useState(0);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const navItems = planEnabled
    ? [
        BASE_NAV_ITEMS[0],
        ...(dashboardEnabled ? [DASHBOARD_NAV_ITEM] : []),
        PLAN_NAV_ITEM,
        BASE_NAV_ITEMS[1],
        BASE_NAV_ITEMS[2],
      ]
    : BASE_NAV_ITEMS;

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

  return (
    <SeekerFeatureFlagsProvider value={{ planEnabled, reminderEnabled, dashboardEnabled }}>
      <div className="flex min-h-screen flex-col bg-white text-[var(--text-primary)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-900 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-slate-500"
      >
        Skip to main content
      </a>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      <div className="sr-only" aria-hidden="false">
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Open quick actions"
        >
          Open quick actions
        </button>
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Open quick actions"
        >
          Open quick actions
        </button>
      </div>

      <AppNav />

      <SeekerContextStrip pathname={pathname} />

      <main id="main-content" className="flex-1 pb-14 md:pb-0 animate-[page-enter_var(--transition-standard)_both]">
        {children}
      </main>

      <div className="pb-14 md:pb-0">
        <AppFooter />
      </div>

      <ScopedMobileNav
        scopeLabel="Seeker"
        pathname={pathname}
        items={navItems.map((item) => ({
          ...item,
          badge: item.href === '/saved' && savedCount > 0
            ? (savedCount > 99 ? '99+' : savedCount)
            : undefined,
        }))}
      />
      </div>
    </SeekerFeatureFlagsProvider>
  );
}

export default SeekerLayoutShell;
