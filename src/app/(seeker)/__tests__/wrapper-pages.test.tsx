// @vitest-environment jsdom

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

vi.mock('@/app/(seeker)/chat/ChatPageClient', () => ({
  default: () => <div>Chat Client</div>,
}));
vi.mock('@/app/(seeker)/map/MapPageClient', () => ({
  default: () => <div>Map Client</div>,
}));
vi.mock('@/app/(seeker)/directory/DirectoryPageClient', () => ({
  default: () => <div>Directory Client</div>,
}));
vi.mock('@/app/(seeker)/profile/ProfilePageClient', () => ({
  default: () => <div>Profile Client</div>,
}));
vi.mock('@/app/(seeker)/saved/SavedPageClient', () => ({
  default: () => <div>Saved Client</div>,
}));
vi.mock('@/components/ui/skeleton', () => ({
  SkeletonCard: () => <div aria-hidden="true" />,
}));

import ChatPage, { metadata as chatMetadata } from '@/app/(seeker)/chat/page';
import DirectoryPage, { metadata as directoryMetadata } from '@/app/(seeker)/directory/page';
import MapPage, { metadata as mapMetadata } from '@/app/(seeker)/map/page';
import ProfilePage, { metadata as profileMetadata } from '@/app/(seeker)/profile/page';
import SavedPage, { metadata as savedMetadata } from '@/app/(seeker)/saved/page';

describe('seeker wrapper pages', () => {
  it('builds the chat page wrapper and exports metadata', async () => {
    const element = ChatPage();

    const { container } = render(element);
    const results = await axe(container);

    expect(element.type).toBeDefined();
    expect(chatMetadata.title).toBe('Chat');
    expect(results).toHaveNoViolations();
  });

  it('builds the map page wrapper and exports metadata', async () => {
    const element = MapPage();

    const { container } = render(element);
    const results = await axe(container);

    expect(element.type).toBeDefined();
    expect(mapMetadata.title).toBe('Service Map');
    expect(results).toHaveNoViolations();
  });

  it('builds the directory suspense wrapper and fallback shell', async () => {
    const element = DirectoryPage() as React.ReactElement<any, any>;
    const fallback = element.props.fallback as React.ReactElement<any, any>;
    const fallbackContent = (fallback.type as () => React.ReactElement<any, any>)();
    const skeletonCards = React.Children.toArray(
      (
        React.Children.toArray(
          (React.Children.toArray(fallbackContent.props.children)[2] as React.ReactElement<any, any>).props.children,
        ) as React.ReactElement<any, any>[]
      ),
    );

    expect(element.type).toBe(React.Suspense);
    expect(directoryMetadata.title).toBe('Service Directory');
    expect(skeletonCards).toHaveLength(6);

    const { container: wrapperContainer } = render(element);
    const wrapperResults = await axe(wrapperContainer);
    expect(wrapperResults).toHaveNoViolations();

    const { container: fallbackContainer } = render(fallbackContent);
    const fallbackResults = await axe(fallbackContainer);
    expect(fallbackResults).toHaveNoViolations();
  });

  it('builds the profile page wrapper and exports metadata', async () => {
    const element = ProfilePage();

    const { container } = render(element);
    const results = await axe(container);

    expect(element.type).toBeDefined();
    expect(profileMetadata.title).toBe('My Profile');
    expect(results).toHaveNoViolations();
  });

  it('builds the saved page wrapper and exports metadata', async () => {
    const element = SavedPage();

    const { container } = render(element);
    const results = await axe(container);

    expect(element.type).toBeDefined();
    expect(savedMetadata.title).toBe('Saved Services');
    expect(results).toHaveNoViolations();
  });
});
