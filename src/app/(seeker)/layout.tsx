import React from 'react';

import { FEATURE_FLAGS } from '@/domain/constants';
import { flagService } from '@/services/flags/flags';

import SeekerLayoutShell from './SeekerLayoutShell';

export default async function SeekerLayout({ children }: { children: React.ReactNode }) {
  const planEnabled = await flagService.isEnabled(FEATURE_FLAGS.SEEKER_PLANS_ENABLED);
  const reminderEnabled = planEnabled
    ? await flagService.isEnabled(FEATURE_FLAGS.SEEKER_REMINDERS_ENABLED)
    : false;

  return (
    <SeekerLayoutShell planEnabled={planEnabled} reminderEnabled={reminderEnabled}>
      {children}
    </SeekerLayoutShell>
  );
}
