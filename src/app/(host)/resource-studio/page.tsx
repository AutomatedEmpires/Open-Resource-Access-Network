/**
 * /resource-studio — Server Component wrapper
 * Delegates rendering to ResourceStudioPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import ResourceStudioPageClient from './ResourceStudioPageClient';

export const metadata: Metadata = {
  title: 'Resource Studio',
  description: 'Build, preview, and submit ORAN resource records for approval.',
  robots: { index: false, follow: false },
};

export default function ResourceStudioPage() {
  return <ResourceStudioPageClient />;
}
