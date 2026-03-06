import type { Metadata } from 'next';
import TriagePageClient from './TriagePageClient';

export const metadata: Metadata = {
  title: 'Triage Queue — ORAN Admin',
  robots: { index: false, follow: false },
};

export default function TriagePage() {
  return <TriagePageClient />;
}
