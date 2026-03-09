import type { Metadata } from 'next';
import InvitationsPageClient from './InvitationsPageClient';

export const metadata: Metadata = {
  title: 'Organization Invitations',
  description: 'Accept or decline pending invitations to join an ORAN organization workspace.',
  robots: { index: false, follow: false },
};

export default function InvitationsPage() {
  return <InvitationsPageClient />;
}
