import type { Metadata } from 'next';

import OperationsPageClient from './OperationsPageClient';

export const metadata: Metadata = {
  title: 'Operations',
  description: 'ORAN-wide operator summary for active governance, trust, and safety work.',
};

export default function OperationsPage() {
  return <OperationsPageClient />;
}
