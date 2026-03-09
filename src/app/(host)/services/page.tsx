/**
 * /services — Server Component wrapper
 * Delegates rendering to ServicesPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import ServicesPageClient from './ServicesPageClient';

export const metadata: Metadata = {
  title: 'Services',
  description: 'Create, update, and archive organization services in the ORAN host portal.',
  robots: { index: false, follow: false },
};

export default function ServicesPage() {
  return <ServicesPageClient />;
}
