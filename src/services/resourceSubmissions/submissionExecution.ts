import type { AdvanceResult } from '@/services/workflow/engine';
import { advance, applySla } from '@/services/workflow/engine';
import type { SubmissionType } from '@/domain/types';

import {
  projectApprovedResourceSubmission,
  submitResourceSubmission,
  type ResourceSubmissionDetail,
} from './service';

export interface ProcessSubmittedResourceSubmissionInput {
  detail: ResourceSubmissionDetail;
  actorUserId: string;
  actorRole: string;
  allowAutoApprove: boolean;
}

export interface ProcessSubmittedResourceSubmissionResult {
  success: boolean;
  error?: string;
  autoPublished: boolean;
  submitted?: AdvanceResult;
  autoChecking?: AdvanceResult;
  approved?: AdvanceResult;
  queued?: AdvanceResult;
}

export async function processSubmittedResourceSubmission(
  input: ProcessSubmittedResourceSubmissionInput,
): Promise<ProcessSubmittedResourceSubmissionResult> {
  const { detail, actorUserId, actorRole, allowAutoApprove } = input;

  await submitResourceSubmission(detail.instance.id, actorUserId, actorRole);

  const submitted = await advance({
    submissionId: detail.instance.submission_id,
    toStatus: 'submitted',
    actorUserId,
    actorRole,
    reason: 'Resource submission submitted',
    metadata: { form_instance_id: detail.instance.id },
  });
  if (!submitted.success) {
    return {
      success: false,
      error: submitted.error ?? 'Unable to submit resource.',
      autoPublished: false,
      submitted,
    };
  }

  try {
    await applySla(detail.instance.submission_id, detail.instance.submission_type as SubmissionType);
  } catch {
    // SLA application is best-effort.
  }

  if (!allowAutoApprove) {
    const queued = await advance({
      submissionId: detail.instance.submission_id,
      toStatus: 'needs_review',
      actorUserId,
      actorRole,
      reason: 'Resource submission queued for review',
      metadata: { form_instance_id: detail.instance.id },
    });
    if (!queued.success) {
      return {
        success: false,
        error: queued.error ?? 'Unable to queue resource for review.',
        autoPublished: false,
        submitted,
        queued,
      };
    }

    return {
      success: true,
      autoPublished: false,
      submitted,
      queued,
    };
  }

  const autoChecking = await advance({
    submissionId: detail.instance.submission_id,
    toStatus: 'auto_checking',
    actorUserId,
    actorRole: 'system',
    reason: 'Host-controlled listing entered automatic publication review',
    metadata: { form_instance_id: detail.instance.id, policy: 'host_auto_publish' },
    skipGates: true,
  });
  if (!autoChecking.success) {
    return {
      success: false,
      error: autoChecking.error ?? 'Unable to start automatic review.',
      autoPublished: false,
      submitted,
      autoChecking,
    };
  }

  const approved = await advance({
    submissionId: detail.instance.submission_id,
    toStatus: 'approved',
    actorUserId,
    actorRole: 'system',
    reason: 'Host-controlled listing auto-published by source-aware policy',
    metadata: { form_instance_id: detail.instance.id, policy: 'host_auto_publish' },
    skipGates: true,
  });

  if (!approved.success) {
    const queued = await advance({
      submissionId: detail.instance.submission_id,
      toStatus: 'needs_review',
      actorUserId,
      actorRole: 'system',
      reason: approved.error ?? 'Automatic publication failed; routed to manual review',
      metadata: { form_instance_id: detail.instance.id, policy: 'host_auto_publish_fallback' },
      skipGates: true,
    });
    if (!queued.success) {
      return {
        success: false,
        error: approved.error ?? 'Unable to complete submission workflow.',
        autoPublished: false,
        submitted,
        autoChecking,
        approved,
        queued,
      };
    }

    return {
      success: true,
      autoPublished: false,
      submitted,
      autoChecking,
      approved,
      queued,
    };
  }

  await projectApprovedResourceSubmission(detail.instance.id, actorUserId);

  return {
    success: true,
    autoPublished: true,
    submitted,
    autoChecking,
    approved,
  };
}
