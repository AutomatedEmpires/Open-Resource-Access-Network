'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Building2, CheckCircle2, Loader2, Mail, ShieldCheck, UserRound, XCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { formatDate } from '@/lib/format';

interface PendingInvite {
  id: string;
  organization_id: string;
  organization_name: string;
  role: 'host_member' | 'host_admin';
  status: string | null;
  created_at: string;
  updated_at: string | null;
}

type InviteActionState = {
  membershipId: string;
  action: 'accept' | 'decline';
} | null;

const ROLE_COPY: Record<PendingInvite['role'], { label: string; description: string; icon: React.ElementType }> = {
  host_admin: {
    label: 'Host Admin',
    description: 'Manage the organization, listings, and team access.',
    icon: ShieldCheck,
  },
  host_member: {
    label: 'Host Member',
    description: 'Help manage services and locations without team administration.',
    icon: UserRound,
  },
};

export default function InvitationsPageClient() {
  const [invites, setInvites] = useState<PendingInvite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<InviteActionState>(null);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  const loadInvites = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/host/admins/invites', {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Failed to load invitations.');
      }

      const json = (await res.json()) as { invites: PendingInvite[] };
      setInvites(json.invites ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load invitations.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvites();
  }, [loadInvites]);

  const handleDecision = useCallback(async (membershipId: string, action: 'accept' | 'decline') => {
    setActionState({ membershipId, action });
    setResult(null);

    try {
      const res = await fetch('/api/host/admins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ membershipId, action }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to ${action} invite.`);
      }

      setResult({
        success: true,
        message: action === 'accept'
          ? 'Invitation accepted. You can now use the host portal for this organization.'
          : 'Invitation declined.',
      });
      await loadInvites();
    } catch (decisionError) {
      setResult({
        success: false,
        message: decisionError instanceof Error ? decisionError.message : `Failed to ${action} invite.`,
      });
    } finally {
      setActionState(null);
    }
  }, [loadInvites]);

  return (
    <main className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mb-4">
        <Link href="/profile" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to profile
        </Link>
      </div>

      <PageHeader
        eyebrow="Organization access"
        title="Organization Invitations"
        icon={<Mail className="h-6 w-6" aria-hidden="true" />}
        subtitle="Review and respond to pending invitations to join an organization's host workspace."
        badges={(
          <>
            <PageHeaderBadge tone="trust">Verified organization access</PageHeaderBadge>
            <PageHeaderBadge tone="accent">Account-scoped decisions</PageHeaderBadge>
            <PageHeaderBadge>{invites.length > 0 ? `${invites.length} pending` : 'No pending invites'}</PageHeaderBadge>
          </>
        )}
      />

      {result && (
        <div className="mb-4">
          <FormAlert
            variant={result.success ? 'success' : 'error'}
            message={result.message}
            onDismiss={() => setResult(null)}
          />
        </div>
      )}

      <ErrorBoundary>
        {error && !isLoading && (
          <FormAlert variant="error" message={error} onDismiss={() => setError(null)} className="mb-4" />
        )}

        <FormSection
          title="Pending invitations"
          description="Accept only organizations you recognize. Decisions change your access to host workflows, not the public seeker surface."
        >
          {isLoading ? (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-500 flex items-center gap-2" role="status" aria-busy="true">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading invitations…
            </div>
          ) : invites.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" aria-hidden="true" />
              <p className="font-medium text-gray-900">No pending invitations</p>
              <p className="mt-1 text-sm text-gray-500">
                When an organization invites you to collaborate, it will appear here.
              </p>
            </div>
          ) : (
            <section aria-label="Pending organization invitations" className="space-y-4">
              {invites.map((invite) => {
                const roleCopy = ROLE_COPY[invite.role];
                const RoleIcon = roleCopy.icon;
                const isActing = actionState?.membershipId === invite.id;

                return (
                  <article key={invite.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-gray-900">
                          <Building2 className="h-5 w-5 text-action-base" aria-hidden="true" />
                          <h2 className="text-lg font-semibold truncate">{invite.organization_name}</h2>
                        </div>
                        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-700">
                          <RoleIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          {roleCopy.label}
                        </div>
                        <p className="mt-2 text-sm text-gray-600">{roleCopy.description}</p>
                        <p className="mt-3 text-xs text-gray-500">
                          Invited on {formatDate(invite.created_at)}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 sm:w-44">
                        <Button
                          type="button"
                          onClick={() => void handleDecision(invite.id, 'accept')}
                          disabled={isActing}
                          className="gap-2"
                        >
                          {isActing && actionState?.action === 'accept' ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          )}
                          Accept
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleDecision(invite.id, 'decline')}
                          disabled={isActing}
                          className="gap-2"
                        >
                          {isActing && actionState?.action === 'decline' ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <XCircle className="h-4 w-4" aria-hidden="true" />
                          )}
                          Decline
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        </FormSection>
      </ErrorBoundary>
    </main>
  );
}
