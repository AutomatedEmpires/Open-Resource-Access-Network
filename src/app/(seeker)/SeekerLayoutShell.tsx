'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

import AppNav from '@/components/nav/AppNav';
import { ScopedMobileNav, SEEKER_MOBILE_NAV_ITEMS } from '@/components/nav/ScopedMobileNav';
import { SeekerFeatureFlagsProvider } from '@/components/seeker/SeekerFeatureFlags';

const CommandPalette = dynamic(
  () => import('@/components/command/CommandPalette').then((module) => module.CommandPalette),
  { ssr: false },
);

const AppFooter = dynamic(
  () => import('@/components/footer').then((module) => module.AppFooter),
  { ssr: false },
);

const SeekerContextStrip = dynamic(
  () => import('@/components/seeker/SeekerContextStrip').then((module) => module.SeekerContextStrip),
  { ssr: false },
);

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
  const isImmersiveDiscoveryRoute = pathname === '/chat' || pathname === '/map';
  const hideFooter = isImmersiveDiscoveryRoute || pathname === '/directory';

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

      <div className="sr-only focus-within:not-sr-only focus-within:fixed focus-within:left-4 focus-within:top-20 focus-within:z-[9999]">
        <button
          type="button"
          onClick={() => setCommandPaletteOpen(true)}
          aria-label="Open quick actions"
          className="rounded-md bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-lg outline-none ring-2 ring-slate-500"
        >
          Open quick actions
        </button>
      </div>

      <AppNav />

      <SeekerContextStrip pathname={pathname} />

      <main id="main-content" className={`flex-1 animate-[page-enter_var(--transition-standard)_both] ${isImmersiveDiscoveryRoute ? '' : 'pb-14 md:pb-0'}`}>
        {children}
      </main>

      {!hideFooter ? (
        <div className="pb-14 md:pb-0">
          <AppFooter />
        </div>
      ) : null}

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
