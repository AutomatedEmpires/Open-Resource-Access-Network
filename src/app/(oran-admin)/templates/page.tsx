/**
 * /templates — Server Component wrapper
 */
import type { Metadata } from 'next';
import TemplatesPageClient from './TemplatesPageClient';

export const metadata: Metadata = {
  title: 'Content Templates',
  description: 'Create and manage reusable content templates for ORAN operational teams.',
  robots: { index: false, follow: false },
};

export default function TemplatesPage() {
  return <TemplatesPageClient />;
}
