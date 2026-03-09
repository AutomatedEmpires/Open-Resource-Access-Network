import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { AccessDenied } from '../access-denied';
import { Badge } from '../badge';
import { Button } from '../button';
import { Skeleton, SkeletonCard, SkeletonLine } from '../skeleton';

describe('ui render components', () => {
  it('builds the access denied portal structure', () => {
    const element = AccessDenied({
      portalName: 'ORAN Admin Portal',
      requiredRole: 'oran_admin',
    });
    const inner = React.Children.only(element.props.children) as React.ReactElement<any, any>;
    const innerChildren = React.Children.toArray(inner.props.children) as React.ReactElement<any, any>[];
    const links = innerChildren.at(-1) as React.ReactElement<any, any>;
    const message = innerChildren[2] as React.ReactElement<any, any>;
    const messageChildren = React.Children.toArray(message.props.children) as React.ReactElement<any, any>[];
    const portalName = messageChildren[2] as React.ReactElement<any, any>;

    expect(inner.props.role).toBe('main');
    expect(String(portalName.props.children)).toBe('ORAN Admin Portal');
    expect(links.props.children).toHaveLength(2);
  });

  it('builds a confidence badge using the band label', () => {
    const badge = Badge({ band: 'HIGH' });

    expect(badge.props.title).toBe('High confidence');
    expect(badge.props.className).toContain('bg-green-100');
    expect(badge.props.children).toBe('High confidence');
  });

  it('builds buttons as both native buttons and slotted children', () => {
    const buttonRender = (Button as unknown as {
      render: (...args: any[]) => React.ReactElement<any, any>;
    }).render;
    const buttonElement = buttonRender(
      { children: 'Save' },
      null,
    );
    const linkElement = buttonRender(
      {
        asChild: true,
        variant: 'link',
        children: React.createElement('a', { href: '/docs' }, 'Docs'),
      },
      null,
    );

    expect(buttonElement.props.className).toContain('bg-action-base');
    expect(linkElement.type).toBeDefined();
    expect(linkElement.props.className).toContain('text-action-base');
  });

  it('builds skeleton primitives and preset compositions', () => {
    const skeleton = Skeleton({ circle: true, className: 'h-4 w-4' });
    const card = SkeletonCard({});
    const line = SkeletonLine({});

    expect(skeleton.props.className).toContain('rounded-full');
    expect(card.props.className).toContain('rounded-lg');
    expect(line.props.className).toContain('h-4');
  });
});
