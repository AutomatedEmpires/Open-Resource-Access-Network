// @vitest-environment jsdom

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/app/(oran-admin)/templates/TemplatesPageClient', () => ({
  default: () => <div>Templates Workspace</div>,
}));

import TemplatesPage from '@/app/(oran-admin)/templates/page';

describe('oran admin templates page', () => {
  it('renders the templates workspace route', () => {
    render(<TemplatesPage />);

    expect(screen.getByText('Templates Workspace')).toBeInTheDocument();
  });
});
