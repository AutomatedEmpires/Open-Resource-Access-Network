// @vitest-environment jsdom

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton, SkeletonCard } from '@/components/ui/skeleton';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

describe('a11y: UI primitives', () => {
  it('Button variants have no axe violations', async () => {
    const { container } = render(
      <div>
        <Button>Default</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="crisis">Crisis</Button>
        <Button size="icon" aria-label="Icon action">
          +
        </Button>
      </div>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('Badge confidence bands have no axe violations', async () => {
    const { container } = render(
      <div>
        <Badge band="HIGH">Trust: High</Badge>
        <Badge band="LIKELY">Trust: Likely</Badge>
        <Badge band="POSSIBLE">Trust: Possible</Badge>
      </div>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('Skeleton compositions have no axe violations', async () => {
    const { container } = render(
      <div>
        <Skeleton className="h-4 w-32" />
        <SkeletonCard />
      </div>,
    );

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('ErrorBoundary fallback has no axe violations', async () => {
    function Boom(): React.JSX.Element {
      throw new Error('render failed');
    }

    const { container } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('Dialog open state has no axe violations', async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Dialog title</DialogTitle>
          <DialogDescription>Dialog description</DialogDescription>
          <div>Dialog body</div>
        </DialogContent>
      </Dialog>,
    );

    const results = await axe(document.body);
    expect(results).toHaveNoViolations();
  });
});
