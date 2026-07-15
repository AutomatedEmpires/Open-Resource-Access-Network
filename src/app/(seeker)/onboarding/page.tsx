import type { Metadata } from 'next';

import OnboardingPageClient from './OnboardingPageClient';

export const metadata: Metadata = {
  title: 'Find the right help',
  description: 'Tell ORAN what you need, what area to search, and which optional details should shape your resource matches.',
  robots: { index: false, follow: false },
};

export default function OnboardingPage() {
  return <OnboardingPageClient />;
}
