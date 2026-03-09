// @vitest-environment jsdom

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { CoTagSuggestionPanel } from '@/components/resource-submissions/CoTagSuggestionPanel';

describe('CoTagSuggestionPanel', () => {
  beforeEach(() => {
    cleanup();
  });

  it('returns null when no categories are selected', () => {
    const { container } = render(
      <CoTagSuggestionPanel
        selectedCategories={[]}
        customTerms={[]}
        onAddTag={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('renders grouped suggestions and adds a selected tag', () => {
    const onAddTag = vi.fn();
    render(
      <CoTagSuggestionPanel
        selectedCategories={['food']}
        customTerms={[]}
        onAddTag={onAddTag}
      />,
    );

    expect(screen.getByRole('region', { name: 'Suggested attribute tags' })).toBeInTheDocument();
    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add tag: Free' }));
    expect(onAddTag).toHaveBeenCalledWith(expect.arrayContaining(['free']));
  });

  it('disables add actions in read-only mode and marks existing tags', () => {
    const onAddTag = vi.fn();
    render(
      <CoTagSuggestionPanel
        selectedCategories={['food']}
        customTerms={['free']}
        onAddTag={onAddTag}
        readOnly
      />,
    );

    expect(screen.getByRole('button', { name: /Free — already added/i })).toBeDisabled();
    for (const button of screen.getAllByRole('button', { name: /Add tag:/i })) {
      expect(button).toBeDisabled();
    }
    expect(screen.queryByText(/Click any chip to add it/i)).not.toBeInTheDocument();
    expect(onAddTag).not.toHaveBeenCalled();
  });
});
