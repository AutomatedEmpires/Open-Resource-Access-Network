/**
 * Appeal a Denied Submission — Server Component wrapper
 * noindex: private submission page.
 */
import type { Metadata } from 'next';
import AppealPageContent from './AppealPageClient';

export const metadata: Metadata = {
  title: 'Appeal a Decision',
  description: 'Appeal a denied submission for reconsideration.',
  robots: { index: false, follow: false },
};

export default function AppealPage() {
  return <AppealPageContent />;
}
