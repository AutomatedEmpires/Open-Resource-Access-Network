// @vitest-environment jsdom

import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StarRating } from '@/components/ui/star-rating';

function StarRatingHarness() {
  const [value, setValue] = useState<number | null>(null);
  return (
    <div>
      <StarRating value={value} onChange={setValue} />
      <output data-testid="selected-value">{value ?? 'none'}</output>
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe('StarRating', () => {
  it('supports click selection and keyboard navigation keys', () => {
    render(<StarRatingHarness />);

    fireEvent.click(screen.getByRole('radio', { name: '3 stars' }));
    expect(screen.getByTestId('selected-value')).toHaveTextContent('3');

    fireEvent.keyDown(screen.getByRole('radio', { name: '3 stars' }), { key: 'ArrowRight' });
    expect(screen.getByTestId('selected-value')).toHaveTextContent('4');
    expect(document.activeElement).toHaveAttribute('aria-label', '4 stars');

    fireEvent.keyDown(screen.getByRole('radio', { name: '4 stars' }), { key: 'End' });
    expect(screen.getByTestId('selected-value')).toHaveTextContent('5');

    fireEvent.keyDown(screen.getByRole('radio', { name: '5 stars' }), { key: 'ArrowLeft' });
    expect(screen.getByTestId('selected-value')).toHaveTextContent('4');

    fireEvent.keyDown(screen.getByRole('radio', { name: '4 stars' }), { key: 'Home' });
    expect(screen.getByTestId('selected-value')).toHaveTextContent('1');

    fireEvent.keyDown(screen.getByRole('radio', { name: '1 star' }), { key: 'A' });
    expect(screen.getByTestId('selected-value')).toHaveTextContent('1');
  });

  it('does not invoke onChange when disabled', () => {
    const onChange = vi.fn();
    render(<StarRating value={2} onChange={onChange} disabled />);

    fireEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    fireEvent.keyDown(screen.getByRole('radio', { name: '2 stars' }), { key: 'ArrowRight' });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows hover preview fill and resets on mouse leave', () => {
    render(<StarRating value={2} onChange={vi.fn()} />);

    const group = screen.getByRole('radiogroup', { name: 'Rating' });
    const fourthStar = screen.getByRole('radio', { name: '4 stars' });
    const fourthStarIcon = fourthStar.querySelector('svg');

    expect(fourthStarIcon).toHaveClass('text-gray-300');

    fireEvent.mouseEnter(fourthStar);
    expect(fourthStarIcon).toHaveClass('text-amber-400');

    fireEvent.mouseLeave(group);
    expect(fourthStarIcon).toHaveClass('text-gray-300');
  });
});
