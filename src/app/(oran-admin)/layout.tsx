/**
 * ORAN Admin Layout — server component.
 *
 * Exports metadata (noindex for authenticated portal) and wraps
 * the client shell that handles session auth-gating and navigation.
 */

import type { Metadata } from 'next';
import OranAdminLayoutShell from './OranAdminLayoutShell';

export const metadata: Metadata = {
  title: {
    default: 'ORAN Admin',
    template: '%s — ORAN Admin',
  },
  robots: { index: false, follow: false },
};

export default function OranAdminLayout({ children }: { children: React.ReactNode }) {
  return <OranAdminLayoutShell>{children}</OranAdminLayoutShell>;
}
