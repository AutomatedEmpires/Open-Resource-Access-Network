/**
 * Saved Services Page — Server Component wrapper
 * noindex: private user-specific page.
 */
import type { Metadata } from 'next';
import SavedPageContent from './SavedPageClient';

export const metadata: Metadata = {
  title: 'Saved Services',
  description: 'View and manage your saved service listings.',
  robots: { index: false, follow: false },
};

export default function SavedPage() {
  return <SavedPageContent />;
}
