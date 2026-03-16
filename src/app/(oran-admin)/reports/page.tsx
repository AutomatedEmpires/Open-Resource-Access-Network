import type { Metadata } from 'next';

import ReportsPageClient from './ReportsPageClient';

export const metadata: Metadata = {
  title: 'Trust And Safety Reports',
  description: 'Review community reports and apply safety holds when high-risk issues are confirmed.',
};

export default function ReportsPage() {
  return <ReportsPageClient />;
}
