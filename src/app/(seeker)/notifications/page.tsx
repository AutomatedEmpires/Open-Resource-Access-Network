/**
 * Notifications Inbox — Server Component wrapper.
 * Auth-gated: redirects to sign-in if not authenticated.
 */
import type { Metadata } from 'next';
import NotificationsPageClient from './NotificationsPageClient';

export const metadata: Metadata = {
  title: 'Notifications',
  description: 'View and manage your ORAN notifications.',
  robots: { index: false, follow: false },
};

export default function NotificationsPage() {
  return <NotificationsPageClient />;
}
