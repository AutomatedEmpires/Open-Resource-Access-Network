/**
 * Submit a Resource — Server Component wrapper
 * Delegates rendering to SubmitResourcePageClient; exports per-page title.
 * noindex: form submission page; prevents search-engine form spam.
 */
import type { Metadata } from 'next';
import SubmitResourcePageClient from './SubmitResourcePageClient';

export const metadata: Metadata = {
  title: 'Submit a Resource',
  description: 'Suggest a new community resource for inclusion in the ORAN directory.',
  robots: { index: false, follow: false },
};

export default function SubmitResourcePage() {
  return <SubmitResourcePageClient />;
}
