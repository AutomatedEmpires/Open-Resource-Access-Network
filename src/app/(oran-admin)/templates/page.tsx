/**
 * /templates — Server Component wrapper
 */
import type { Metadata } from 'next';
import TemplatesPageClient from './TemplatesPageClient';

export const metadata: Metadata = { title: 'Content Templates' };

export default function TemplatesPage() {
  return <TemplatesPageClient />;
}
