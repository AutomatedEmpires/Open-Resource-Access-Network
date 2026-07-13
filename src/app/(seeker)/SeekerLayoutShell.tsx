'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import AppNav from '@/components/nav/AppNav';
import { ScopedMobileNav, SEEKER_MOBILE_NAV_ITEMS } from '@/components/nav/ScopedMobileNav';
import { CommandPalette } from '@/components/command/CommandPalette';
import { AppFooter } from '@/components/footer';
import { SeekerFeatureFlagsProvider } from '@/components/seeker/SeekerFeatureFlags';
import { SeekerContextStrip } from '@/components/seeker/SeekerContextStrip';

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

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

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
        items={SEEKER_MOBILE_NAV_ITEMS}
      />
      </div>
    </SeekerFeatureFlagsProvider>
  );
}

export default SeekerLayoutShell;
