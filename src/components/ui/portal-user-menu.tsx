/**
 * PortalUserMenu
 *
 * Shared header component used by every authenticated portal
 * (ORAN Admin, Host, Community Admin).
 *
 * Shows the signed-in user's initials, display name (truncated),
 * and a "Sign out" button that calls NextAuth's signOut() to
 * cleanly clear the session client-side and redirect to the homepage.
 *
 * Usage:
 *   import { PortalUserMenu } from '@/components/ui/portal-user-menu';
 *   // add to the right side of your portal header
 *   <PortalUserMenu />
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { LogOut, User, HelpCircle } from 'lucide-react';

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? '';
    const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
    return (first + last).toUpperCase();
  }
  if (email) return email[0]?.toUpperCase() ?? '?';
  return '?';
}

// Human-readable role label used in the tooltip / aria-label
const ROLE_LABELS: Record<string, string> = {
  oran_admin: 'ORAN Admin',
  community_admin: 'Community Admin',
  host_member: 'Host Member',
  host_admin: 'Host Admin',
  seeker: 'Seeker',
};

// ──────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────
export function PortalUserMenu() {
  const { data: session, status } = useSession();

  // Don't render until session is resolved
  if (status === 'loading') {
    return (
      <div
        className="h-7 w-24 animate-pulse rounded-md bg-gray-100"
        aria-hidden="true"
      />
    );
  }

  if (!session?.user) return null;

  const { name, email } = session.user;
  const role = (session.user as { role?: string }).role ?? '';
  const initials = getInitials(name, email);
  const displayName = name ?? email ?? 'User';
  const roleLabel = ROLE_LABELS[role] ?? role;

  return (
    <div className="flex items-center gap-2 ml-2">
      {/* Avatar + name — hidden on very small screens to keep header tidy */}
      <div
        className="hidden sm:flex items-center gap-2 text-sm"
        aria-hidden="true"     /* decorative; name is in the sign-out aria-label */
      >
        <span
          className="inline-flex items-center justify-center h-7 w-7 rounded-full bg-teal-100 text-teal-700 text-xs font-bold select-none"
          title={displayName}
        >
          {initials}
        </span>
        <span className="max-w-36 truncate font-medium text-gray-700">
          {displayName}
        </span>
        {roleLabel && (
          <span className="hidden md:inline-block text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">
            {roleLabel}
          </span>
        )}
      </div>

      {/* Profile + Help + Sign-out */}
      <Link
        href="/profile"
        className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-action min-h-[36px]"
        aria-label={`My profile (${displayName})`}
        title="My profile"
      >
        <User className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span className="hidden sm:inline">Profile</span>
      </Link>

      <Link
        href="/about"
        className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-action min-h-[36px]"
        aria-label="Help and documentation"
        title="Help & Docs"
      >
        <HelpCircle className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span className="hidden sm:inline">Help</span>
      </Link>

      {/* Sign-out button */}
      <button
        type="button"
        onClick={() => void signOut({ callbackUrl: '/' })}
        className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 min-h-[36px]"
        aria-label={`Sign out (signed in as ${displayName})`}
        title="Sign out"
      >
        <LogOut className="h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span className="hidden sm:inline">Sign out</span>
      </button>
    </div>
  );
}
