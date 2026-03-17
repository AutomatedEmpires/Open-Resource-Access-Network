import { notFound } from 'next/navigation';

import DashboardPageClient from './DashboardPageClient';
import { FEATURE_FLAGS } from '@/domain/constants';
import { flagService } from '@/services/flags/flags';

export default async function DashboardPage() {
  const plansEnabled = await flagService.isEnabled(FEATURE_FLAGS.SEEKER_PLANS_ENABLED);
  if (!plansEnabled) {
    notFound();
  }

  const remindersEnabled = await flagService.isEnabled(FEATURE_FLAGS.SEEKER_REMINDERS_ENABLED);
  if (!remindersEnabled) {
    notFound();
  }

  const dashboardEnabled = await flagService.isEnabled(FEATURE_FLAGS.SEEKER_EXECUTION_DASHBOARD_ENABLED);
  if (!dashboardEnabled) {
    notFound();
  }

  const routeFeasibilityEnabled = await flagService.isEnabled(FEATURE_FLAGS.SEEKER_ROUTE_FEASIBILITY_ENABLED);

  return <DashboardPageClient routeFeasibilityEnabled={routeFeasibilityEnabled} />;
}
