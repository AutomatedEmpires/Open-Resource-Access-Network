import type { Metadata } from 'next';

import SecurityPageClient from './SecurityPageClient';

export const metadata: Metadata = {
  title: 'Account Security',
  description: 'Freeze, restore, and review privileged ORAN account access.',
};

export default function SecurityPage() {
  return <SecurityPageClient />;
}
