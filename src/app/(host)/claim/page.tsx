/**
 * /claim — Server Component wrapper
 * Delegates rendering to ClaimPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import ClaimPageClient from './ClaimPageClient';

export const metadata: Metadata = { title: 'Claim Organization' };

export default function ClaimPage() {
  return <ClaimPageClient />;
}
