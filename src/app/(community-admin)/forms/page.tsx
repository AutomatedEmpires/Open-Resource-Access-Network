import type { Metadata } from 'next';

import CommunityFormsPageClient from './CommunityFormsPageClient';

export const metadata: Metadata = {
  title: 'Managed Forms',
  description: 'Review submission-backed managed forms in the community admin portal.',
  robots: { index: false, follow: false },
};

export default function CommunityFormsPage() {
  return <CommunityFormsPageClient />;
}
