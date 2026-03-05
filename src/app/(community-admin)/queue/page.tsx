/**
 * /queue — Server Component wrapper
 * Delegates rendering to QueuePageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import QueuePageClient from './QueuePageClient';

export const metadata: Metadata = { title: 'Verification Queue' };

export default function QueuePage() {
  return <QueuePageClient />;
}
