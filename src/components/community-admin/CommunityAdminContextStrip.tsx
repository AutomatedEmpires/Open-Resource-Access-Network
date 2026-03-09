'use client';

import React from 'react';
import Link from 'next/link';
import { ClipboardList, Clock3, Globe2, ShieldCheck } from 'lucide-react';

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

export default function CommunityAdminContextStrip() {
  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-page)]/80">
      <div className="container mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <ContextChip
            icon={<ShieldCheck className="h-3.5 w-3.5" />}
            title="Community review decisions shape the verified inventory residents see."
          >
            Community review shapes trusted records
          </ContextChip>
          <ContextChip icon={<ClipboardList className="h-3.5 w-3.5" />} href="/queue">
            Queue assignments stay reviewer-scoped
          </ContextChip>
          <ContextChip icon={<Clock3 className="h-3.5 w-3.5" />} href="/queue">
            SLA pressure stays visible across the queue
          </ContextChip>
          <ContextChip icon={<Globe2 className="h-3.5 w-3.5" />} href="/coverage">
            Coverage trends guide zone operations
          </ContextChip>
        </div>

        <Link href="/verify" className="text-xs font-medium text-blue-700 hover:underline">
          Open the active verification workspace
        </Link>
      </div>
    </div>
  );
}
