/**
 * Map Page — Server Component wrapper
 * Exports per-page metadata; delegates rendering to MapPageClient.
 * noindex: dynamic, location-based content not suitable for indexing.
 */
import type { Metadata } from 'next';
import MapPageContent from './MapPageClient';

export const metadata: Metadata = {
  title: 'Service Map',
  description:
    'View verified services on an interactive map. Find food banks, shelters, healthcare, and more near your location.',
  robots: { index: false, follow: false },
};

export default function MapPage() {
  return <MapPageContent />;
}
