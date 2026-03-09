'use client';

import React from 'react';

import { ResourceSubmissionWorkspace } from '@/components/resource-submissions/ResourceSubmissionWorkspace';

export default function ApprovalReviewPageClient({ id }: { id: string }) {
  return (
    <ResourceSubmissionWorkspace
      portal="oran_admin"
      initialVariant="claim"
      initialChannel="host"
      entryId={id}
      pageEyebrow="ORAN Admin"
      pageTitle="Resource approval review"
      pageSubtitle="Review the exact submission cards the operator completed, make edits if needed, and record the final decision with a full audit trail."
      backHref="/approvals"
      backLabel="Back to approvals"
    />
  );
}
