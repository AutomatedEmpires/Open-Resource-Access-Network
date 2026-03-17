import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FEATURE_FLAGS } from '@/domain/constants';
import { flagService } from '@/services/flags/flags';

import PlanPageClient from './PlanPageClient';

export const metadata: Metadata = {
  title: 'Plan',
  description: 'Build a local-first action plan from verified ORAN services and your own next steps.',
};

export default async function PlanPage() {
  const enabled = await flagService.isEnabled(FEATURE_FLAGS.SEEKER_PLANS_ENABLED);
  if (!enabled) {
    notFound();
  }

  return <PlanPageClient />;
}
