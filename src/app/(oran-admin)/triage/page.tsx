import type { Metadata } from 'next';
import TriagePageClient from './TriagePageClient';

export const metadata: Metadata = {
  title: 'Triage Queue — ORAN Admin',
  description: 'Review scoring queues and rerun submission triage priorities.',
  robots: { index: false, follow: false },
};

export default function TriagePage() {
  return <TriagePageClient />;
}
