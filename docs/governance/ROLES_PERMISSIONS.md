# ORAN Roles & Permissions

## Role Definitions

### `seeker`
A person looking for services. May be anonymous or authenticated. Limited to read-only access of published records.

### `host_member`
An employee or volunteer of a service-providing organization. Can edit their organization's own records and submit them for verification.

### `host_admin`
An administrator of a service-providing organization. Has full control over their organization's records, can manage host_members, and submit bulk updates.

### `community_admin`
A trusted local verifier assigned to a geographic coverage zone. Verifies records submitted by hosts, flags stale data, and provides community context.

### `oran_admin`
Platform governor. Has full access to all resources, can override verifications, manage feature flags, access audit logs, and manage coverage zone assignments.

---

## Permission Matrix

| Resource             | seeker | host_member | host_admin | community_admin | oran_admin |
|----------------------|--------|-------------|------------|-----------------|------------|
| organizations        | R      | R/W(own)    | R/W(own)   | R               | R/W        |
| locations            | R      | R/W(own)    | R/W(own)   | R               | R/W        |
| services             | R      | R/W(own)    | R/W(own)   | R               | R/W        |
| service_at_location  | R      | R/W(own)    | R/W(own)   | R               | R/W        |
| phones               | R      | R/W(own)    | R/W(own)   | R               | R/W        |
| addresses            | R      | R/W(own)    | R/W(own)   | R               | R/W        |
| schedules            | R      | R/W(own)    | R/W(own)   | R               | R/W        |
| taxonomy_terms       | R      | R           | R          | R               | R/W        |
| verification_queue   | -      | submit      | submit     | R/W(zone)       | R/W        |
| user_profiles        | R(own) | R(own)      | R(own)     | R(own)          | R/W        |
| audit_logs           | -      | -           | -          | R(zone)         | R          |
| feature_flags        | -      | -           | -          | -               | R/W        |
| coverage_zones       | R      | R           | R          | R/W(own)        | R/W        |
| confidence_scores    | R      | R           | R          | R               | R/W        |
| seeker_feedback      | W(own) | -           | -          | R(zone)         | R          |
| platform_scopes      | -      | -           | -          | -               | R/W        |
| scope_grants         | -      | -           | -          | request         | R/W/decide |
| notification_events  | R(own) | R(own)      | R(own)     | R(own)          | R          |
| notification_prefs   | R/W(own)| R/W(own)   | R/W(own)   | R/W(own)        | R/W        |

**Legend**: R = Read, W = Write, R/W = Read+Write, own = restricted to own records, zone = restricted to assigned coverage zone, submit = can create new entries

---

## Permission Details

### `read`
Can view published, verified records. Seekers always get approximate addresses (street-level, not unit/apartment).

### `write`
Can create and update records. Writes by hosts go into a pending/draft state until verified (unless auto-publish threshold is met).

### `verify`
Can mark a record as verified after reviewing evidence. Only community_admin and oran_admin have this permission.

### `approve`
Can approve host claims (organization ownership). Only oran_admin can approve new host claims; community_admin can assist with reviews.

### `audit`
Can read full audit trails including IP-stamped change history. Only oran_admin has unrestricted audit access; community_admin can view within their zone.

### `scope_grant`
Can request, approve, deny, or revoke scope grants. Scope grant decisions enforce two-person approval: the same user who requested a grant cannot approve it. Only `oran_admin` can manage platform scopes and decide on grants.

---

## Role Assignment Flow

1. New user signs up → assigned `seeker` by default
2. Host applies to claim organization → pending review → oran_admin approves → `host_admin` for that org
3. host_admin invites team members → `host_member` for that org
4. oran_admin designates community verifier → `community_admin` for a coverage zone
5. oran_admin is manually provisioned in system bootstrap

---

## Enforcement Points

- **Middleware** (`src/middleware.ts`): Route-level role enforcement via Microsoft Entra ID / NextAuth.js JWT. Uses `getToken()` + `isRoleAtLeast()` for role comparison. Returns 403 for insufficient roles, 302 redirect for unauthenticated, 503 in production if auth is misconfigured.
- **Auth guards** (`src/services/auth/guards.ts`): Pure functions for role comparison (`isRoleAtLeast`, `requireMinRole`, `requireOrgAccess`, `requireOrgRole`).
- **API handlers** (`src/app/api/*/route.ts`): Server-side session validation via `getAuthContext()` + resource-level permission checks. Returns 401/403 as appropriate. Production fail-closed via `shouldEnforceAuth()`.
- **Drizzle RLS policies** (future): Row-level security in PostgreSQL for defense in depth.
