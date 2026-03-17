// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const isEnabledMock = vi.hoisted(() => vi.fn());
const notFoundMock = vi.hoisted(() => vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
}));

vi.mock('@/services/flags/flags', () => ({
  flagService: {
    isEnabled: isEnabledMock,
  },
}));

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
}));

vi.mock('../dashboard/DashboardPageClient', () => ({
  __esModule: true,
  default: () => <div>dashboard-page-client</div>,
}));

describe('dashboard page feature flag gate', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('renders the dashboard page when plans, reminders, and dashboard flags are enabled', async () => {
    isEnabledMock.mockResolvedValue(true);
    const { default: DashboardPage } = await import('../dashboard/page');

    render(await DashboardPage());

    expect(screen.getByText('dashboard-page-client')).toBeInTheDocument();
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it('fails closed when the dashboard flag is disabled', async () => {
    isEnabledMock
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const { default: DashboardPage } = await import('../dashboard/page');

    await expect(DashboardPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
