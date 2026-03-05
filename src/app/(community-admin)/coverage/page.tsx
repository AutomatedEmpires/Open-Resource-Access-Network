/**
 * /coverage — Server Component wrapper
 * Delegates rendering to CoveragePageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import CoveragePageClient from './CoveragePageClient';

export const metadata: Metadata = { title: 'Coverage Zone' };

export default function CoveragePage() {
  return <CoveragePageClient />;
}
