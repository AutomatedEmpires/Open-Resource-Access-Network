# Runbook: Account And Form Resilience

## Metadata

- Runbook ID: `RUNBOOK_ACCOUNT_AND_FORM_RESILIENCE`
- Owner role: Platform Application Lead
- Reviewers: Security Lead, Host Operations Lead
- Last reviewed (UTC): 2026-03-16
- Next review due (UTC): 2026-06-16
- Severity scope: `SEV-3 | SEV-4`

## Purpose And Scope

This runbook covers the code-backed hardening lane for public credentials registration and managed-form launch or draft creation. It exists to keep the repo honest about which complex adversarial flows are implemented today, how to validate them, and how operators should reason about regressions.

This runbook applies to:

- `POST /api/auth/register`
- `GET/POST /api/forms/instances`
- the public credentials registration surface in `src/app/auth/signin/SignInPageClient.tsx`
- the managed-form creation service in `src/services/forms/vault.ts`

This runbook does not claim that all future account-governance or MFA controls are implemented. Gaps are called out explicitly.

## Safety Constraints (Must Always Hold)

- Public registration must not create privileged roles; default self-service role remains `seeker`.
- Registration and managed-form flows must fail closed on invalid input rather than accept malformed state.
- Org-scoped or community-scoped forms must not cross tenant or coverage boundaries silently.
- Duplicate browser retries must not create uncontrolled draft fan-out for identical managed-form launches.

## Implemented Control Families

### 1. Registration normalization and uniqueness

Code-backed today:

- username and email are trimmed and normalized before duplicate checks
- phone input is normalized before duplicate checks
- whitespace-only display names are rejected
- duplicate email, username, and phone checks run before insert
- self-service users are still inserted as `seeker`

Primary implementation:

- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/register/__tests__/route.test.ts`

### 2. Registration abuse resistance

Code-backed today:

- invalid JSON bodies return `400`
- weak passwords and identity-derived passwords are rejected
- a hidden honeypot field is routed from the public sign-up UI to the API
- honeypot-marked traffic is absorbed without creating an account
- registration remains IP rate-limited

Primary implementation:

- `src/app/auth/signin/SignInPageClient.tsx`
- `src/app/api/auth/register/route.ts`
- `src/app/auth/__tests__/pages.test.tsx`
- `src/app/api/auth/register/__tests__/route.test.ts`

### 3. Managed-form scope and routing enforcement

Code-backed today:

- `host_member` minimum auth is required
- org ownership and recipient org access are enforced
- organization-scoped templates require `ownerOrganizationId`
- community-scoped templates require an active `coverageZoneId`
- direct routing to a user or organization requires an explicit `recipientRole`

Primary implementation:

- `src/app/api/forms/instances/route.ts`
- `src/services/forms/vault.ts`
- `src/app/api/forms/instances/__tests__/route.test.ts`
- `src/services/forms/__tests__/vault-core.test.ts`

### 4. Managed-form payload and attachment guardrails

Code-backed today:

- oversized `formData` payloads are rejected before draft creation
- oversized attachment manifests are rejected before draft creation
- attachment enablement, count, and MIME policies are enforced at create time
- title and notes are normalized before persistence

Primary implementation:

- `src/domain/forms.ts`
- `src/app/api/forms/instances/route.ts`
- `src/app/api/forms/instances/[id]/route.ts`

### 5. Duplicate-draft suppression for identical launches

Code-backed today:

- identical managed-form create requests take a transaction-scoped advisory lock
- the service reuses a matching still-draft instance instead of inserting another draft
- the route returns `200` with `reusedExistingDraft: true` when reuse occurs

Primary implementation:

- `src/services/forms/vault.ts`
- `src/app/api/forms/instances/route.ts`
- `src/services/forms/__tests__/vault-core.test.ts`
- `src/app/api/forms/instances/__tests__/route.test.ts`

### 6. Submission-backed review lifecycle

Code-backed today:

- managed forms remain submission-backed
- draft, submit, queue-for-review, under-review, approve, deny, return, withdraw, and archive behavior live on the shared workflow substrate
- reviewer actions require reviewer-level auth where appropriate

Primary implementation:

- `src/app/api/forms/instances/[id]/route.ts`
- `src/services/workflow/engine.ts`
- `docs/ui/FORM_FLOW_EVIDENCE_MAP.md`

## Scenario Sources Covered By This Runbook

- `docs/solutions/SIGNUP_FORMS_ADVERSARIAL_SCENARIOS_VI.md`

Use that matrix as the adversarial test library. This runbook is the operational summary of which control families are live.

## Validation Commands

Focused regression commands:

```bash
npx vitest run src/app/api/auth/register/__tests__/route.test.ts src/app/auth/__tests__/pages.test.tsx src/app/api/forms/instances/__tests__/route.test.ts src/services/forms/__tests__/vault-core.test.ts src/services/resourceSubmissions/__tests__/service.test.ts
```

Type validation:

```bash
npx tsc --noEmit
```

## Diagnosis Steps

1. If public registration is misbehaving, start with `src/app/api/auth/register/__tests__/route.test.ts`.
2. If sign-up bot filtering is suspected, verify the public UI still routes the hidden `website` field.
3. If hosts report duplicate drafts, reproduce against `POST /api/forms/instances` and confirm whether `reusedExistingDraft` returns.
4. If draft creation crosses org or zone boundaries, inspect the auth context plus `requireOrgAccess` results before changing storage-scope logic.

## Mitigation Steps

1. Revert any relaxation of schema or attachment enforcement before investigating convenience fixes.
2. Keep duplicate-draft suppression narrow: identical create payload, same actor, same still-draft state.
3. Do not broaden self-service registration into host or admin role assignment.
4. If the regression is only UI-side, preserve the server-side honeypot and validation path while repairing the form.

## Known Boundaries

Not implemented in this lane:

- required MFA or 2SV for credentials users
- first-class agency onboarding or listing-removal intake workflow
- multi-draft dedupe beyond exact same launch request

Related controls now live elsewhere in the repo:

- non-destructive account freeze and restore exists through the ORAN-admin security controls, but it is not specific to the registration or managed-form contract covered here

These belong in governance backlog work, not emergency edits to the current registration or forms contract.

## References

- `docs/solutions/SIGNUP_FORMS_ADVERSARIAL_SCENARIOS_VI.md`
- `docs/ui/FORM_FLOW_EVIDENCE_MAP.md`
- `src/app/api/admin/security/accounts/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/forms/instances/route.ts`
- `src/services/forms/vault.ts`
