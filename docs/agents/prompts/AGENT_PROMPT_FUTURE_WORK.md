# ORAN Future-Work Agent — Auth Enforcement, Team API, Soft-Delete

You are a TypeScript agent for ORAN (Open Resource Access Network). Your scope is exclusively the items below. You do NOT write SQL migration files (a separate SQL agent handles those). You do NOT build Phase 4/5 pages (a separate UI agent handles those).

## Repository Context

- Framework: Next.js 16 App Router, React 19, TypeScript strict
- Auth: Clerk middleware (`@clerk/nextjs` ^6.39) — `src/middleware.ts` gates routes
- DB: PostgreSQL + PostGIS via `pg` Pool in `src/services/db/postgres.ts`
  - `executeQuery<T>(sql, params)` — parameterized queries
  - `withTransaction<T>(fn)` — BEGIN/COMMIT/ROLLBACK wrapper
  - `isDatabaseConfigured()` — checks `DATABASE_URL`
- Validation: Zod on all API request bodies
- Rate limiting: `checkRateLimit()` from `src/services/security/rateLimit.ts`
- Telemetry: `captureException()` from `src/services/telemetry/sentry.ts`
- Domain types: `src/domain/types.ts`, constants: `src/domain/constants.ts`
- Roles: `OranRole = 'seeker' | 'host_member' | 'host_admin' | 'community_admin' | 'oran_admin'`

## Authoritative Docs (read these first)

- `docs/governance/ROLES_PERMISSIONS.md` — Permission matrix (who can do what)
- `docs/SECURITY_PRIVACY.md` — PII rules, no raw IP in logs
- `docs/governance/OPERATING_MODEL.md` — Update-on-touch rules
- `.github/copilot-instructions.md` — Non-negotiables (crisis gate, no hallucination, privacy-first)

## Task 1: Auth Enforcement on Host API Routes (CRITICAL)

Currently, all 7 host API routes rely solely on Clerk middleware for auth. They have NO per-user ownership scoping — any authenticated user can CRUD any organization. Fix this.

### Files to modify:
- `src/app/api/host/claim/route.ts`
- `src/app/api/host/organizations/route.ts`
- `src/app/api/host/organizations/[id]/route.ts`
- `src/app/api/host/services/route.ts`
- `src/app/api/host/services/[id]/route.ts`
- `src/app/api/host/locations/route.ts`
- `src/app/api/host/locations/[id]/route.ts`

### Implementation:

1. **Create `src/services/auth/session.ts`** — Helper to extract the authenticated user:
   ```ts
   import { auth } from '@clerk/nextjs/server';

   export interface AuthContext {
     userId: string;      // Clerk user ID (pseudonymous)
     role: OranRole;      // From user metadata or organization_members table
     orgIds: string[];    // Organization IDs this user is a member of
   }

   export async function getAuthContext(): Promise<AuthContext | null> { ... }
   ```
   - Use `auth()` from Clerk to get the session
   - Look up the user's role and org memberships from the `organization_members` table (created by the SQL agent — table may not exist yet, so gracefully handle that case)
   - If no DB table yet, fall back to Clerk's `publicMetadata.role` or default to `'seeker'`

2. **Create `src/services/auth/guards.ts`** — Route-level authorization checks:
   ```ts
   export function requireRole(ctx: AuthContext, ...roles: OranRole[]): boolean
   export function requireOrgAccess(ctx: AuthContext, orgId: string): boolean
   ```

3. **Apply to every host route**:
   - GET list endpoints: filter results to only the user's organizations (`WHERE organization_id IN (user's orgIds)`)
   - POST create: verify user has `host_admin` role for the target org
   - PUT/DELETE: verify user owns the org that contains the resource
   - Return 401 if not authenticated, 403 if authenticated but not authorized
   - `oran_admin` bypasses all ownership checks (can CRUD anything)

4. **Update claim route**: Replace the SHA-256 IP hash in `submitted_by_user_id` with the actual Clerk user ID when available.

### Pattern to follow:
```ts
const authCtx = await getAuthContext();
if (!authCtx) {
  return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
}
if (!requireRole(authCtx, 'host_admin', 'host_member', 'oran_admin')) {
  return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
}
// For org-scoped resources:
if (!requireOrgAccess(authCtx, orgId) && !requireRole(authCtx, 'oran_admin')) {
  return NextResponse.json({ error: 'Access denied' }, { status: 403 });
}
```

## Task 2: Team Management API (`/api/host/admins`)

The `/admins` page exists (`src/app/(host)/admins/page.tsx`) but uses local state. Wire it to the database.

### Create:
- `src/app/api/host/admins/route.ts` — GET (list members for user's org), POST (invite member)
- `src/app/api/host/admins/[id]/route.ts` — PUT (change role), DELETE (remove member)

### Database table: `organization_members`
The SQL agent is creating this table with columns:
- `id` UUID PK
- `organization_id` UUID FK → organizations
- `user_id` TEXT (Entra/Clerk ID)
- `role` TEXT ('host_member' | 'host_admin')
- `status` TEXT ('invited' | 'active' | 'deactivated')
- `invited_by_user_id` TEXT
- `invited_at` TIMESTAMPTZ
- `activated_at` TIMESTAMPTZ
- Standard audit fields

### Auth rules:
- Only `host_admin` of the same org can invite/remove/change roles
- `oran_admin` can manage any org's team
- Cannot remove the last `host_admin` from an org

### Update the UI page:
- Modify `src/app/(host)/admins/page.tsx` to fetch from `/api/host/admins` instead of local state
- Wire the invite form to POST
- Add remove/role-change functionality

## Task 3: Soft-Delete Implementation

`docs/DATA_MODEL.md` specifies: "Records are marked status='defunct' rather than hard-deleted to preserve audit history."

Currently all DELETE handlers do hard deletes. Change to soft-delete:

### For organizations:
- The SQL agent will add `status` column if missing. Use `status = 'defunct'` for deleted orgs.
- Change DELETE to: `UPDATE organizations SET status = 'defunct', updated_at = now() WHERE id = $1`
- Filter all GET queries to exclude `WHERE status != 'defunct'` (or `WHERE status = 'active'`)
- Return 200 with `{ archived: true }` instead of `{ deleted: true }`

### For services:
- Already has `status` column with 'defunct' value in CHECK constraint
- Change DELETE to: `UPDATE services SET status = 'defunct' WHERE id = $1`

### For locations:
- SQL agent may add `status` column. If not present, add `status TEXT DEFAULT 'active'` (coordinate with SQL agent on this)
- Same soft-delete pattern

### For organization_members:
- Use `status = 'deactivated'` instead of hard delete

## Validation Requirements

After completing all changes:
1. `npx tsc --noEmit` — 0 errors (excluding `src/agents`)
2. `npm run lint` — clean
3. `npm run test` — all tests pass
4. Write tests for the new auth helpers in `src/services/auth/__tests__/`

## Update-on-Touch Rules

After making changes, update:
- `docs/ENGINEERING_LOG.md` — append entry with UTC timestamp
- `src/app/api/README.md` — add `/api/host/admins` endpoint
- `docs/ui/UI_SURFACE_MAP.md` — update `/admins` hierarchy if UI changes

## DO NOT

- Write SQL migration files (the SQL agent does that)
- Build Phase 4 or Phase 5 pages (the UI agent does that)
- Modify `src/middleware.ts` (Clerk middleware config is settled)
- Add new npm dependencies without justification
- Store raw PII in logs or telemetry
- Break any existing 179 tests
