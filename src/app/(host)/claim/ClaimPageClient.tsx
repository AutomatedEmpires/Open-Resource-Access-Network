'use client';

import React from 'react';

import { ResourceSubmissionWorkspace } from '@/components/resource-submissions/ResourceSubmissionWorkspace';

export default function ClaimPageClient() {
  return (
    <ResourceSubmissionWorkspace
      portal="host"
      initialVariant="claim"
      initialChannel="host"
      pageEyebrow="Host onboarding"
      pageTitle="Claim an Organization"
      pageSubtitle="Use the same structured cards ORAN admins will review so ownership, verification notes, and final workspace activation all live on one record."
      backHref="/host"
      backLabel="Back to dashboard"
    />
  );
}
