import type { Metadata } from 'next';

import CandidateReviewsPageClient from './CandidateReviewsPageClient';

export const metadata: Metadata = {
  title: 'Candidate Reviews',
  description: 'Claim and complete assigned resource candidate reviews.',
  robots: { index: false, follow: false },
};

export default function CandidateReviewsPage() {
  return <CandidateReviewsPageClient />;
}
