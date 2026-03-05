/**
 * /audit — Server Component wrapper
 * Delegates rendering to AuditPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import AuditPageClient from './AuditPageClient';

export const metadata: Metadata = { title: 'Audit Log' };

export default function AuditPage() {
  return <AuditPageClient />;
}
