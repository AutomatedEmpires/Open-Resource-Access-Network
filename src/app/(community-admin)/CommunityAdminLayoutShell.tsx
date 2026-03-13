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
import { isRoleAtLeast } from '@/services/auth/roles';
import { AccessDenied } from '@/components/ui/access-denied';
import { Skeleton } from '@/components/ui/skeleton';
import { AppFooter } from '@/components/footer';
import { PortalUserMenu } from '@/components/ui/portal-user-menu';
import CommunityAdminContextStrip from '@/components/community-admin/CommunityAdminContextStrip';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/queue',            label: 'Queue' },
  { href: '/verify',           label: 'Verify' },
  { href: '/community-forms',  label: 'Forms' },
  { href: '/coverage',         label: 'Coverage' },
] as const;

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

  if (status === 'unauthenticated' || (status === 'authenticated' && !isRoleAtLeast(session.user.role, 'community_admin'))) {
    return <AccessDenied portalName="Community Admin" requiredRole="community_admin" />;
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)]">
      <header className="sticky top-0 z-[var(--z-nav)] border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="container mx-auto max-w-7xl flex items-center justify-between px-4 h-14">
          <Link href="/dashboard" className="font-bold text-[var(--text-default,#111827)] tracking-tight">
            ORAN Community Admin
          </Link>

          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Community admin navigation">
              {NAV_ITEMS.map(({ href, label }) => (
                <Link
                  key={href}
                  href={href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive(href)
                      ? 'bg-[var(--bg-active,#f3f4f6)] text-[var(--text-default,#111827)]'
                      : 'text-gray-500 hover:text-[var(--text-default,#111827)] hover:bg-[var(--bg-hover,#f9fafb)]'
                  }`}
                  aria-current={isActive(href) ? 'page' : undefined}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <PortalUserMenu />
          </div>
        </div>
      </header>

      <CommunityAdminContextStrip />

      <main id="main-content" className="container mx-auto max-w-7xl px-4 py-6">{children}</main>
      <AppFooter />
    </div>
  );
}
