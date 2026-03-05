/**
 * Report a Service Listing — Server Component wrapper
 * noindex: user-generated content submission page.
 */
import type { Metadata } from 'next';
import ReportPageContent from './ReportPageClient';

export const metadata: Metadata = {
  title: 'Report a Listing',
  description: 'Report incorrect, closed, or suspicious service listing information.',
  robots: { index: false, follow: false },
};

export default function ReportPage() {
  return <ReportPageContent />;
}
