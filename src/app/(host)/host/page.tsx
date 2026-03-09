import type { Metadata } from 'next';

import HostDashboardPageClient from './HostDashboardPageClient';

export const metadata: Metadata = {
  title: 'Host Dashboard',
};

export default function HostDashboardPage() {
  return <HostDashboardPageClient />;
}
