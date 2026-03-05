/**
 * /ingestion — Server Component wrapper
 * Delegates rendering to IngestionPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import IngestionPageClient from './IngestionPageClient';

export const metadata: Metadata = { title: 'Ingestion' };

export default function IngestionPage() {
  return <IngestionPageClient />;
}
