/**
 * /verify — Server Component wrapper
 * Delegates rendering to VerifyPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import VerifyPageClient from './VerifyPageClient';

export const metadata: Metadata = {
  title: 'Verify Record',
  description: 'Review evidence and record verification decisions in the community admin portal.',
  robots: { index: false, follow: false },
};

export default function VerifyPage() {
  return <VerifyPageClient />;
}
