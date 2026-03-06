/**
 * ORAN Admin Layout Shell — client component.
 *
 * Handles session auth-gating and nav rendering for the ORAN admin portal.
 * noindex / title metadata is handled by the server layout.tsx.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { isRoleAtLeast } from '@/services/auth/roles';
import { AccessDenied } from '@/components/ui/access-denied';
import { Skeleton } from '@/components/ui/skeleton';
import { AppFooter } from '@/components/footer';

const NAV_ITEMS = [
  { href: '/approvals', label: 'Approvals' },
  { href: '/appeals', label: 'Appeals' },
  { href: '/scopes', label: 'Scopes' },
  { href: '/rules', label: 'Rules' },
  { href: '/audit', label: 'Audit' },
  { href: '/zone-management', label: 'Zones' },
  { href: '/ingestion', label: 'Ingestion' },
  { href: '/templates', label: 'Templates' },
  { href: '/triage', label: 'Triage Queue' },
] as const;

export default function OranAdminLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50" aria-busy="true" aria-label="Loading ORAN Admin portal">
        <div className="sticky top-0 z-[var(--z-nav)] h-14 border-b border-gray-200 bg-white" />
        <div className="container mx-auto max-w-7xl space-y-4 px-4 py-6">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (status === 'authenticated' && !isRoleAtLeast(session.user.role, 'oran_admin')) {
    return <AccessDenied portalName="ORAN Admin" requiredRole="oran_admin" />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-[var(--z-nav)] border-b border-gray-200 bg-white">
        <div className="container mx-auto max-w-7xl flex items-center justify-between px-4 h-14">
          <Link href="/approvals" className="font-bold text-gray-900 tracking-tight">
            ORAN Admin
          </Link>

          <nav className="flex items-center gap-1 overflow-x-auto" aria-label="ORAN admin navigation">
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
      <AppFooter />
    </div>
  );
}
