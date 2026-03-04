/**
 * Community Admin Layout Shell
 *
 * Minimal navigation chrome for verification workflows.
 * Per ADR-0002: vertical shells prevent role/nav leakage.
 */

'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { isRoleAtLeast } from '@/services/auth/guards';
import { AccessDenied } from '@/components/ui/access-denied';
import { Skeleton } from '@/components/ui/skeleton';

const NAV_ITEMS = [
  { href: '/queue', label: 'Queue' },
  { href: '/verify', label: 'Verify' },
  { href: '/coverage', label: 'Coverage' },
] as const;

export default function CommunityAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  // Set page title based on active nav item
  useEffect(() => {
    const active = NAV_ITEMS.find(({ href }) => pathname === href || pathname.startsWith(href + '/'));
    document.title = active ? `${active.label} — ORAN Community Admin` : 'ORAN Community Admin';
  }, [pathname]);

  // Authenticated portals must not be indexed by search engines
  useEffect(() => {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'robots';
      document.head.appendChild(meta);
    }
    meta.content = 'noindex, nofollow';
  }, []);

  // While the session is resolving, show a structural loading placeholder.
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50" aria-busy="true" aria-label="Loading Community Admin portal">
        <div className="sticky top-0 z-40 h-14 border-b border-gray-200 bg-white" />
        <div className="container mx-auto max-w-7xl space-y-4 px-4 py-6">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  // Belt-and-suspenders UI gate: middleware enforces server-side; this catches
  // authenticated sessions whose role is below the minimum for this portal.
  if (status === 'authenticated' && !isRoleAtLeast(session.user.role, 'community_admin')) {
    return <AccessDenied portalName="Community Admin" requiredRole="community_admin" />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Skip to main content — keyboard / screen-reader affordance */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-blue-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-md focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>

      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="container mx-auto max-w-7xl flex items-center justify-between px-4 h-14">
          <Link href="/queue" className="font-bold text-gray-900 tracking-tight">
            ORAN Community Admin
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Community admin navigation">
            {NAV_ITEMS.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  isActive(href)
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                }`}
                aria-current={isActive(href) ? 'page' : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main id="main-content" className="container mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
