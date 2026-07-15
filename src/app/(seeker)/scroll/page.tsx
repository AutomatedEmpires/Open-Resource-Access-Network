import type { Metadata } from 'next';

import ScrollPageClient from './ScrollPageClient';

export const metadata: Metadata = {
  title: 'Resource Feed',
  description:
    'Scroll a personalized feed of publication-gated government, nonprofit, and community services—not retailer directories.',
  alternates: { canonical: '/scroll' },
};

export default function ScrollPage() {
  return <ScrollPageClient />;
}
