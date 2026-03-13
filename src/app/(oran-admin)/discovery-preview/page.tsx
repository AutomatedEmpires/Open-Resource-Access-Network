import type { Metadata } from 'next';

import DiscoveryPreviewPageClient from './DiscoveryPreviewPageClient';

export const metadata: Metadata = { title: 'Discovery Preview', robots: { index: false, follow: false } };

export default function DiscoveryPreviewPage() {
  return <DiscoveryPreviewPageClient />;
}
