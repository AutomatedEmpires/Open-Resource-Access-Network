import type { AdvanceResult } from '@/services/workflow/engine';
import { advance, applySla } from '@/services/workflow/engine';
import type { SubmissionType } from '@/domain/types';

import {
  submitResourceSubmission,
  type ResourceSubmissionDetail,
} from './service';

export interface ProcessSubmittedResourceSubmissionInput {
  detail: ResourceSubmissionDetail;
  actorUserId: string;
  actorRole: string;
}

export interface ProcessSubmittedResourceSubmissionResult {
  success: boolean;
  error?: string;
  autoPublished: false;
  submitted?: AdvanceResult;
  queued?: AdvanceResult;
}

export async function processSubmittedResourceSubmission(
  input: ProcessSubmittedResourceSubmissionInput,
): Promise<ProcessSubmittedResourceSubmissionResult> {
  const { detail, actorUserId, actorRole } = input;

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

  const queued = await advance({
    submissionId: detail.instance.submission_id,
    toStatus: 'needs_review',
    actorUserId,
    actorRole,
    reason: 'Resource submission queued for independent review',
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
