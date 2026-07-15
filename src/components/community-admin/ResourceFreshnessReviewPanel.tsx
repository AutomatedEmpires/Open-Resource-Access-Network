'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  DatabaseZap,
  Loader2,
  SearchCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import {
  RESOURCE_FRESHNESS_REVIEW_SCHEMA_VERSION,
  resourceFreshnessOutcomeError,
  resourceFreshnessReviewSchema,
  resourceFreshnessReviewTimingError,
  type ResourceFreshnessOutcome,
  type ResourceFreshnessReview,
  type ResourceFreshnessReviewPacket,
} from '@/domain/resourceFreshnessReview';
import { formatDate, formatDateTime } from '@/lib/format';

export interface ResourceFreshnessSchedule {
  id: string;
  service_id: string | null;
  location_id: string | null;
  location_name: string | null;
  valid_from: string | null;
  valid_to: string | null;
  days: string[] | null;
  opens_at: string | null;
  closes_at: string | null;
  description: string | null;
}

interface ResourceFreshnessReviewPanelProps {
  packet: ResourceFreshnessReviewPacket;
  schedules: ResourceFreshnessSchedule[];
  canReview: boolean;
  reviewedStatusLabel: string;
  isSubmitting: boolean;
  submitResult: { success: boolean; message: string } | null;
  onDismissResult: () => void;
  onSubmit: (review: ResourceFreshnessReview) => void | Promise<void>;
}

type FieldName =
  | 'outcome'
  | 'verificationMethod'
  | 'checkedAt'
  | 'evidenceUrl'
  | 'contactChannel'
  | 'reviewerSummary';

type FieldErrors = Partial<Record<FieldName, string>>;

interface ScheduleCorrectionDraft {
  validFrom: string;
  validTo: string;
}

type ScheduleCorrectionErrors = Record<string, {
  validFrom?: string;
  validTo?: string;
}>;

const SIGNAL_LABELS: Record<ResourceFreshnessReviewPacket['signal'], string> = {
  explicit_expiry: 'Expired schedule detected',
  reverification_due: 'Reverification is due',
  stale_source: 'Authoritative source is stale',
  unknown_source: 'Source authority is unknown',
};

const ACTION_LABELS: Record<ResourceFreshnessReviewPacket['requiredAction'], string> = {
  correct_expired_schedule: 'Correct expired schedules before approval',
  reverify_service_availability: 'Reverify service availability',
  refresh_authoritative_source: 'Refresh the authoritative source',
  establish_source_authority: 'Establish an authoritative source',
};

const OUTCOME_OPTIONS: Array<{
  value: ResourceFreshnessOutcome;
  label: string;
  description: string;
}> = [
  {
    value: 'confirmed_current',
    label: 'Confirmed current',
    description: 'The published service and schedule are still accurate.',
  },
  {
    value: 'corrected',
    label: 'Corrected and reverified',
    description: 'The live record was corrected and the new facts were verified.',
  },
  {
    value: 'confirmed_unavailable',
    label: 'Confirmed unavailable',
    description: 'Evidence confirms that the service is no longer available.',
  },
  {
    value: 'unable_to_verify',
    label: 'Unable to verify',
    description: 'The available evidence is insufficient; escalate for another review.',
  },
];

const VERIFICATION_METHODS = [
  ['provider_website', 'Provider website'],
  ['provider_phone', 'Provider phone'],
  ['provider_email', 'Provider email'],
  ['provider_portal', 'Provider portal'],
  ['government_registry', 'Government registry'],
  ['in_person', 'In person'],
  ['trusted_partner', 'Trusted partner'],
] as const;

const CONTACT_CHANNELS = [
  ['phone', 'Phone'],
  ['email', 'Email'],
  ['in_person', 'In person'],
  ['provider_portal', 'Provider portal'],
  ['trusted_partner', 'Trusted partner'],
] as const;

const METHOD_CONTACT_CHANNEL = {
  provider_phone: 'phone',
  provider_email: 'email',
  provider_portal: 'provider_portal',
  in_person: 'in_person',
  trusted_partner: 'trusted_partner',
} as const;

