/**
 * /rules — Server Component wrapper
 * Delegates rendering to RulesPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import RulesPageClient from './RulesPageClient';

export const metadata: Metadata = {
  title: 'System Rules',
  description: 'Manage platform rules, feature flags, and rollout percentages.',
  robots: { index: false, follow: false },
};

export default function RulesPage() {
  return <RulesPageClient />;
}
