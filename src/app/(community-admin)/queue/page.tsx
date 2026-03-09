/**
 * /queue — Server Component wrapper
 * Delegates rendering to QueuePageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import QueuePageClient from './QueuePageClient';

export const metadata: Metadata = {
  title: 'Verification Queue',
  description: 'Review, claim, and batch-handle pending verification work in the community admin portal.',
  robots: { index: false, follow: false },
};

export default function QueuePage() {
  return <QueuePageClient />;
}
