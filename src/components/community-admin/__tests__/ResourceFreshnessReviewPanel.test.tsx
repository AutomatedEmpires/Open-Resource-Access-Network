// @vitest-environment jsdom

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';

import {
  ResourceFreshnessReviewPanel,
  type ResourceFreshnessSchedule,
} from '@/components/community-admin/ResourceFreshnessReviewPanel';
import type { ResourceFreshnessReviewPacket } from '@/domain/resourceFreshnessReview';

const FINDING_ID = '11111111-1111-4111-8111-111111111111';
const SCHEDULE_ID = '22222222-2222-4222-8222-222222222222';
const SERVICE_ID = '33333333-3333-4333-8333-333333333333';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';

function makePacket(
  signal: ResourceFreshnessReviewPacket['signal'] = 'explicit_expiry',
): ResourceFreshnessReviewPacket {
  const explicitExpiry = signal === 'explicit_expiry';
  return {
    schemaVersion: 1,
    findingId: FINDING_ID,
    signal,
    requiredAction: explicitExpiry ? 'correct_expired_schedule' : 'refresh_authoritative_source',
    hold: {
      actor: 'system:resource-freshness-scan',
      reason: `resource_freshness:${signal}:${FINDING_ID}`,
    },
    observed: {
      detectedAsOf: '2026-07-14T18:00:00.000Z',
      signalObservedAt: '2026-07-13T18:00:00.000Z',
      freshnessThresholdDays: explicitExpiry ? null : 180,
      serviceUpdatedAt: '2026-01-10T18:00:00.000Z',
      lastSourceRefreshAt: '2026-01-11T18:00:00.000Z',
      lastCandidateVerifiedAt: '2026-02-12T18:00:00.000Z',
      lastManualVerificationAt: null,
      reverifyAt: '2026-07-01T18:00:00.000Z',
      schedule: explicitExpiry
        ? { totalCount: 1, datedCount: 1, maxValidTo: '2026-06-30' }
        : { totalCount: 1, datedCount: 0, maxValidTo: null },
    },
    reviewRequirements: {
      evidenceRequired: true,
      scheduleCorrectionRequiredBeforeApproval: explicitExpiry,
    },
  };
}

