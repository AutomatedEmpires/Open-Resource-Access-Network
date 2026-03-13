import type { Metadata } from 'next';

import HostDashboardPageClient from './HostDashboardPageClient';

export const metadata: Metadata = {
  title: 'Host Dashboard',
  robots: { index: false, follow: false },
};

export default function HostDashboardPage() {
  return <HostDashboardPageClient />;
}
