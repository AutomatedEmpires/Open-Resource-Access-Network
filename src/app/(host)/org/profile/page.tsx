/**
 * /org/profile — Server Component wrapper
 * Delegates rendering to OrgProfilePageClient.
 */
import type { Metadata } from 'next';
import OrgProfilePageClient from './OrgProfilePageClient';

export const metadata: Metadata = {
  title: 'Organization Profile',
  description: 'Build and maintain your public organization profile on ORAN.',
  robots: { index: false, follow: false },
};

export default function OrgProfilePage() {
  return <OrgProfilePageClient />;
}
