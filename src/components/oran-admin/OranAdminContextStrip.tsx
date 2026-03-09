'use client';

import React from 'react';
import Link from 'next/link';
import { BookOpen, ShieldCheck, ShieldEllipsis, Workflow } from 'lucide-react';

function ContextChip({
  icon,
  children,
  href,
  title,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  href?: string;
  title?: string;
}) {
  const className = 'inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-medium text-gray-700 shadow-sm';

  if (href) {
    return (
      <Link href={href} className={`${className} hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800`} title={title}>
        <span className="text-gray-500" aria-hidden="true">{icon}</span>
        <span>{children}</span>
      </Link>
    );
  }

  return (
    <span className={className} title={title}>
      <span className="text-gray-500" aria-hidden="true">{icon}</span>
      <span>{children}</span>
    </span>
  );
}

export default function OranAdminContextStrip() {
  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-page)]/80">
      <div className="container mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <ContextChip
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            title="Platform governance actions affect trust, routing, and portal access across ORAN."
          >
            Governance changes affect every portal
          </ContextChip>
          <ContextChip icon={<ShieldEllipsis className="h-3.5 w-3.5" />} href="/scopes">
            Sensitive access stays approval-aware
          </ContextChip>
          <ContextChip icon={<Workflow className="h-3.5 w-3.5" />} href="/triage">
            Escalations and triage stay review-aware
          </ContextChip>
          <ContextChip icon={<BookOpen className="h-3.5 w-3.5" />} href="/templates">
            Platform guidance propagates from shared templates
          </ContextChip>
        </div>

        <Link href="/audit" className="text-xs font-medium text-blue-700 hover:underline">
          Review the platform audit trail
        </Link>
      </div>
    </div>
  );
}
