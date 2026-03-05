/**
 * /org — Organization Dashboard — Server Component wrapper
 * Delegates rendering to OrgPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import OrgPageClient from './OrgPageClient';

export const metadata: Metadata = { title: 'Organizations' };

export default function OrgPage() {
  return <OrgPageClient />;
}
