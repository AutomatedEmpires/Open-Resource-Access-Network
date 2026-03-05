import type { Metadata } from 'next';
import AppealsPageClient from './AppealsPageClient';

export const metadata: Metadata = { title: 'Appeal Review' };

export default function AppealsPage() {
  return <AppealsPageClient />;
}


