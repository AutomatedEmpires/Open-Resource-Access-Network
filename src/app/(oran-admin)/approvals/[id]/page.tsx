/**
 * /approvals/[id] — Server Component wrapper
 * Delegates rendering to ApprovalReviewPageClient; exports per-page title.
 */
import type { Metadata } from 'next';
import ApprovalReviewPageClient from './ApprovalReviewPageClient';

export const metadata: Metadata = {
  title: 'Review Approval',
  description: 'Review, approve, or reject a pending ORAN resource submission.',
  robots: { index: false, follow: false },
};

export default async function ApprovalReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ApprovalReviewPageClient id={id} />;
}
