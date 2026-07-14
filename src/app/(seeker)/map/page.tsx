/**
 * Map Page — Server Component wrapper
 * Exports per-page metadata; delegates rendering to MapPageClient.
 * noindex: dynamic, location-based content not suitable for indexing.
 */
import type { Metadata } from 'next';
import MapPageContent from './MapPageClient';

export const metadata: Metadata = {
  title: 'Map',
  description:
    'View publication-gated resources on an interactive map. Find food, housing, healthcare, and more near your location.',
  robots: { index: false, follow: false },
  openGraph: {
    title: 'Map | ORAN',
    description: 'View publication-gated resources near your location on an interactive map.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Map | ORAN',
    description: 'View publication-gated resources near your location on an interactive map.',
  },
};

export default function MapPage() {
  return <MapPageContent />;
}
