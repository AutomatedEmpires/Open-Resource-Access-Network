// @vitest-environment jsdom

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/app/(oran-admin)/triage/TriagePageClient', () => ({
  default: () => <div>Triage Queue Workspace</div>,
}));

import TriagePage from '@/app/(oran-admin)/triage/page';

describe('oran admin triage page', () => {
  it('renders the triage workspace route', () => {
    render(<TriagePage />);

    expect(screen.getByText('Triage Queue Workspace')).toBeInTheDocument();
  });
});
