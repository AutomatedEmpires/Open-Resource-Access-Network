/**
 * /locations — Server Component wrapper
 * Delegates rendering to LocationsPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import LocationsPageClient from './LocationsPageClient';

export const metadata: Metadata = { title: 'Locations' };

export default function LocationsPage() {
  return <LocationsPageClient />;
}
