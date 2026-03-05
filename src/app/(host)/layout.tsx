/**
 * Host Layout — server component.
 *
 * Exports metadata (noindex for authenticated portal) and wraps
 * the client shell that handles session auth-gating and navigation.
 */

import type { Metadata } from 'next';
import HostLayoutShell from './HostLayoutShell';

export const metadata: Metadata = {
  title: {
    default: 'ORAN Host',
    template: '%s — ORAN Host',
  },
  robots: { index: false, follow: false },
};

export default function HostLayout({ children }: { children: React.ReactNode }) {
  return <HostLayoutShell>{children}</HostLayoutShell>;
}
