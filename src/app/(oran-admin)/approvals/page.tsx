/**
 * /approvals — Server Component wrapper
 * Delegates rendering to ApprovalsPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import ApprovalsPageClient from './ApprovalsPageClient';

export const metadata: Metadata = { title: 'Claim Approvals' };

export default function ApprovalsPage() {
  return <ApprovalsPageClient />;
}
