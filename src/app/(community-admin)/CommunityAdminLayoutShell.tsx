/**
 * Community Admin Layout Shell — client component.
 *
 * Handles session auth-gating and nav rendering for the community admin portal.
 * noindex / title metadata is handled by the server layout.tsx.
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import {
  LayoutDashboard, ClipboardList, ShieldCheck, FileText, Globe2,
} from 'lucide-react';
import { isRoleAtLeast } from '@/services/auth/roles';
import { AccessDenied } from '@/components/ui/access-denied';
import { Skeleton } from '@/components/ui/skeleton';
import { AppFooter } from '@/components/footer';
import { PortalUserMenu } from '@/components/ui/portal-user-menu';
import CommunityAdminContextStrip from '@/components/community-admin/CommunityAdminContextStrip';

const NAV_ITEMS: { href: string; label: string; icon: React.ElementType }[] = [
  { href: '/dashboard',        label: 'Dashboard', icon: LayoutDashboard },
  { href: '/queue',            label: 'Queue',     icon: ClipboardList },
  { href: '/verify',           label: 'Verify',    icon: ShieldCheck },
  { href: '/community-forms',  label: 'Forms',     icon: FileText },
  { href: '/coverage',         label: 'Coverage',  icon: Globe2 },
];

export default function CommunityAdminLayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-[var(--bg-page)]" aria-busy="true" aria-label="Loading Community Admin portal">
        <div className="sticky top-0 z-[var(--z-nav)] h-14 border-b border-[var(--border)] bg-[var(--bg-surface)]" />
        <div className="container mx-auto max-w-7xl space-y-4 px-4 py-6">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </div>
    );
  }

  if (
    status === 'unauthenticated'
    || (status === 'authenticated' && session.user.accountStatus === 'frozen')
    || (status === 'authenticated' && !isRoleAtLeast(session.user.role, 'community_admin'))
  ) {
    return <AccessDenied portalName="Community Admin" requiredRole="community_admin" />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      {/* Skip-to-main-content: first focusable element for keyboard / screen-reader users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-sky-700 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
      >
        Skip to main content
      </a>
      <header aria-label="Community Admin portal" className="sticky top-0 z-[var(--z-nav)] border-b border-[var(--border)] bg-white/95 backdrop-blur">
        <div className="container mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/dashboard" className="shrink-0 text-2xl font-bold tracking-tight text-[var(--text-default,#111827)]">
              ORAN
            </Link>
            <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 md:inline-flex">
              Admin
            </span>
          </div>

          <div className="hidden flex-1 items-center justify-center md:flex">
            <nav className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-sm" aria-label="Community admin navigation">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`inline-flex min-h-[50px] items-center gap-2 rounded-full px-5 py-2.5 text-base transition-colors whitespace-nowrap ${
                    isActive(href)
                      ? 'border border-slate-200 bg-slate-50 font-semibold text-[var(--text-default,#111827)]'
                      : 'font-medium text-gray-500 hover:bg-[var(--bg-hover,#f9fafb)] hover:text-[var(--text-default,#111827)]'
                  }`}
                  aria-current={isActive(href) ? 'page' : undefined}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="hidden md:flex items-center">
            <PortalUserMenu />
          </div>

          <div className="md:hidden">
            <PortalUserMenu />
          </div>
        </div>

        {/* Mobile nav strip — scrollable bottom row, hidden on desktop */}
        <nav
          className="md:hidden border-t border-[var(--border)] overflow-x-auto scrollbar-none"
          aria-label="Community admin navigation"
        >
          <div className="flex items-center px-2">
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 px-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 ${
                  isActive(href)
                    ? 'border-slate-900 text-[var(--text-default,#111827)]'
                    : 'border-transparent text-gray-500 hover:text-[var(--text-default,#111827)]'
                }`}
                aria-current={isActive(href) ? 'page' : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </div>
        </nav>
      </header>

      <CommunityAdminContextStrip />

      <main id="main-content" className="container mx-auto max-w-7xl px-4 py-6">{children}</main>
      <AppFooter />
    </div>
  );
}
