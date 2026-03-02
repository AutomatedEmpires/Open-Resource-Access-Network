/**
 * /admins — Team Management
 *
 * Displays team members and roles for the host organization.
 * Fetches from /api/host/admins API (requires auth integration).
 * Falls back to local state if API is not available.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Users, Shield, UserPlus, AlertTriangle,
  CheckCircle, Mail, Loader2, RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
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
  email: string;
  role: HostRole;
  status: 'active' | 'invited';
  addedAt: string;
}

interface Organization {
  id: string;
  name: string;
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

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<HostRole>('host_member');
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [inviteError, setInviteError] = useState<string | null>(null);

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
        email: m.user_id, // TODO: resolve user_id to email via user lookup
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

  useEffect(() => {
    if (organizationId) {
      fetchMembers();
    }
  }, [organizationId, fetchMembers]);

  const handleInvite = useCallback(async () => {
    if (!inviteEmail.trim() || !inviteEmail.includes('@')) return;
    if (!organizationId) {
      setInviteError('No organization selected.');
      return;
    }

    setInviteStatus('sending');
    setInviteError(null);

    try {
      // NOTE: The API requires userId (UUID). In production, a user-lookup
      // service will resolve email → UUID. For now fall back to local-state
      // invite so the UI remains functional without a user-lookup endpoint.
      const res = await fetch('/api/host/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          userId: inviteEmail.trim().toLowerCase(),
          role: inviteRole,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setInviteError(data.error || 'Failed to send invite.');
        setInviteStatus('error');
        return;
      }

      // Refresh member list
      await fetchMembers();
      setInviteEmail('');
      setInviteStatus('sent');

      // Reset status after 3s
      setTimeout(() => setInviteStatus('idle'), 3000);
    } catch {
      // API not available - fall back to local state
      const newMember: TeamMember = {
        id: `local-${Date.now()}`,
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
        status: 'invited',
        addedAt: new Date().toISOString(),
      };
      setMembers((prev) => [...prev, newMember]);
      setInviteEmail('');
      setInviteStatus('sent');
      setTimeout(() => setInviteStatus('idle'), 3000);
    }
  }, [inviteEmail, inviteRole, organizationId, fetchMembers]);

  const availableRoles: { key: HostRole; label: string; description: string }[] = [
    { key: 'host_admin', label: 'Host Admin', description: 'Full management access to organization, services, locations, and team.' },
    { key: 'host_member', label: 'Host Member', description: 'Can view and edit services and locations. Cannot manage team or billing.' },
  ];

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Users className="h-6 w-6 text-blue-600" aria-hidden="true" />
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
            <UserPlus className="h-5 w-5 text-blue-600" aria-hidden="true" />
            Invite Team Member
          </h2>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label htmlFor="invite-email" className="sr-only">Email address</label>
              <input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.org"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[44px]"
                aria-label="Email address to invite"
              />
            </div>
            <div className="w-full sm:w-48">
              <label htmlFor="invite-role" className="sr-only">Role</label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as HostRole)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm min-h-[44px]"
                aria-label="Role to assign"
              >
                {availableRoles.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            </div>
            <Button
              onClick={handleInvite}
              disabled={inviteStatus === 'sending' || !inviteEmail.includes('@')}
              className="gap-1 min-h-[44px]"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              {inviteStatus === 'sending' ? 'Sending…' : 'Send Invite'}
            </Button>
          </div>

          {inviteStatus === 'sent' && (
            <div className="mt-3 flex items-center gap-2 text-sm text-green-700" role="status">
              <CheckCircle className="h-4 w-4" aria-hidden="true" />
              Invite recorded. It will activate when authentication is configured.
            </div>
          )}
          {inviteError && (
            <div className="mt-3 text-sm text-red-700" role="alert">{inviteError}</div>
          )}
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
              <p className="text-sm">No team members yet. Use the form above to invite your first collaborator.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between px-6 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-medium">
                      {m.email.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{m.email}</p>
                      <p className="text-xs text-gray-500">
                        Added {new Date(m.addedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      m.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {m.status === 'active' ? 'Active' : 'Invited'}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                      {availableRoles.find((r) => r.key === m.role)?.label ?? m.role}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Role reference */}
        <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2 mb-3">
            <Shield className="h-5 w-5 text-blue-600" aria-hidden="true" />
            Role Reference
          </h2>
          <div className="space-y-3">
            {availableRoles.map((r) => (
              <div key={r.key} className="flex items-start gap-3">
                <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 mt-0.5">
                  {r.label}
                </span>
                <p className="text-sm text-gray-600">{r.description}</p>
              </div>
            ))}
          </div>
        </div>
      </ErrorBoundary>
    </main>
  );
}
