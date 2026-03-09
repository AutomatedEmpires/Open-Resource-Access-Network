import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import { checkRateLimit } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { isDatabaseConfigured } from '@/services/db/postgres';
import {
  getAccessibleFormInstance,
  setFormSubmissionReviewerNotes,
  updateFormSubmissionOperationalMetadata,
  updateFormInstanceDraft,
} from '@/services/forms/vault';
import {
  computeVisibleFields,
  deriveFormFieldDefinitions,
  extractRoutingConfig,
  FORM_RECIPIENT_ROLES,
  validateAttachmentManifest,
  validateFormData,
} from '@/domain/forms';
import {
  HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_MS,
} from '@/domain/constants';
import type { SubmissionPriority } from '@/domain/types';
import { advance, applySla, assignSubmission } from '@/services/workflow/engine';
import { send as sendNotification } from '@/services/notifications/service';

type RouteContext = { params: Promise<{ id: string }> };

const UpdateInstanceSchema = z.object({
  action: z.enum(['save', 'submit', 'start_review', 'approve', 'deny', 'return', 'archive', 'withdraw', 'update_metadata']),
  title: z.string().max(200).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  reviewerNotes: z.string().max(5000).nullable().optional(),
  formData: z.record(z.string(), z.unknown()).optional(),
  attachmentManifest: z.array(z.unknown()).optional(),
  recipientRole: z.enum(FORM_RECIPIENT_ROLES).nullable().optional(),
  recipientUserId: z.string().min(1).max(200).nullable().optional(),
  recipientOrganizationId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(0).max(3).optional(),
  slaDeadline: z.string().datetime().nullable().optional(),
}).superRefine((value, ctx) => {
  if ((value.action === 'deny' || value.action === 'return') && !value.reviewerNotes?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reviewerNotes'],
      message: 'Reviewer notes are required when denying or returning a form',
    });
  }
});

function getIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function computeDeadlineIso(hoursFromNow: number): string {
  const deadline = new Date();
  deadline.setHours(deadline.getHours() + hoursFromNow);
  return deadline.toISOString();
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid form instance ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`forms:instance:get:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_READ_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'host_member')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  try {
    const instance = await getAccessibleFormInstance(authCtx, id);
    if (!instance) {
      return NextResponse.json({ error: 'Form instance not found' }, { status: 404 });
    }

    return NextResponse.json({ instance }, { headers: { 'Cache-Control': 'private, max-age=30' } });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_instances_get' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: 'Invalid form instance ID' }, { status: 400 });
  }

  const ip = getIp(req);
  const rl = checkRateLimit(`forms:instance:write:${ip}`, {
    windowMs: RATE_LIMIT_WINDOW_MS,
    maxRequests: HOST_WRITE_RATE_LIMIT_MAX_REQUESTS,
  });
  if (rl.exceeded) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }

  const authCtx = await getAuthContext();
  if (!authCtx) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  if (!requireMinRole(authCtx, 'host_member')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = UpdateInstanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const instance = await getAccessibleFormInstance(authCtx, id);
    if (!instance) {
      return NextResponse.json({ error: 'Form instance not found' }, { status: 404 });
    }

    const isReviewerAction = ['start_review', 'approve', 'deny', 'return'].includes(parsed.data.action);
    if (isReviewerAction && !requireMinRole(authCtx, 'community_admin')) {
      return NextResponse.json({ error: 'Reviewer permissions required' }, { status: 403 });
    }

    // ── Update operational metadata (priority / SLA) ─────────
    if (parsed.data.action === 'update_metadata') {
      if (!requireMinRole(authCtx, 'community_admin')) {
        return NextResponse.json({ error: 'Reviewer permissions required to update metadata' }, { status: 403 });
      }
      const terminalStatuses = ['approved', 'denied', 'withdrawn', 'archived', 'expired'];
      if (terminalStatuses.includes(instance.status)) {
        return NextResponse.json(
          { error: `Cannot update metadata for form in terminal status "${instance.status}"` },
          { status: 409 },
        );
      }
      const metaUpdate: { priority?: SubmissionPriority; slaDeadline?: string | null; slaBreached?: boolean } = {};
      if (parsed.data.priority !== undefined) {
        metaUpdate.priority = parsed.data.priority as SubmissionPriority;
      }
      if (parsed.data.slaDeadline !== undefined) {
        metaUpdate.slaDeadline = parsed.data.slaDeadline;
        if (parsed.data.slaDeadline) {
          metaUpdate.slaBreached = new Date(parsed.data.slaDeadline) < new Date();
        }
      }
      if (Object.keys(metaUpdate).length === 0) {
        return NextResponse.json({ error: 'No metadata fields provided to update' }, { status: 400 });
      }
      await updateFormSubmissionOperationalMetadata(instance.submission_id, metaUpdate);
      const refreshed = await getAccessibleFormInstance(authCtx, id);
      return NextResponse.json({ instance: refreshed });
    }

    // ── Archive / Withdraw lifecycle actions ──────────────────
    if (parsed.data.action === 'archive') {
      if (!requireMinRole(authCtx, 'community_admin')) {
        return NextResponse.json({ error: 'Reviewer permissions required to archive' }, { status: 403 });
      }
      const archivableStatuses = ['approved', 'denied', 'withdrawn', 'expired'];
      if (!archivableStatuses.includes(instance.status)) {
        return NextResponse.json(
          { error: `Cannot archive form in status "${instance.status}". Allowed: ${archivableStatuses.join(', ')}` },
          { status: 409 },
        );
      }
      const transition = await advance({
        submissionId: instance.submission_id,
        toStatus: 'archived',
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: parsed.data.reviewerNotes ?? 'Archived by reviewer',
        metadata: { form_instance_id: id },
      });
      if (!transition.success) {
        return NextResponse.json({ error: transition.error ?? 'Unable to archive form' }, { status: 409 });
      }
      const refreshed = await getAccessibleFormInstance(authCtx, id);
      return NextResponse.json({ instance: refreshed, transition });
    }

    if (parsed.data.action === 'withdraw') {
      const withdrawableStatuses = ['draft', 'returned'];
      if (!withdrawableStatuses.includes(instance.status)) {
        return NextResponse.json(
          { error: `Cannot withdraw form in status "${instance.status}". Allowed: ${withdrawableStatuses.join(', ')}` },
          { status: 409 },
        );
      }
      // Owner or admin can withdraw
      if (instance.submitted_by_user_id !== authCtx.userId && !requireMinRole(authCtx, 'community_admin')) {
        return NextResponse.json({ error: 'Only the submitter or a reviewer can withdraw a form' }, { status: 403 });
      }
      const transition = await advance({
        submissionId: instance.submission_id,
        toStatus: 'withdrawn',
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: parsed.data.reviewerNotes ?? 'Withdrawn by submitter',
        metadata: { form_instance_id: id },
      });
      if (!transition.success) {
        return NextResponse.json({ error: transition.error ?? 'Unable to withdraw form' }, { status: 409 });
      }
      const refreshed = await getAccessibleFormInstance(authCtx, id);
      return NextResponse.json({ instance: refreshed, transition });
    }

    if (parsed.data.action === 'save' || parsed.data.action === 'submit') {
      if (!['draft', 'returned'].includes(instance.status)) {
        return NextResponse.json({ error: 'Form is not editable in its current status' }, { status: 409 });
      }

      const routing = extractRoutingConfig(instance.template_schema_json ?? {}, {
        default_target_role: instance.template_default_target_role ?? null,
      });
      const nextFormData = parsed.data.formData ?? instance.form_data ?? {};
      const nextAttachmentManifest = parsed.data.attachmentManifest ?? instance.attachment_manifest ?? [];

      const attachmentError = validateAttachmentManifest(nextAttachmentManifest, routing);
      if (attachmentError) {
        return NextResponse.json({ error: attachmentError }, { status: 400 });
      }

      if (parsed.data.action === 'submit') {
        const fields = deriveFormFieldDefinitions(
          instance.template_schema_json ?? {},
          instance.template_ui_schema_json ?? {},
        );
        const visibleFields = computeVisibleFields(fields, nextFormData);
        const errors = validateFormData(fields, nextFormData, visibleFields);
        if (Object.keys(errors).length > 0) {
          return NextResponse.json({ error: 'Form validation failed', details: errors }, { status: 400 });
        }
      }

      await updateFormInstanceDraft(id, {
        title: parsed.data.title,
        notes: parsed.data.notes,
        formData: parsed.data.formData,
        attachmentManifest: parsed.data.attachmentManifest,
        recipientRole: parsed.data.recipientRole,
        recipientUserId: parsed.data.recipientUserId,
        recipientOrganizationId: parsed.data.recipientOrganizationId,
      });

      if (parsed.data.action === 'save') {
        const refreshed = await getAccessibleFormInstance(authCtx, id);
        return NextResponse.json({ instance: refreshed });
      }

      const transition = await advance({
        submissionId: instance.submission_id,
        toStatus: 'submitted',
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: 'Managed form submitted',
        metadata: { form_instance_id: id },
      });

      if (!transition.success) {
        return NextResponse.json({ error: transition.error ?? 'Unable to submit form' }, { status: 409 });
      }

      await updateFormSubmissionOperationalMetadata(instance.submission_id, {
        priority: instance.priority > 0 ? instance.priority : routing.defaultPriority ?? 0,
        slaDeadline: routing.slaReviewHours ? computeDeadlineIso(routing.slaReviewHours) : undefined,
        slaBreached: false,
      });

      if (!routing.slaReviewHours) {
        await applySla(instance.submission_id, 'managed_form');
      }

      let reviewQueueTransition: Awaited<ReturnType<typeof advance>> | null = null;
      if (routing.autoQueueForReview !== false) {
        reviewQueueTransition = await advance({
          submissionId: instance.submission_id,
          toStatus: 'needs_review',
          actorUserId: authCtx.userId,
          actorRole: authCtx.role,
          reason: 'Managed form queued for review',
          metadata: { form_instance_id: id },
        });

        if (!reviewQueueTransition.success) {
          return NextResponse.json(
            { error: reviewQueueTransition.error ?? 'Unable to queue form for review' },
            { status: 409 },
          );
        }
      }

      if (routing.emailConfirmation) {
        await sendNotification({
          recipientUserId: instance.submitted_by_user_id,
          eventType: 'submission_status_changed',
          title: routing.autoQueueForReview === false ? 'Managed form submitted' : 'Managed form submitted for review',
          body: routing.autoQueueForReview === false
            ? `${instance.title ?? instance.template_title} has been submitted and is awaiting reviewer pickup.`
            : `${instance.title ?? instance.template_title} has been submitted and queued for review.`,
          resourceType: 'submission',
          resourceId: instance.submission_id,
          actionUrl: '/forms',
          idempotencyKey: `managed_form_submit_${instance.submission_id}_${routing.autoQueueForReview === false ? 'submitted' : 'queued'}`,
        });
      }

      const refreshed = await getAccessibleFormInstance(authCtx, id);
      return NextResponse.json({
        instance: refreshed,
        transition: reviewQueueTransition ?? transition,
        submittedTransition: transition,
      });
    }

    let currentInstance = instance;

    if (parsed.data.action === 'start_review' && currentInstance.status === 'submitted') {
      const queueTransition = await advance({
        submissionId: currentInstance.submission_id,
        toStatus: 'needs_review',
        actorUserId: authCtx.userId,
        actorRole: authCtx.role,
        reason: 'Managed form manually queued for review',
        metadata: { form_instance_id: id },
      });

      if (!queueTransition.success) {
        return NextResponse.json({ error: queueTransition.error ?? 'Unable to queue form for review' }, { status: 409 });
      }

      const queuedInstance = await getAccessibleFormInstance(authCtx, id);
      if (queuedInstance) {
        currentInstance = queuedInstance;
      }
    }

    if (parsed.data.action === 'start_review' && currentInstance.assigned_to_user_id !== authCtx.userId) {
      await assignSubmission(currentInstance.submission_id, authCtx.userId, authCtx.userId, authCtx.role);
    }

    if (parsed.data.reviewerNotes !== undefined) {
      await setFormSubmissionReviewerNotes(currentInstance.submission_id, parsed.data.reviewerNotes ?? null);
    }

    const statusMap = {
      start_review: 'under_review',
      approve: 'approved',
      deny: 'denied',
      return: 'returned',
    } as const;

    const transition = await advance({
      submissionId: currentInstance.submission_id,
      toStatus: statusMap[parsed.data.action as keyof typeof statusMap],
      actorUserId: authCtx.userId,
      actorRole: authCtx.role,
      reason: parsed.data.reviewerNotes ?? `Managed form ${parsed.data.action}`,
      metadata: { form_instance_id: id },
    });

    if (!transition.success) {
      return NextResponse.json({ error: transition.error ?? 'Unable to update form status' }, { status: 409 });
    }

    // ── Fire lifecycle notification to submitter ──────────────
    const notifyStatuses = ['approved', 'denied', 'returned'] as const;
    const toStatus = statusMap[parsed.data.action as keyof typeof statusMap];
    if (notifyStatuses.includes(toStatus as (typeof notifyStatuses)[number])) {
      const formLabel = currentInstance.title ?? currentInstance.template_title ?? 'Managed form';
      const actionLabel = toStatus === 'returned' ? 'returned for revision' : toStatus;
      await sendNotification({
        recipientUserId: currentInstance.submitted_by_user_id,
        eventType: 'submission_status_changed',
        title: `Form ${actionLabel}`,
        body: `${formLabel} has been ${actionLabel}.`,
        resourceType: 'submission',
        resourceId: currentInstance.submission_id,
        actionUrl: '/forms',
        idempotencyKey: `managed_form_${toStatus}_${currentInstance.submission_id}_${Date.now()}`,
      });
    }

    const refreshed = await getAccessibleFormInstance(authCtx, id);
    return NextResponse.json({ instance: refreshed, transition });
  } catch (error) {
    await captureException(error, { feature: 'api_forms_instances_update' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
