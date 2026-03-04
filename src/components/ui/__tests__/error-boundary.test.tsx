import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../error-boundary';

vi.mock('lucide-react', () => ({
  AlertTriangle: (props: Record<string, unknown>) => React.createElement('svg', props),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('button', props, children),
}));

describe('ErrorBoundary', () => {
  it('renders children while no error has occurred', () => {
    const boundary = new ErrorBoundary({ children: 'Child' });

    expect(boundary.render()).toBe('Child');
  });

  it('switches to error state via getDerivedStateFromError', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ hasError: true });
  });

  it('renders a custom fallback when provided', () => {
    const fallback = React.createElement('div', {}, 'Fallback');
    const boundary = new ErrorBoundary({ children: 'Child', fallback });
    boundary.state = { hasError: true };

    expect(boundary.render()).toBe(fallback);
  });

  it('renders the default recovery UI and resets on retry', () => {
    const boundary = new ErrorBoundary({ children: 'Child' });
    boundary.state = { hasError: true };
    boundary.setState = vi.fn((nextState: unknown) => {
      boundary.state = { ...boundary.state, ...(nextState as object) };
    }) as never;

    const rendered = boundary.render() as React.ReactElement<any, any>;
    const children = React.Children.toArray(rendered.props.children) as React.ReactElement<any, any>[];
    const retryButton = children[2] as React.ReactElement<any, any>;

    expect(rendered.props.role).toBe('alert');
    expect(children[1].props.children[0].props.children).toBe('Something went wrong');
    retryButton.props.onClick();
    expect(boundary.state.hasError).toBe(false);
  });

  it('logs caught render errors', () => {
    const boundary = new ErrorBoundary({ children: 'Child' });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    boundary.componentDidCatch(new Error('boom'), { componentStack: 'stack' } as React.ErrorInfo);

    expect(errorSpy).toHaveBeenCalledWith('[ORAN ErrorBoundary]', expect.any(Error), 'stack');
    errorSpy.mockRestore();
  });
});
