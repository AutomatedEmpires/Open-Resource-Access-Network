/**
 * /admins — Server Component wrapper
 * Delegates rendering to AdminsPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import AdminsPageClient from './AdminsPageClient';

export const metadata: Metadata = { title: 'Team' };

export default function AdminsPage() {
  return <AdminsPageClient />;
}
