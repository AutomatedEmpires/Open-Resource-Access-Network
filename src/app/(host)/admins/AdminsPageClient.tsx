/**
 * /admins — Team Management
 *
 * Displays team members and roles for the host organization.
 * Enhanced with FormField, FormAlert, toast, and form wrapper.
 * Fetches from /api/host/admins API (requires auth integration).
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Users, Shield, UserPlus, AlertTriangle,
  Loader2, RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormField } from '@/components/ui/form-field';
import { FormAlert } from '@/components/ui/form-alert';
import { useToast } from '@/components/ui/toast';
import type { OranRole } from '@/domain/types';

// ============================================================
// TYPES
// ============================================================

type HostRole = Extract<OranRole, 'host_admin' | 'host_member'>;

interface ApiMember {
  id: string;
  user_id: string;
  organization_id: string;
  role: HostRole;
  status: string | null;
  created_at: string;
  updated_at: string | null;
}

interface TeamMember {
  id: string;
  userId: string;
  role: HostRole;
  status: 'active';
  addedAt: string;
}

type MemberAction =
  | { type: 'role'; memberId: string }
  | { type: 'remove'; memberId: string }
  | null;

interface Organization {
  id: string;
  name: string;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// ============================================================
// COMPONENT
// ============================================================

export default function AdminsPage() {
  const searchParams = useSearchParams();

  // Organization context - get from URL or fetch user's orgs
  const [organizationId, setOrganizationId] = useState<string | null>(
    searchParams.get('organizationId'),
  );
  const [userOrgs, setUserOrgs] = useState<Organization[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(true);

  // Team members state
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [memberAction, setMemberAction] = useState<MemberAction>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);

  // Confirmation dialogs for destructive / role-change actions
  const [pendingRoleChange, setPendingRoleChange] = useState<{ memberId: string; userId: string; newRole: HostRole } | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ memberId: string; userId: string } | null>(null);

  // Add-member form state — supports email or UUID
  const [inviteInputMode, setInviteInputMode] = useState<'email' | 'uuid'>('email');
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<HostRole>('host_member');
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [inviteError, setInviteError] = useState<string | null>(null);

  // Toast notifications
  const toast = useToast();

  // Fetch user's organizations on mount
  useEffect(() => {
    async function fetchOrgs() {
      try {
        const res = await fetch('/api/host/organizations');
        if (!res.ok) {
          // Auth not configured or user not logged in - use local mode
          setLoadingOrgs(false);
          return;
        }
        const data = await res.json();
        const orgs = data.results || [];
        setUserOrgs(orgs);
        // If no org selected and user has orgs, select the first one
        if (!organizationId && orgs.length > 0) {
          setOrganizationId(orgs[0].id);
        }
      } catch {
        // API not available - use local mode
      } finally {
        setLoadingOrgs(false);
      }
    }
    fetchOrgs();
  }, [organizationId]);

  // Fetch team members when organization is selected
  const fetchMembers = useCallback(async () => {
    if (!organizationId) return;

    setLoadingMembers(true);
    setMembersError(null);

    try {
      const res = await fetch(`/api/host/admins?organizationId=${organizationId}`);
      if (!res.ok) {
        if (res.status === 401) {
          setMembersError('Authentication required to view team members.');
        } else if (res.status === 403) {
          setMembersError('You do not have permission to view this team.');
        } else {
          setMembersError('Failed to load team members.');
        }
        return;
      }
      const data = await res.json();
      // Map API members to TeamMember format
      const apiMembers: ApiMember[] = data.members || [];
      setMembers(apiMembers.map((m) => ({
        id: m.id,
        userId: m.user_id,
        role: m.role as HostRole,
        status: 'active' as const,
        addedAt: m.created_at,
      })));
    } catch {
      setMembersError('Failed to connect to the server.');
    } finally {
      setLoadingMembers(false);
    }
  }, [organizationId]);

  const handleRoleChange = useCallback(async (memberId: string, role: HostRole) => {
    setMemberAction({ type: 'role', memberId });
    setMemberActionError(null);

    try {
      const res = await fetch(`/api/host/admins/${memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to update member role.');
      }

      toast.success('Role updated successfully');
      await fetchMembers();
    } catch (error) {
      setMemberActionError(error instanceof Error ? error.message : 'Failed to update member role.');
    } finally {
      setMemberAction(null);
    }
  }, [fetchMembers, toast]);

  const handleRemoveMember = useCallback(async (memberId: string) => {
    setMemberAction({ type: 'remove', memberId });
    setMemberActionError(null);

    try {
      const res = await fetch(`/api/host/admins/${memberId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? 'Failed to remove member.');
      }

      toast.success('Team member removed');
      await fetchMembers();
    } catch (error) {
      setMemberActionError(error instanceof Error ? error.message : 'Failed to remove member.');
    } finally {
      setMemberAction(null);
    }
  }, [fetchMembers, toast]);

  useEffect(() => {
    if (organizationId) {
      fetchMembers();
    }
  }, [organizationId, fetchMembers]);

  const handleAddMember = useCallback(async () => {
    const userId = inviteUserId.trim();
    const emailVal = inviteEmail.trim();

    if (inviteInputMode === 'uuid' && !isUuid(userId)) {
      setInviteError('User ID must be a UUID.');
      setInviteStatus('error');
      return;
    }
    if (inviteInputMode === 'email' && !isEmail(emailVal)) {
      setInviteError('Enter a valid email address.');
      setInviteStatus('error');
      return;
    }
    if (!organizationId) {
      setInviteError('No organization selected.');
      return;
    }

    setInviteStatus('sending');
    setInviteError(null);

    try {
      const payload: Record<string, unknown> = {
        organizationId,
        role: inviteRole,
        inviteMode: true,
      };
      if (inviteInputMode === 'uuid') {
        payload.userId = userId;
      } else {
        payload.email = emailVal;
      }

      const res = await fetch('/api/host/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setInviteError(data.error || 'Failed to send invite.');
        setInviteStatus('error');
        return;
      }

      // Refresh member list
      await fetchMembers();
      setInviteUserId('');
      setInviteEmail('');
      setInviteStatus('sent');
      toast.success('Team member invited successfully');

      // Reset status after 3s
      setTimeout(() => setInviteStatus('idle'), 3000);
    } catch {
      setInviteError('Failed to connect to the server.');
      setInviteStatus('error');
    }
  }, [inviteInputMode, inviteUserId, inviteEmail, inviteRole, organizationId, fetchMembers, toast]);

  const availableRoles: { key: HostRole; label: string; description: string }[] = [
    { key: 'host_admin', label: 'Host Admin', description: 'Full management access to organization, services, locations, and team.' },
    { key: 'host_member', label: 'Host Member', description: 'Can view and edit services and locations. Cannot manage team or billing.' },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="h-6 w-6 text-action-base" aria-hidden="true" />
            Team Management
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Manage who has access to your organization&apos;s host dashboard.
          </p>
        </div>
      </div>

      <ErrorBoundary>
        {/* Organization selector (if user has multiple orgs) */}
        {!loadingOrgs && userOrgs.length > 1 && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
            <label htmlFor="org-select" className="block text-sm font-medium text-gray-700 mb-2">
              Select Organization
            </label>
            <select
              id="org-select"
              value={organizationId || ''}
              onChange={(e) => setOrganizationId(e.target.value || null)}
              className="w-full sm:w-64 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[44px]"
            >
              {userOrgs.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Auth-gated notice - show only when no org context available */}
        {!loadingOrgs && !organizationId && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Authentication required</p>
              <p className="mt-1">
                Team management requires Microsoft Entra ID integration. Sign in and ensure
                you are a member of at least one organization to manage your team.
              </p>
            </div>
          </div>
        )}

        {/* Invite form */}
        <div className="rounded-lg border border-gray-200 bg-white p-6 mb-6">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-4">
            <UserPlus className="h-5 w-5 text-action-base" aria-hidden="true" />
            Add Team Member
          </h2>

          <p className="mb-4 text-sm text-gray-600">
            Invite a team member by email address or ORAN user ID.
          </p>

          {/* Toggle between email and UUID input modes */}
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setInviteInputMode('email')}
              className={`px-3 py-1 text-sm rounded-full ${inviteInputMode === 'email' ? 'bg-info-muted text-action-deep font-medium' : 'bg-gray-100 text-gray-600'}`}
            >
              Email
            </button>
            <button
              type="button"
              onClick={() => setInviteInputMode('uuid')}
              className={`px-3 py-1 text-sm rounded-full ${inviteInputMode === 'uuid' ? 'bg-info-muted text-action-deep font-medium' : 'bg-gray-100 text-gray-600'}`}
            >
              User ID
            </button>
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleAddMember();
            }}
            className="space-y-4"
          >
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                {inviteInputMode === 'email' ? (
                  <FormField
                    id="invite-email"
                    label="Email Address"
                    hint="The team member's email"
                    error={inviteEmail.trim() && !isEmail(inviteEmail.trim()) ? 'Enter a valid email' : undefined}
                  >
                    <input
                      id="invite-email"
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="user@example.com"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                    />
                  </FormField>
                ) : (
                  <FormField
                    id="invite-user-id"
                    label="User ID (UUID)"
                    hint="Paste the user's ORAN UUID"
                    error={inviteUserId.trim() && !isUuid(inviteUserId.trim()) ? 'Enter a valid UUID' : undefined}
                  >
                    <input
                      id="invite-user-id"
                      type="text"
                      value={inviteUserId}
                      onChange={(e) => setInviteUserId(e.target.value)}
                      placeholder="00000000-0000-0000-0000-000000000000"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-action min-h-[44px]"
                      inputMode="text"
                    />
                  </FormField>
                )}
              </div>
              <div className="w-full sm:w-48">
                <FormField id="invite-role" label="Role">
                  <select
                    id="invite-role"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as HostRole)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[44px]"
                  >
                    {availableRoles.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                </FormField>
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  disabled={inviteStatus === 'sending' || (inviteInputMode === 'uuid' ? !isUuid(inviteUserId.trim()) : !isEmail(inviteEmail.trim()))}
                  className="gap-1 min-h-[44px]"
                >
                  {inviteStatus === 'sending' ? (
                    <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Adding…</>
                  ) : (
                    'Add Member'
                  )}
                </Button>
              </div>
            </div>

            {inviteStatus === 'sent' && (
              <FormAlert
                variant="success"
                message="Team member added successfully."
                onDismiss={() => setInviteStatus('idle')}
              />
            )}
            {inviteError && (
              <FormAlert variant="error" message={inviteError} onDismiss={() => setInviteError(null)} />
            )}
          </form>
        </div>

        {/* Team members list */}
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 px-6 py-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">Team Members ({members.length})</h2>
            {organizationId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchMembers}
                disabled={loadingMembers}
                className="gap-1"
              >
                <RefreshCw className={`h-4 w-4 ${loadingMembers ? 'animate-spin' : ''}`} aria-hidden="true" />
                Refresh
              </Button>
            )}
          </div>

          {memberActionError && (
            <div className="mx-6 mt-4">
              <FormAlert
                variant="error"
                message={memberActionError}
                onDismiss={() => setMemberActionError(null)}
              />
            </div>
          )}

          {loadingMembers ? (
            <div className="p-8 text-center text-gray-500">
              <Loader2 className="mx-auto h-8 w-8 text-gray-300 mb-2 animate-spin" aria-hidden="true" />
              <p className="text-sm">Loading team members...</p>
            </div>
          ) : membersError ? (
            <div className="p-8 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-2" aria-hidden="true" />
              <p className="text-sm text-amber-700">{membersError}</p>
            </div>
          ) : members.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <Users className="mx-auto h-8 w-8 text-gray-300 mb-2" aria-hidden="true" />
              <p className="text-sm">No team members yet. Use the form above to add a collaborator.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-info-muted text-action-strong text-xs font-medium">
                      {m.userId.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{m.userId}</p>
                      <p className="text-xs text-gray-500">
                        Added {new Date(m.addedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      'bg-green-100 text-green-700'
                    }`}>
                      Active
                    </span>
                    <select
                      value={m.role}
                      onChange={(e) => setPendingRoleChange({ memberId: m.id, userId: m.userId, newRole: e.target.value as HostRole })}
                      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs min-h-[32px]"
                      aria-label={`Change role for ${m.userId}`}
                      disabled={memberAction?.memberId === m.id}
                    >
                      {availableRoles.map((r) => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-error-strong border-error-soft hover:bg-error-subtle"
                      onClick={() => setPendingRemove({ memberId: m.id, userId: m.userId })}
                      disabled={memberAction?.memberId === m.id}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Role reference */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Shield className="h-5 w-5 text-action-base" aria-hidden="true" />
            Role Reference
          </h2>
          <div className="space-y-3">
            {availableRoles.map((r) => (
              <div key={r.key} className="flex items-start gap-3">
                <span className="inline-flex items-center rounded-full bg-info-muted px-2 py-0.5 text-xs font-medium text-action-strong mt-0.5">
                  {r.label}
                </span>
                <p className="text-sm text-gray-600">{r.description}</p>
              </div>
            ))}
          </div>
        </div>
      </ErrorBoundary>

      {/* —— Role change confirmation —— */}
      <Dialog open={Boolean(pendingRoleChange)} onOpenChange={(open) => { if (!open) setPendingRoleChange(null); }}>
        {pendingRoleChange && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Change member role?</DialogTitle>
              <DialogDescription>
                Change <span className="font-mono text-xs">{pendingRoleChange.userId.slice(0, 8)}…</span> to{' '}
                <strong>{availableRoles.find((r) => r.key === pendingRoleChange.newRole)?.label}</strong>?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingRoleChange(null)}>Cancel</Button>
              <Button
                onClick={() => {
                  void handleRoleChange(pendingRoleChange.memberId, pendingRoleChange.newRole);
                  setPendingRoleChange(null);
                }}
              >
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>

      {/* —— Remove confirmation —— */}
      <Dialog open={Boolean(pendingRemove)} onOpenChange={(open) => { if (!open) setPendingRemove(null); }}>
        {pendingRemove && (
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Remove team member?</DialogTitle>
              <DialogDescription>
                Remove <span className="font-mono text-xs">{pendingRemove.userId.slice(0, 8)}…</span> from
                this organization? They will immediately lose access.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPendingRemove(null)}>Cancel</Button>
              <Button
                className="bg-error-base hover:bg-error-strong text-white"
                onClick={() => {
                  void handleRemoveMember(pendingRemove.memberId);
                  setPendingRemove(null);
                }}
              >
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
