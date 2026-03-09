/**
 * /submit-resource — Server Component wrapper
 * Delegates rendering to SubmitResourcePageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import SubmitResourcePageClient from './SubmitResourcePageClient';

export const metadata: Metadata = {
  title: 'Submit a Resource',
  description: 'Suggest a new community resource for inclusion in the ORAN directory.',
};

export default function SubmitResourcePage() {
  return <SubmitResourcePageClient />;
}
