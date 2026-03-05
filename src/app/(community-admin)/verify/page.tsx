/**
 * /verify — Server Component wrapper
 * Delegates rendering to VerifyPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import VerifyPageClient from './VerifyPageClient';

export const metadata: Metadata = { title: 'Verify Record' };

export default function VerifyPage() {
  return <VerifyPageClient />;
}