const schedules: ResourceFreshnessSchedule[] = [
  {
    id: SCHEDULE_ID,
    service_id: SERVICE_ID,
    location_id: null,
    location_name: 'Downtown access center',
    valid_from: '2026-01-01',
    valid_to: '2026-06-30',
    days: ['monday', 'wednesday'],
    opens_at: '09:00',
    closes_at: '17:00',
    description: 'Seasonal intake hours',
  },
];

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof ResourceFreshnessReviewPanel>> = {},
) {
  const onSubmit = vi.fn();
  const view = render(
    <ResourceFreshnessReviewPanel
      packet={makePacket()}
      schedules={schedules}
      canReview
      reviewedStatusLabel="Approved"
      isSubmitting={false}
      submitResult={null}
      onDismissResult={vi.fn()}
      onSubmit={onSubmit}
      {...overrides}
    />,
  );
  return { onSubmit, ...view };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ResourceFreshnessReviewPanel', () => {
  it('presents the hold, source and verification facts, and attached schedules', () => {
    renderPanel();

    expect(screen.getByRole('heading', { name: 'Resource freshness review' })).toBeInTheDocument();
    expect(screen.getByText('Expired schedule detected')).toBeInTheDocument();
    expect(screen.getByText('Correct expired schedules before approval')).toBeInTheDocument();
    expect(screen.getByText('Last source refresh')).toBeInTheDocument();
    expect(screen.getByText('Last candidate verification')).toBeInTheDocument();
    expect(screen.getByText('Last manual verification')).toBeInTheDocument();
    expect(screen.getByText('Downtown access center')).toBeInTheDocument();
    expect(screen.getByText('Seasonal intake hours')).toBeInTheDocument();
    expect(screen.getByText(/1 total · 1 with an expiry/i)).toBeInTheDocument();

    expect(screen.getByRole('radio', { name: /Confirmed current/i })).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Corrected and reverified/i })).toBeEnabled();
    expect(screen.getByText(/explicitly expired direct-service schedules/i)).toBeInTheDocument();
  });

  it('enforces the corrected explicit-expiry path and URL evidence before submitting', () => {
    const { onSubmit } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Submit freshness review' }));
    expect(screen.getByText('Select a freshness outcome.')).toBeInTheDocument();
    expect(screen.getByText('Select how the resource was verified.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('radio', { name: /^Corrected and reverified/i }));
    expect(screen.getByRole('heading', { name: 'Direct schedule corrections' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Corrected end date'), {
      target: { value: '2026-12-31' },
    });
    fireEvent.change(screen.getByLabelText(/Verification method/i), {
      target: { value: 'provider_website' },
    });
    fireEvent.change(screen.getByLabelText(/Reviewer summary/i), {
      target: { value: 'Corrected every expired schedule and verified the provider page.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit freshness review' }));

    expect(screen.getByText('An evidence URL or contact channel is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Evidence URL'), {
      target: { value: 'https://provider.example.org/current-hours' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit freshness review' }));

    expect(onSubmit).toHaveBeenCalledWith({
      schemaVersion: 1,
      outcome: 'corrected',
      verificationMethod: 'provider_website',
      checkedAt: expect.any(String),
      evidenceUrl: 'https://provider.example.org/current-hours',
      scheduleCorrections: [{
        scheduleId: SCHEDULE_ID,
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
      }],
      reviewerSummary: 'Corrected every expired schedule and verified the provider page.',
    });
  });

  it('accepts a matching categorical contact channel instead of a URL', () => {
    const { onSubmit } = renderPanel({
      packet: makePacket('stale_source'),
    });

    fireEvent.click(screen.getByRole('radio', { name: /^Confirmed unavailable/i }));
    fireEvent.change(screen.getByLabelText(/Verification method/i), {
      target: { value: 'provider_phone' },
    });
    fireEvent.change(screen.getByLabelText(/Reviewer summary/i), {
      target: { value: 'Provider staff confirmed by phone that this service has closed.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit freshness review' }));

    expect(screen.getByLabelText('Contact channel')).toHaveValue('phone');
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'confirmed_unavailable',
      verificationMethod: 'provider_phone',
      contactChannel: 'phone',
    }));
  });

  it('blocks expired or future-only corrections and supports an explicit ongoing schedule', () => {
    const { onSubmit } = renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: 'Corrected and reverified' }));
    fireEvent.change(screen.getByLabelText(/Verification method/i), {
      target: { value: 'provider_phone' },
    });
    fireEvent.change(screen.getByLabelText(/Reviewer summary/i), {
      target: { value: 'Provider staff confirmed the direct schedule is now ongoing.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit freshness review' }));

    expect(screen.getByText('The corrected end date cannot already be expired.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Corrected start date'), {
      target: { value: '2027-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set as ongoing (no end date)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit freshness review' }));
    expect(screen.getByText('The corrected start date cannot be in the future.')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Corrected start date'), {
      target: { value: '2026-01-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit freshness review' }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      scheduleCorrections: [{
        scheduleId: SCHEDULE_ID,
        validFrom: '2026-01-01',
        validTo: null,
      }],
    }));
  });

  it('keeps observed facts visible but removes the form after review', () => {
    renderPanel({ canReview: false });

    expect(screen.getByText('Expired schedule detected')).toBeInTheDocument();
    expect(screen.getByText('This freshness item has already been reviewed (Approved).')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit freshness review' })).not.toBeInTheDocument();
  });

  it('never initializes checkedAt before a same-second finding timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-14T18:00:45.250Z'));
    const detectedAsOf = '2026-07-14T18:00:45.125Z';
    const packet = makePacket('stale_source');
    packet.observed.detectedAsOf = detectedAsOf;

    const { container } = renderPanel({ packet });

    const checkedAtInput = container.querySelector('#freshness-checked-at') as HTMLInputElement | null;
    expect(checkedAtInput).not.toBeNull();
    if (!checkedAtInput) return;
    expect(checkedAtInput).toHaveAttribute('step', '1');
    expect(new Date(checkedAtInput.value).getTime()).toBeGreaterThanOrEqual(
      new Date(detectedAsOf).getTime(),
    );
  });

  it('keeps an expired shared location schedule read-only and blocks corrected approval', () => {
    renderPanel({
      schedules: [{
        ...schedules[0],
        service_id: null,
        location_id: LOCATION_ID,
      }],
    });

    expect(screen.getByText('Shared location · read only')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Corrected and reverified' })).toBeDisabled();
    expect(screen.getByText(/can affect multiple services/i)).toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    const { container } = renderPanel();

    expect(await axe(container)).toHaveNoViolations();
  });
});
