/**
 * Community Admin Layout — server component.
 *
 * Exports metadata (noindex for authenticated portal) and wraps
 * the client shell that handles session auth-gating and navigation.
 */

import type { Metadata } from 'next';
import CommunityAdminLayoutShell from './CommunityAdminLayoutShell';

export const metadata: Metadata = {
  title: {
    default: 'ORAN Community Admin',
    template: '%s — ORAN Community Admin',
  },
  robots: { index: false, follow: false },
};

export default function CommunityAdminLayout({ children }: { children: React.ReactNode }) {
  return <CommunityAdminLayoutShell>{children}</CommunityAdminLayoutShell>;
}