function toDateTimeLocal(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

function initialCheckedAt(packet: ResourceFreshnessReviewPacket): string {
  const detectedAtMs = Date.parse(packet.observed.detectedAsOf);
  const baselineMs = Math.max(Date.now(), detectedAtMs);
  // datetime-local defaults to minute precision unless a step is provided.
  // Round up to the next whole second so a same-second scanner timestamp with
  // milliseconds can never predate the finding it is meant to verify.
  return toDateTimeLocal(new Date(Math.ceil(baselineMs / 1000) * 1000));
}

function dateTimeOrNotRecorded(value: string | null): string {
  return value ? formatDateTime(value) : 'Not recorded';
}

function dateOrNotRecorded(value: string | null): string {
  return value ? formatDate(value) : 'Not recorded';
}

function displayDays(days: string[] | null): string {
  if (!days || days.length === 0) return 'Days not specified';
  return days.map((day) => day.replaceAll('_', ' ')).join(', ');
}

function displayHours(opensAt: string | null, closesAt: string | null): string {
  if (!opensAt && !closesAt) return 'Hours not specified';
  return `${opensAt ?? 'Start not specified'} – ${closesAt ?? 'End not specified'}`;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function firstIssueByField(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path[0];
    if (
      typeof field === 'string'
      && [
        'outcome',
        'verificationMethod',
        'checkedAt',
        'evidenceUrl',
        'contactChannel',
        'reviewerSummary',
      ].includes(field)
      && !errors[field as FieldName]
    ) {
      errors[field as FieldName] = issue.message;
    }
  }
  return errors;
}

export function ResourceFreshnessReviewPanel({
  packet,
  schedules,
  canReview,
  reviewedStatusLabel,
  isSubmitting,
  submitResult,
  onDismissResult,
  onSubmit,
}: ResourceFreshnessReviewPanelProps) {
  const [outcome, setOutcome] = useState<ResourceFreshnessOutcome | ''>('');
  const [verificationMethod, setVerificationMethod] = useState('');
  const [checkedAt, setCheckedAt] = useState(() => initialCheckedAt(packet));
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [contactChannel, setContactChannel] = useState('');
  const [reviewerSummary, setReviewerSummary] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const today = new Date().toISOString().slice(0, 10);
  const directSchedulesNeedingCorrection = schedules.filter(
    (schedule) => Boolean(
      schedule.service_id
      && schedule.valid_to
      && schedule.valid_to < today,
    ),
  );
  const sharedSchedulesNeedingCorrection = schedules.filter(
    (schedule) => Boolean(
      !schedule.service_id
      && schedule.location_id
      && schedule.valid_to
      && schedule.valid_to < today,
    ),
  );
  const [scheduleCorrections, setScheduleCorrections] = useState<Record<string, ScheduleCorrectionDraft>>(
    () => Object.fromEntries(
      directSchedulesNeedingCorrection.map((schedule) => [
        schedule.id,
        {
          validFrom: schedule.valid_from ?? '',
          validTo: schedule.valid_to ?? '',
        },
      ]),
    ),
  );
  const [scheduleCorrectionErrors, setScheduleCorrectionErrors] = useState<ScheduleCorrectionErrors>({});

  const requiresCorrectedApproval =
    packet.signal === 'explicit_expiry'
    && packet.reviewRequirements.scheduleCorrectionRequiredBeforeApproval;
  const inlineCorrectionBlocked =
    sharedSchedulesNeedingCorrection.length > 0
    || directSchedulesNeedingCorrection.length > 100;

  const evidenceHint = useMemo(() => {
    if (verificationMethod === 'provider_website' || verificationMethod === 'government_registry') {
      return 'A public HTTP or HTTPS evidence URL is required for this method.';
    }
    if (verificationMethod === 'provider_portal') {
      return 'Provide a portal evidence URL or select Provider portal as the contact channel.';
    }
    if (verificationMethod) {
      return 'The categorical contact channel must match the verification method.';
    }
    return 'Every freshness decision requires an evidence URL or a categorical contact channel.';
  }, [verificationMethod]);

  function updateVerificationMethod(value: string) {
    setVerificationMethod(value);
    setErrors((current) => ({
      ...current,
      verificationMethod: undefined,
      evidenceUrl: undefined,
      contactChannel: undefined,
    }));
    setContactChannel(
      METHOD_CONTACT_CHANNEL[value as keyof typeof METHOD_CONTACT_CHANNEL] ?? '',
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: FieldErrors = {};
    if (!outcome) nextErrors.outcome = 'Select a freshness outcome.';
    if (!verificationMethod) {
      nextErrors.verificationMethod = 'Select how the resource was verified.';
    }
    if (!checkedAt || Number.isNaN(new Date(checkedAt).getTime())) {
      nextErrors.checkedAt = 'Enter a valid verification date and time.';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const normalizedScheduleCorrections: Array<{
      scheduleId: string;
      validFrom: string | null;
      validTo: string | null;
    }> = [];
    const nextScheduleErrors: ScheduleCorrectionErrors = {};

    if (requiresCorrectedApproval && outcome === 'corrected') {
      if (sharedSchedulesNeedingCorrection.length > 0) {
        setErrors({
          outcome: 'A shared location schedule is expired and cannot be changed from this service review. Escalate it for location-level maintenance.',
        });
        return;
      }
      if (directSchedulesNeedingCorrection.length > 100) {
        setErrors({
          outcome: 'More than 100 direct schedules require correction. Escalate this item for administrative repair.',
        });
        return;
      }

      for (const schedule of directSchedulesNeedingCorrection) {
        const correction = scheduleCorrections[schedule.id] ?? {
          validFrom: schedule.valid_from ?? '',
          validTo: schedule.valid_to ?? '',
        };
        const validFrom = correction.validFrom.trim();
        const validTo = correction.validTo.trim();
        const correctionErrors: { validFrom?: string; validTo?: string } = {};

        if (validFrom && !isIsoDate(validFrom)) {
          correctionErrors.validFrom = 'Enter a valid start date or leave it blank.';
        } else if (validFrom && validFrom > today) {
          correctionErrors.validFrom = 'The corrected start date cannot be in the future.';
        }
        if (validTo && !isIsoDate(validTo)) {
          correctionErrors.validTo = 'Enter a valid end date or leave it blank for an ongoing schedule.';
        } else if (validTo && validTo < today) {
          correctionErrors.validTo = 'The corrected end date cannot already be expired.';
        }
        if (validFrom && validTo && validTo < validFrom) {
          correctionErrors.validTo = 'The end date cannot be earlier than the start date.';
        }

        if (Object.keys(correctionErrors).length > 0) {
          nextScheduleErrors[schedule.id] = correctionErrors;
        }

        normalizedScheduleCorrections.push({
          scheduleId: schedule.id,
          validFrom: validFrom || null,
          validTo: validTo || null,
        });
      }
    }

    if (Object.keys(nextScheduleErrors).length > 0) {
      setScheduleCorrectionErrors(nextScheduleErrors);
      return;
    }

    const reviewCandidate = {
      schemaVersion: RESOURCE_FRESHNESS_REVIEW_SCHEMA_VERSION,
      outcome,
      verificationMethod,
      checkedAt: new Date(checkedAt).toISOString(),
      ...(evidenceUrl.trim() ? { evidenceUrl: evidenceUrl.trim() } : {}),
      ...(contactChannel ? { contactChannel } : {}),
      reviewerSummary: reviewerSummary.trim(),
      ...(normalizedScheduleCorrections.length > 0
        ? { scheduleCorrections: normalizedScheduleCorrections }
        : {}),
    };

    const parsed = resourceFreshnessReviewSchema.safeParse(reviewCandidate);
    if (!parsed.success) {
      const schemaErrors = firstIssueByField(parsed.error.issues);
      if (
        parsed.error.issues.some((issue) => issue.path[0] === 'scheduleCorrections')
        && !schemaErrors.outcome
      ) {
        schemaErrors.outcome = 'Schedule correction data is invalid. Refresh this item or escalate it for administrative repair.';
      }
      setErrors(schemaErrors);
      return;
    }

    const timingError = resourceFreshnessReviewTimingError(parsed.data.checkedAt);
    const outcomeError = resourceFreshnessOutcomeError(packet, parsed.data);
    if (timingError || outcomeError) {
      setErrors({
        ...(timingError ? { checkedAt: timingError } : {}),
        ...(outcomeError ? { outcome: outcomeError } : {}),
      });
      return;
    }

    setErrors({});
    setScheduleCorrectionErrors({});
    void onSubmit(parsed.data);
  }

  return (
    <section
      aria-labelledby="resource-freshness-review-title"
      className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg"
    >
      <div className="bg-gradient-brand-deep px-5 py-5 text-white">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/50 bg-slate-950/45 shadow-inner">
            <DatabaseZap className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-100">
              Lifecycle integrity hold
            </p>
            <h2 id="resource-freshness-review-title" className="mt-1 text-lg font-semibold">
              Resource freshness review
            </h2>
            <p className="mt-1 text-sm text-slate-100">
              Resolve this evidence-based hold before the resource returns to seekers.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--text-primary)] p-3 text-white">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-300">Signal</p>
            <p className="mt-1 text-sm font-semibold">{SIGNAL_LABELS[packet.signal]}</p>
          </div>
          <div className="rounded-lg border border-action-base bg-action-base p-3 text-white">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-200">Required action</p>
            <p className="mt-1 text-sm font-semibold">{ACTION_LABELS[packet.requiredAction]}</p>
          </div>
        </div>

        {requiresCorrectedApproval && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-lg border border-action-base bg-[var(--text-primary)] px-4 py-3 text-sm text-white shadow-sm"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {
              sharedSchedulesNeedingCorrection.length > 0
                ? 'At least one expired schedule belongs to a shared location and can affect multiple services. It is read-only here: use Unable to verify to escalate for location-level maintenance. Do not change it from a single-service review.'
                : directSchedulesNeedingCorrection.length > 100
                  ? 'More than 100 direct schedules require correction. The typed correction limit is 100, so escalate this item for administrative repair.'
                  : directSchedulesNeedingCorrection.length > 0
                    ? 'This item has explicitly expired direct-service schedules. Enter corrected dates below, then select Corrected and reverified. A blank end date records an ongoing schedule.'
                    : 'The attached schedules now show current expiry dates. Confirm the evidence, then use Corrected and reverified for an approval outcome.'
              }
            </span>
          </div>
        )}

        <section aria-labelledby="freshness-observed-title">
          <div className="flex items-center gap-2">
            <SearchCheck className="h-4 w-4 text-action-base" aria-hidden="true" />
            <h3 id="freshness-observed-title" className="text-sm font-semibold uppercase tracking-wider text-slate-900">
              Observed facts
            </h3>
          </div>
          <dl className="mt-3 grid gap-px overflow-hidden rounded-lg border border-slate-300 bg-slate-300 sm:grid-cols-2">
            {[
              ['Detected as of', formatDateTime(packet.observed.detectedAsOf)],
              ['Signal observed', formatDateTime(packet.observed.signalObservedAt)],
              ['Service last updated', formatDateTime(packet.observed.serviceUpdatedAt)],
              ['Last source refresh', dateTimeOrNotRecorded(packet.observed.lastSourceRefreshAt)],
              ['Last candidate verification', dateTimeOrNotRecorded(packet.observed.lastCandidateVerifiedAt)],
              ['Last manual verification', dateTimeOrNotRecorded(packet.observed.lastManualVerificationAt)],
              ['Scheduled reverification', dateTimeOrNotRecorded(packet.observed.reverifyAt)],
              [
                'Freshness threshold',
                packet.observed.freshnessThresholdDays
                  ? `${packet.observed.freshnessThresholdDays} days`
                  : 'Not configured',
              ],
            ].map(([label, value]) => (
              <div key={label} className="bg-white px-3 py-2.5">
                <dt className="text-xs font-medium text-slate-500">{label}</dt>
                <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="freshness-schedule-title">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-action-base" aria-hidden="true" />
            <h3 id="freshness-schedule-title" className="text-sm font-semibold uppercase tracking-wider text-slate-900">
              Attached schedules
            </h3>
          </div>
          <p className="mt-2 text-sm text-slate-700">
            {packet.observed.schedule.totalCount} total · {packet.observed.schedule.datedCount} with an expiry · latest expiry{' '}
            <span className="font-semibold">
              {dateOrNotRecorded(packet.observed.schedule.maxValidTo)}
            </span>
          </p>

          {schedules.length > 0 ? (
            <ul className="mt-3 space-y-3" aria-label="Schedules attached to this resource">
              {schedules.map((schedule, index) => (
                <li key={schedule.id} className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-950">
                      {schedule.location_name ?? `Service schedule ${index + 1}`}
                    </p>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {!schedule.service_id && schedule.location_id && (
                        <span className="rounded-full border border-action-base bg-action-base px-2 py-0.5 text-[11px] font-semibold text-white">
                          Shared location · read only
                        </span>
                      )}
                      <span className="rounded-full border border-slate-500 bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                        {schedule.valid_to ? `Expires ${formatDate(schedule.valid_to)}` : 'No expiry recorded'}
                      </span>
                    </div>
                  </div>
                  <dl className="mt-2 grid gap-2 text-xs text-slate-700 sm:grid-cols-2">
                    <div>
                      <dt className="font-medium text-slate-500">Days</dt>
                      <dd className="mt-0.5 capitalize">{displayDays(schedule.days)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Hours</dt>
                      <dd className="mt-0.5">{displayHours(schedule.opens_at, schedule.closes_at)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Valid from</dt>
                      <dd className="mt-0.5">{dateOrNotRecorded(schedule.valid_from)}</dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-500">Valid through</dt>
                      <dd className="mt-0.5">{dateOrNotRecorded(schedule.valid_to)}</dd>
                    </div>
                  </dl>
                  {schedule.description && (
                    <p className="mt-2 text-xs text-slate-600">{schedule.description}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg border border-slate-400 bg-slate-100 p-3 text-sm text-slate-700">
              No attached schedule rows were returned. Verify the resource record before resolving this hold.
            </p>
          )}
        </section>

        {submitResult && (
          <FormAlert
            variant={submitResult.success ? 'success' : 'error'}
            message={submitResult.message}
            onDismiss={onDismissResult}
          />
        )}

        {canReview ? (
          <form noValidate className="space-y-5" onSubmit={handleSubmit}>
            <fieldset aria-describedby={errors.outcome ? 'freshness-outcome-error' : undefined}>
              <legend className="text-sm font-semibold text-slate-900">
                Review outcome <span className="text-red-600" aria-hidden="true">*</span>
              </legend>
              <p className="mt-1 text-xs text-slate-600">
                The outcome determines the workflow decision and lifecycle state.
              </p>
              <div className="mt-3 space-y-2">
                {OUTCOME_OPTIONS.map((option) => {
                  const disabled = requiresCorrectedApproval && (
                    option.value === 'confirmed_current'
                    || (option.value === 'corrected' && inlineCorrectionBlocked)
                  );
                  const selected = outcome === option.value;
                  return (
                    <label
                      key={option.value}
                      className={`flex min-h-14 items-start gap-3 rounded-lg border p-3 transition-colors ${
                        disabled
                          ? 'cursor-not-allowed border-slate-300 bg-slate-200 text-slate-500'
                          : selected
                            ? 'cursor-pointer border-action-base bg-action-base text-white shadow-sm'
                            : 'cursor-pointer border-slate-300 bg-white text-slate-900 hover:border-action-base'
                      }`}
                    >
                      <input
                        type="radio"
                        name="freshness-outcome"
                        value={option.value}
                        aria-label={option.label}
                        checked={selected}
                        disabled={disabled}
                        onChange={() => {
                          setOutcome(option.value);
                          setErrors((current) => ({ ...current, outcome: undefined }));
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 text-action-base"
                      />
                      <span>
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className={`mt-0.5 block text-xs ${selected ? 'text-slate-100' : 'text-slate-600'}`}>
                          {disabled
                            ? option.value === 'confirmed_current'
                              ? 'Unavailable for explicit expiry; use Corrected and reverified after updating schedules.'
                              : sharedSchedulesNeedingCorrection.length > 0
                                ? 'Unavailable because a shared location schedule requires a separate location-level correction.'
                                : 'Unavailable because the correction exceeds the 100-schedule review limit.'
                            : option.description}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {errors.outcome && (
                <p id="freshness-outcome-error" role="alert" className="mt-2 text-sm text-red-700">
                  {errors.outcome}
                </p>
              )}
            </fieldset>

            {requiresCorrectedApproval
              && outcome === 'corrected'
              && directSchedulesNeedingCorrection.length > 0
              && !inlineCorrectionBlocked && (
                <section
                  aria-labelledby="direct-schedule-corrections-title"
                  className="rounded-xl border border-action-base bg-[var(--bg-surface-alt)] p-4"
                >
                  <h3 id="direct-schedule-corrections-title" className="text-sm font-semibold text-slate-950">
                    Direct schedule corrections
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-slate-700">
                    Correct every expired direct-service schedule below. These typed changes are applied atomically with the freshness review. Leave the end date blank only when the schedule is ongoing.
                  </p>

                  <div className="mt-4 space-y-4">
                    {directSchedulesNeedingCorrection.map((schedule, index) => {
                      const correction = scheduleCorrections[schedule.id] ?? {
                        validFrom: schedule.valid_from ?? '',
                        validTo: schedule.valid_to ?? '',
                      };
                      const correctionErrors = scheduleCorrectionErrors[schedule.id] ?? {};
                      return (
                        <fieldset
                          key={schedule.id}
                          className="rounded-lg border border-slate-400 bg-white p-3"
                        >
                          <legend className="px-1 text-sm font-semibold text-slate-950">
                            {schedule.location_name ?? `Direct service schedule ${index + 1}`}
                          </legend>
                          <p className="mb-3 text-xs text-slate-600">
                            Previous range: {dateOrNotRecorded(schedule.valid_from)} – {dateOrNotRecorded(schedule.valid_to)}
                          </p>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <FormField
                              label="Corrected start date"
                              htmlFor={`schedule-${schedule.id}-valid-from`}
                              hint="Optional; preserve or update the existing start date."
                              error={correctionErrors.validFrom}
                            >
                              <input
                                id={`schedule-${schedule.id}-valid-from`}
                                type="date"
                                value={correction.validFrom}
                                onChange={(event) => {
                                  setScheduleCorrections((current) => ({
                                    ...current,
                                    [schedule.id]: {
                                      ...correction,
                                      validFrom: event.target.value,
                                    },
                                  }));
                                  setScheduleCorrectionErrors((current) => ({
                                    ...current,
                                    [schedule.id]: {
                                      ...current[schedule.id],
                                      validFrom: undefined,
                                    },
                                  }));
                                }}
                                className="min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-action focus:outline-none focus:ring-2 focus:ring-action"
                              />
                            </FormField>

                            <FormField
                              label="Corrected end date"
                              htmlFor={`schedule-${schedule.id}-valid-to`}
                              hint="Use a current/future date, or leave blank for no end date."
                              error={correctionErrors.validTo}
                            >
                              <input
                                id={`schedule-${schedule.id}-valid-to`}
                                type="date"
                                min={today}
                                value={correction.validTo}
                                onChange={(event) => {
                                  setScheduleCorrections((current) => ({
                                    ...current,
                                    [schedule.id]: {
                                      ...correction,
                                      validTo: event.target.value,
                                    },
                                  }));
                                  setScheduleCorrectionErrors((current) => ({
                                    ...current,
                                    [schedule.id]: {
                                      ...current[schedule.id],
                                      validTo: undefined,
                                    },
                                  }));
                                }}
                                className="min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-action focus:outline-none focus:ring-2 focus:ring-action"
                              />
                            </FormField>
                            <button
                              type="button"
                              onClick={() => {
                                setScheduleCorrections((current) => ({
                                  ...current,
                                  [schedule.id]: { ...correction, validTo: '' },
                                }));
                                setScheduleCorrectionErrors((current) => ({
                                  ...current,
                                  [schedule.id]: {
                                    ...current[schedule.id],
                                    validTo: undefined,
                                  },
                                }));
                              }}
                              className="min-h-[36px] self-end rounded-md border border-[var(--border)] bg-[var(--text-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-action-base focus:outline-none focus:ring-2 focus:ring-action focus:ring-offset-2"
                            >
                              Set as ongoing (no end date)
                            </button>
                          </div>
                        </fieldset>
                      );
                    })}
                  </div>
                </section>
              )}

            <FormField
              label="Verification method"
              htmlFor="freshness-verification-method"
              required
              error={errors.verificationMethod}
            >
              <select
                id="freshness-verification-method"
                value={verificationMethod}
                onChange={(event) => updateVerificationMethod(event.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-action focus:outline-none focus:ring-2 focus:ring-action"
              >
                <option value="">Select a method</option>
                {VERIFICATION_METHODS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </FormField>

            <FormField
              label="Checked at"
              htmlFor="freshness-checked-at"
              required
              hint="Use the time you checked the evidence, within the last 30 days."
              error={errors.checkedAt}
            >
              <input
                id="freshness-checked-at"
                type="datetime-local"
                step={1}
                value={checkedAt}
                onChange={(event) => {
                  setCheckedAt(event.target.value);
                  setErrors((current) => ({ ...current, checkedAt: undefined }));
                }}
                className="min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-action focus:outline-none focus:ring-2 focus:ring-action"
              />
            </FormField>

            <fieldset className="space-y-3" aria-describedby="freshness-evidence-hint">
              <legend className="text-sm font-semibold text-slate-900">
                Evidence <span className="text-red-600" aria-hidden="true">*</span>
              </legend>
              <p id="freshness-evidence-hint" className="text-xs text-slate-600">{evidenceHint}</p>

              <FormField
                label="Evidence URL"
                htmlFor="freshness-evidence-url"
                hint="Use the provider or registry page that supports this decision."
                error={errors.evidenceUrl}
              >
                <input
                  id="freshness-evidence-url"
                  type="url"
                  inputMode="url"
                  maxLength={2048}
                  value={evidenceUrl}
                  onChange={(event) => {
                    setEvidenceUrl(event.target.value);
                    setErrors((current) => ({ ...current, evidenceUrl: undefined }));
                  }}
                  placeholder="https://provider.example/resource"
                  className="min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-action focus:outline-none focus:ring-2 focus:ring-action"
                />
              </FormField>

              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-slate-300" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">or</span>
                <span className="h-px flex-1 bg-slate-300" />
              </div>

              <FormField
                label="Contact channel"
                htmlFor="freshness-contact-channel"
                hint="Store only the category—not a person's contact details."
                error={errors.contactChannel}
              >
                <select
                  id="freshness-contact-channel"
                  value={contactChannel}
                  onChange={(event) => {
                    setContactChannel(event.target.value);
                    setErrors((current) => ({ ...current, contactChannel: undefined }));
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-action focus:outline-none focus:ring-2 focus:ring-action"
                >
                  <option value="">No contact channel</option>
                  {CONTACT_CHANNELS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </FormField>
            </fieldset>

            <FormField
              label="Reviewer summary"
              htmlFor="freshness-reviewer-summary"
              required
              hint="Summarize what you checked, what the evidence showed, and any correction made (20–2,000 characters)."
              error={errors.reviewerSummary}
              charCount={reviewerSummary.length}
              maxLength={2000}
            >
              <textarea
                id="freshness-reviewer-summary"
                rows={5}
                minLength={20}
                maxLength={2000}
                value={reviewerSummary}
                onChange={(event) => {
                  setReviewerSummary(event.target.value);
                  setErrors((current) => ({ ...current, reviewerSummary: undefined }));
                }}
                placeholder="Describe the evidence checked and the current state of the resource…"
                className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-action focus:outline-none focus:ring-2 focus:ring-action"
              />
            </FormField>

            <Button type="submit" className="min-h-[44px] w-full gap-2" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Submitting freshness review…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Submit freshness review
                </>
              )}
            </Button>
          </form>
        ) : (
          <div className="rounded-lg border border-slate-400 bg-slate-100 p-4 text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-action-base" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-slate-800">
              This freshness item has already been reviewed ({reviewedStatusLabel}).
            </p>
          </div>
        )}

        <p className="flex items-start gap-2 border-t border-slate-300 pt-4 text-xs text-slate-600">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-action-base" aria-hidden="true" />
          Do not include private client information, personal contact details, or case notes in freshness evidence.
        </p>
      </div>
    </section>
  );
}
