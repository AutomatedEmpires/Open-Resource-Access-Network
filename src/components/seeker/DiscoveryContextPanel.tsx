'use client';

import React from 'react';

import type { DiscoveryLinkState } from '@/services/search/discovery';
import {
  hasMeaningfulDiscoveryContext,
  summarizeDiscoveryContext,
} from '@/services/search/discoveryPresentation';

interface DiscoveryContextPanelProps {
  discoveryContext: DiscoveryLinkState | null | undefined;
  taxonomyLabelById?: Record<string, string>;
  title?: string;
  description?: React.ReactNode;
  className?: string;
}

export function DiscoveryContextPanel({
  discoveryContext,
  taxonomyLabelById,
  title = 'Current search scope',
  description,
  className = '',
}: DiscoveryContextPanelProps) {
  if (!hasMeaningfulDiscoveryContext(discoveryContext)) {
    return null;
  }

  const chips = summarizeDiscoveryContext(discoveryContext, {
    taxonomyLabelById,
    includeSort: true,
  });

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className={`rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-left ${className}`.trim()}>
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-900">
        {title}
      </p>
      {description ? (
        <div className="mt-1 text-sm text-blue-900">
          {description}
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {chips.map((chip) => (
          <span
            key={chip.key}
            className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-blue-900"
          >
            {chip.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default DiscoveryContextPanel;
