import type { Metadata } from 'next';
import AppealsPageClient from './AppealsPageClient';

export const metadata: Metadata = {
  title: 'Appeal Review',
  description: 'Review appeals and decide whether denied submissions should be reopened.',
  robots: { index: false, follow: false },
};

export default function AppealsPage() {
  return <AppealsPageClient />;
}


