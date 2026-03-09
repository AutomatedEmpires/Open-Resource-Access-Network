import type { Metadata } from 'next';

import HostFormsPageClient from './HostFormsPageClient';

export const metadata: Metadata = {
  title: 'Managed Forms',
  description: 'Start, save, and submit managed forms in the ORAN host portal.',
  robots: { index: false, follow: false },
};

export default function HostFormsPage() {
  return <HostFormsPageClient />;
}
