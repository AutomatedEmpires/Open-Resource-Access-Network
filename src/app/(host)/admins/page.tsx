/**
 * /admins — Server Component wrapper
 * Delegates rendering to AdminsPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import AdminsPageClient from './AdminsPageClient';

export const metadata: Metadata = {
  title: 'Team Management',
  description: 'Manage organization members, roles, and invitations in the ORAN host portal.',
  robots: { index: false, follow: false },
};

export default function AdminsPage() {
  return <AdminsPageClient />;
}
