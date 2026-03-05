/**
 * /services — Server Component wrapper
 * Delegates rendering to ServicesPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import ServicesPageClient from './ServicesPageClient';

export const metadata: Metadata = { title: 'Services' };

export default function ServicesPage() {
  return <ServicesPageClient />;
}
