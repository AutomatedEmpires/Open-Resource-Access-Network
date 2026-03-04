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
  }) => React.createElement('a', { href, ...props }, children),
}));
vi.mock('lucide-react', () => ({
  MessageCircle: (props: Record<string, unknown>) => React.createElement('svg', props),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children: React.ReactNode }) =>
    React.createElement('button', props, children),
}));

import { ChatBubble } from '../ChatBubble';

describe('ChatBubble', () => {
  it('uses the default chat href and fixed positioning class', () => {
    const element = ChatBubble({}) as React.ReactElement<any, any>;
    const button = React.Children.only(element.props.children) as React.ReactElement<any, any>;
    const link = React.Children.only(button.props.children) as React.ReactElement<any, any>;

    expect(element.props.className).toContain('fixed bottom-6 right-6');
    expect(button.props['aria-label']).toBe('Open chat');
    expect(link.props.href).toBe('/chat');
  });

  it('accepts custom href and className overrides', () => {
    const element = ChatBubble({
      href: '/custom-chat',
      className: 'custom-position',
    }) as React.ReactElement<any, any>;
    const button = React.Children.only(element.props.children) as React.ReactElement<any, any>;
    const link = React.Children.only(button.props.children) as React.ReactElement<any, any>;

    expect(element.props.className).toBe('custom-position');
    expect(link.props.href).toBe('/custom-chat');
  });
});
