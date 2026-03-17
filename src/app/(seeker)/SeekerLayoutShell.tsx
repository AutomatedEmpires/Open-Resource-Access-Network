'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { MessageCircle, Bookmark, User, ListTodo, LayoutDashboard } from 'lucide-react';

import AppNav from '@/components/nav/AppNav';
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

const DASHBOARD_NAV_ITEM = { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard } as const;
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

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

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

      <nav
        className="fixed bottom-0 inset-x-0 z-[var(--z-nav)] border-t border-slate-200/80 bg-white/95 backdrop-blur md:hidden"
        aria-label="Mobile navigation"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center h-14 w-full">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            const isSavedItem = href === '/saved';
            return (
              <Link
                key={href}
                href={href}
                className={`relative flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-[10px] sm:text-xs font-medium transition-colors overflow-hidden ${
                  active ? 'text-action-base' : 'text-slate-400 hover:text-slate-700'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                <span className={`relative flex items-center justify-center rounded-full transition-colors ${
                  active ? 'bg-info-subtle px-3 py-1' : 'px-3 py-1'
                }`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  {isSavedItem && savedCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 inline-flex items-center justify-center rounded-full bg-slate-900 text-white text-[9px] font-bold min-w-[14px] h-3.5 px-0.5 leading-none"
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
    </SeekerFeatureFlagsProvider>
  );
}

export default SeekerLayoutShell;
