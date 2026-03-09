'use client';

/**
 * OrgProfileCard — compact org identity snippet.
 *
 * Shown inside seeker-facing listing cards (map popups, chat results,
 * directory rows) to give instant provider context without navigating away.
 *
 * Size variants:
 *   sm   — logo + name + verified chip (used in compact map popups)
 *   md   — sm + mission snippet + region (default)
 *   lg   — md + whoWeServe + social links (used in directory detail view)
 */

import React from 'react';
import { Award, Globe, MapPin } from 'lucide-react';

export interface OrgProfileSnippet {
  id: string;
  name: string;
  logoUrl?: string | null;
  missionStatement?: string | null;
  whoWeServe?: string | null;
  serviceRegion?: string | null;
  verifiedAt?: string | null;
  url?: string | null;
  email?: string | null;
}

export type OrgProfileCardSize = 'sm' | 'md' | 'lg';

interface OrgProfileCardProps {
  org: OrgProfileSnippet;
  size?: OrgProfileCardSize;
  className?: string;
}

function VerifiedChip() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 leading-none"
      title="Verified Provider — this organization has been reviewed and confirmed by ORAN."
    >
      <Award className="h-3 w-3" aria-hidden="true" />
      Verified
    </span>
  );
}

function OrgLogo({ logoUrl, name, size }: { logoUrl?: string | null; name: string; size: OrgProfileCardSize }) {
  const dim = size === 'sm' ? 'h-8 w-8' : size === 'md' ? 'h-10 w-10' : 'h-14 w-14';
  const text = size === 'sm' ? 'text-sm' : 'text-base';

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={`${name} logo`}
        className={`${dim} rounded-lg object-contain border border-gray-100 bg-gray-50 shrink-0`}
        onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
      />
    );
  }

  // Fallback: initial letters
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div
      className={`${dim} rounded-lg bg-gradient-to-br from-action/20 to-action/10 border border-action/20 flex items-center justify-center shrink-0 font-bold text-action ${text}`}
      aria-hidden="true"
    >
      {initials}
    </div>
  );
}

export function OrgProfileCard({ org, size = 'md', className = '' }: OrgProfileCardProps) {
  const isVerified = Boolean(org.verifiedAt);

  const missionSnippet = org.missionStatement
    ? org.missionStatement.length > 120
      ? org.missionStatement.slice(0, 117) + '…'
      : org.missionStatement
    : null;

  const whoSnippet = org.whoWeServe
    ? org.whoWeServe.length > 100
      ? org.whoWeServe.slice(0, 97) + '…'
      : org.whoWeServe
    : null;

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white overflow-hidden ${className}`}
      role="region"
      aria-label={`${org.name} organization profile`}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 p-3">
        <OrgLogo logoUrl={org.logoUrl} name={org.name} size={size} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{org.name}</span>
            {isVerified && <VerifiedChip />}
          </div>
          {size !== 'sm' && org.serviceRegion && (
            <div className="flex items-center gap-1 mt-0.5 text-xs text-gray-500">
              <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{org.serviceRegion}</span>
            </div>
          )}
          {size === 'sm' && org.url && (
            <a
              href={org.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 mt-0.5 text-xs text-action-base hover:underline"
            >
              <Globe className="h-3 w-3" aria-hidden="true" />
              Website
            </a>
          )}
        </div>
      </div>

      {/* Mission snippet (md+) */}
      {size !== 'sm' && missionSnippet && (
        <div className="px-3 pb-3 -mt-1">
          <p className="text-xs text-gray-600 leading-relaxed">{missionSnippet}</p>
        </div>
      )}

      {/* Who we serve (lg only) */}
      {size === 'lg' && whoSnippet && (
        <div className="px-3 pb-3 border-t border-gray-100 pt-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Who we serve</p>
          <p className="text-xs text-gray-600 leading-relaxed">{whoSnippet}</p>
        </div>
      )}

      {/* Footer links (md+) */}
      {size !== 'sm' && (org.url || org.email) && (
        <div className="flex items-center gap-3 px-3 py-2 border-t border-gray-100 bg-gray-50/50">
          {org.url && (
            <a
              href={org.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-action-base hover:underline"
            >
              <Globe className="h-3 w-3" aria-hidden="true" />
              Website
            </a>
          )}
          {org.email && (
            <a
              href={`mailto:${org.email}`}
              className="flex items-center gap-1 text-xs text-action-base hover:underline"
            >
              Contact
            </a>
          )}
        </div>
      )}
    </div>
  );
}
