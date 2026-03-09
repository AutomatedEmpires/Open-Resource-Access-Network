/**
 * /approvals — Server Component wrapper
 * Delegates rendering to ApprovalsPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import ApprovalsPageClient from './ApprovalsPageClient';

export const metadata: Metadata = {
  title: 'Claim Approvals',
  description: 'Approve or deny organization claims and promote verified host access.',
  robots: { index: false, follow: false },
};

export default function ApprovalsPage() {
  return <ApprovalsPageClient />;
}
