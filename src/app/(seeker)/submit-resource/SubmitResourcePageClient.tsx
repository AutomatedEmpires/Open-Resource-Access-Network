'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, CheckCircle2, FilePenLine, HeartHandshake, Send } from 'lucide-react';

import { ResourceSubmissionWorkspace } from '@/components/resource-submissions/ResourceSubmissionWorkspace';
import { Button } from '@/components/ui/button';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';

const PUBLIC_DRAFT_STORAGE_KEY = 'oran:public-resource-submission';

function LaunchCard({
  href,
  title,
  description,
  icon: Icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <Link
      href={href}
      className="group rounded-3xl border border-orange-100 bg-white/95 p-6 transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-stone-900">{title}</h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">{description}</p>
        </div>
        <div className="rounded-2xl bg-orange-50 p-3 text-orange-700">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
      <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-action-base">
        Continue
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
    </Link>
  );
}

export default function SubmitResourcePageClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [savedDraftId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const stored = window.localStorage.getItem(PUBLIC_DRAFT_STORAGE_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored) as { id?: string };
      return parsed.id ?? null;
    } catch {
      return null;
    }
  });

  const entryId = searchParams.get('entryId');
  const shouldOpenWorkspace = entryId !== null || searchParams.get('compose') === 'listing';

  const handleEntryReady = useCallback((entry: { instanceId: string }) => {
    if (entryId === entry.instanceId) return;
    router.replace(`/submit-resource?entryId=${entry.instanceId}`, { scroll: false });
  }, [entryId, router]);

  if (shouldOpenWorkspace) {
    return (
      <ResourceSubmissionWorkspace
        portal="public"
        initialVariant="listing"
        initialChannel="public"
        pageEyebrow="Community contribution"
        pageTitle="Submit a Resource"
        pageSubtitle="Share a resource through the same structured cards reviewers use, with draft save and clear completeness signals before you submit."
        entryId={entryId}
        backHref="/submit-resource"
        backLabel="Back to submission home"
        onEntryReady={handleEntryReady}
      />
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-orange-50 via-rose-50 to-emerald-50">
      <div className="container mx-auto max-w-5xl px-4 py-6 md:py-8">
      <section className="space-y-8 rounded-[30px] border border-orange-100/80 bg-white/90 p-5 shadow-[0_24px_80px_rgba(234,88,12,0.10)] backdrop-blur md:p-8">
      <PageHeader
        eyebrow="Community contribution"
        title="Submit a Resource"
        icon={<HeartHandshake className="h-6 w-6" aria-hidden="true" />}
        subtitle="Suggest a resource through one structured review flow. You will fill out the same cards community reviewers use when deciding whether to approve, edit, or return the submission."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Structured review instead of freeform email</PageHeaderBadge>
            <PageHeaderBadge tone="accent">You can save and continue before submitting</PageHeaderBadge>
            <PageHeaderBadge>Visible completeness before send</PageHeaderBadge>
          </>
        )}
        actions={(
          <Link href="/submit-resource?compose=listing">
            <Button size="sm" className="gap-1">
              <Send className="h-4 w-4" aria-hidden="true" />
              Start submission
            </Button>
          </Link>
        )}
      />

      <section className="grid gap-4 lg:grid-cols-2">
        <LaunchCard
          href="/submit-resource?compose=listing"
          title="Start a new resource suggestion"
          description="Share what the service is, who provides it, how people access it, and what evidence reviewers can use to verify it."
          icon={FilePenLine}
        />
        <div className="rounded-3xl border border-orange-100 bg-white/95 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-stone-900">What to expect</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                The cards go green as required information becomes complete. After you submit, community admins can approve, deny,
                edit and approve, or send the submission back requesting more information.
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </div>
          </div>

          <ul className="mt-5 space-y-3 text-sm text-stone-600">
            <li>Include at least one verification path: website, phone, or email.</li>
            <li>Describe where the service is offered and who it is for.</li>
            <li>Use categories and service area details so the listing can be reviewed accurately.</li>
          </ul>

          {savedDraftId && (
            <div className="mt-5 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4">
              <p className="text-sm font-medium text-amber-900">A saved submission draft is available on this device.</p>
              <Link href={`/submit-resource?entryId=${savedDraftId}`} className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-amber-900 underline underline-offset-2">
                Continue saved draft
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      </section>
      </section>
      </div>
    </main>
  );
}
