/**
 * /zone-management — Server Component wrapper
 * Delegates rendering to ZoneManagementPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import ZoneManagementPageClient from './ZoneManagementPageClient';

export const metadata: Metadata = { title: 'Zone Management' };

export default function ZoneManagementPage() {
  return <ZoneManagementPageClient />;
}
