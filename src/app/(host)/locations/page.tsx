/**
 * /locations — Server Component wrapper
 * Delegates rendering to LocationsPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import LocationsPageClient from './LocationsPageClient';

export const metadata: Metadata = {
  title: 'Locations',
  description: 'Create, edit, and remove organization locations in the ORAN host portal.',
  robots: { index: false, follow: false },
};

export default function LocationsPage() {
  return <LocationsPageClient />;
}
