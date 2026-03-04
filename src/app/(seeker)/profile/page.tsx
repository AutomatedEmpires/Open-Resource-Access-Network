/**
 * Profile Page — Server Component wrapper
 * noindex: private user-specific page.
 */
import type { Metadata } from 'next';
import ProfilePageContent from './ProfilePageClient';

export const metadata: Metadata = {
  title: 'My Profile',
  description: 'Manage your ORAN preferences — approximate location, language, and saved services.',
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return <ProfilePageContent />;
}
