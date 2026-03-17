// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SeekerFeatureFlagsProvider } from '@/components/seeker/SeekerFeatureFlags';

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>{children}</button>
  ),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open?: boolean }) => <div>{open ? children : children}</div>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ success: vi.fn() }),
}));

describe('AddToPlanDialog feature flag gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('fails closed when plans are disabled in seeker feature flags', async () => {
    const { AddToPlanDialog } = await import('../AddToPlanDialog');

    render(
      <SeekerFeatureFlagsProvider value={{ planEnabled: false }}>
        <AddToPlanDialog
          service={{
            serviceId: 'svc-1',
            serviceName: 'Helping Hands Pantry',
            organizationName: 'Helping Hands',
            capturedAt: new Date().toISOString(),
          }}
        />
      </SeekerFeatureFlagsProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Add to plan' })).toBeNull();
  });

  it('renders the action when plans are enabled in seeker feature flags', async () => {
    const { AddToPlanDialog } = await import('../AddToPlanDialog');

    render(
      <SeekerFeatureFlagsProvider value={{ planEnabled: true }}>
        <AddToPlanDialog
          service={{
            serviceId: 'svc-1',
            serviceName: 'Helping Hands Pantry',
            organizationName: 'Helping Hands',
            capturedAt: new Date().toISOString(),
          }}
        />
      </SeekerFeatureFlagsProvider>,
    );

    expect(screen.getAllByRole('button', { name: 'Add to plan' }).length).toBeGreaterThan(0);
  });
});
