/**
 * /rules — Server Component wrapper
 * Delegates rendering to RulesPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import RulesPageClient from './RulesPageClient';

export const metadata: Metadata = { title: 'System Rules' };

export default function RulesPage() {
  return <RulesPageClient />;
}
