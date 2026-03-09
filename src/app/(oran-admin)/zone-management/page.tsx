/**
 * /zone-management — Server Component wrapper
 * Delegates rendering to ZoneManagementPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import ZoneManagementPageClient from './ZoneManagementPageClient';

export const metadata: Metadata = {
  title: 'Zone Management',
  description: 'Create, assign, update, and remove coverage zones for review operations.',
  robots: { index: false, follow: false },
};

export default function ZoneManagementPage() {
  return <ZoneManagementPageClient />;
}
