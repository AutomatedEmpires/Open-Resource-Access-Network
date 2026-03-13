/**
 * /audit — Server Component wrapper
 * Delegates rendering to AuditPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import AuditPageClient from './AuditPageClient';

export const metadata: Metadata = { title: 'Audit Log', robots: { index: false, follow: false } };

export default function AuditPage() {
  return <AuditPageClient />;
}
