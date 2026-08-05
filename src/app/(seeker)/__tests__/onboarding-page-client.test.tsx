// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';

const pushMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import OnboardingPageClient from '@/app/(seeker)/onboarding/OnboardingPageClient';
import { ONBOARDING_CHAT_HANDOFF_KEY } from '@/services/profile/onboardingHandoff';
import { SEEKER_PROFILE_STORAGE_KEY } from '@/services/profile/clientContext';
import { PROFILE_PREFERENCES_STORAGE_KEY } from '@/services/profile/syncPreference';

function reachOptionalChoice() {
  fireEvent.click(screen.getByRole('button', { name: /Food/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  pushMock.mockReset();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('OnboardingPageClient', () => {
  it('has no automated accessibility violations on the opening step', async () => {
    const { container } = render(<OnboardingPageClient />);

    expect(await axe(container)).toHaveNoViolations();
  });

  it('starts with the immediate need and keeps sensitive questions behind an explicit optional step', () => {
    render(<OnboardingPageClient />);

    expect(screen.getByText('Optional search setup')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Help ORAN narrow your search.' })).toBeInTheDocument();
    expect(screen.getByText(/Location, timing, household, and access details are optional/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What do you need help with?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Food' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Employment context (optional)')).not.toBeInTheDocument();

    reachOptionalChoice();

    expect(screen.getByRole('button', { name: /Skip optional questions/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add optional matching details/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Employment context (optional)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Add optional matching details/ }));

    expect(screen.getByLabelText('Employment context (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Include veteran or military-family programs')).toBeInTheDocument();
    expect(screen.getByLabelText('Immigration legal aid')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /immigration status/i })).not.toBeInTheDocument();
    expect(screen.getByText(/does not ask whether anyone is documented/i)).toBeInTheDocument();
  });

  it('uses answers once without adding anything to the seeker profile', async () => {
    render(<OnboardingPageClient />);
    reachOptionalChoice();
    fireEvent.click(screen.getByRole('button', { name: /Skip optional questions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Use once in chat' }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/chat?from=onboarding');
    });
    expect(localStorage.getItem(SEEKER_PROFILE_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(PROFILE_PREFERENCES_STORAGE_KEY)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(ONBOARDING_CHAT_HANDOFF_KEY)).not.toBeNull();
  });

  it('saves optional answers only after the explicit profile-consent action', async () => {
    render(<OnboardingPageClient />);

    fireEvent.click(screen.getByRole('button', { name: /Food/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    fireEvent.change(screen.getByLabelText('City, county, or ZIP code (optional)'), { target: { value: 'Tacoma, WA' } });
    fireEvent.click(screen.getByRole('button', { name: /^Today/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: /^My household/ }));
    fireEvent.change(screen.getByLabelText('Number of people in the household (optional)'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /^Continue/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add optional matching details/ }));

    fireEvent.change(screen.getByLabelText('Employment context (optional)'), { target: { value: 'employed_part_time' } });
    fireEvent.change(screen.getByLabelText('Approximate monthly household income (optional)'), { target: { value: '1500_2999_monthly' } });
    fireEvent.click(screen.getByLabelText('Wheelchair access'));
    fireEvent.click(screen.getByLabelText('Include veteran or military-family programs'));
    fireEvent.click(screen.getByLabelText('Services that do not require an SSN'));
    fireEvent.click(screen.getByRole('button', { name: /Review privacy choices/ }));

    expect(localStorage.getItem(SEEKER_PROFILE_STORAGE_KEY)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Save to profile & continue/ }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/chat?from=onboarding');
    });

    const profile = JSON.parse(localStorage.getItem(SEEKER_PROFILE_STORAGE_KEY) ?? '{}');
    expect(profile).toEqual(expect.objectContaining({
      serviceInterests: ['food_assistance'],
      selfIdentifiers: [],
      veteranServicePreference: true,
      accessibilityNeeds: ['wheelchair_access'],
      documentationBarriers: ['no_ssn'],
      urgencyWindow: 'same_day',
      householdSize: 3,
      employmentStatus: 'employed_part_time',
      incomeRange: '1500_2999_monthly',
      onboardingProfileConsent: true,
      onboardingConsentVersion: 'onboarding-profile-v1',
    }));
    expect(profile.onboardingCompletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(JSON.parse(localStorage.getItem(PROFILE_PREFERENCES_STORAGE_KEY) ?? '{}')).toEqual(expect.objectContaining({
      approximateCity: 'Tacoma, WA',
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('syncs a consented profile only when cross-device sync was already enabled', async () => {
    localStorage.setItem(PROFILE_PREFERENCES_STORAGE_KEY, JSON.stringify({ serverSyncEnabled: true }));
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    render(<OnboardingPageClient />);
    reachOptionalChoice();
    fireEvent.click(screen.getByRole('button', { name: /Skip optional questions/ }));
    fireEvent.click(screen.getByRole('button', { name: /Save to profile & continue/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/profile', expect.objectContaining({ method: 'PUT' }));
      expect(pushMock).toHaveBeenCalledWith('/chat?from=onboarding');
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.seekerProfile).toEqual(expect.objectContaining({
      onboardingProfileConsent: true,
      serviceInterests: ['food_assistance'],
    }));
  });
});
