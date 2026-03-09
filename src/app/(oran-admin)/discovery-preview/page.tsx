import type { Metadata } from 'next';

import DiscoveryPreviewPageClient from './DiscoveryPreviewPageClient';

export const metadata: Metadata = { title: 'Discovery Preview' };

export default function DiscoveryPreviewPage() {
  return <DiscoveryPreviewPageClient />;
}
