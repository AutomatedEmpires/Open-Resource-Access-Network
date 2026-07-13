# ORAN — Agent Operating Standards

This file is binding for every human and automated contributor. ORAN is civic, safety-sensitive infrastructure. Read `docs/SSOT.md`, `docs/VISION.md`, `docs/SECURITY_PRIVACY.md`, the source registry, and the applicable contract before changing behavior.

## 1. App purpose

ORAN (Open Resource Access Network) is civic resource infrastructure for finding verified government, educational, nonprofit, and community services. It supports directory, map, and guided/chat discovery while keeping a deterministic crisis gate and retrieval path ahead of optional language-model assistance.

The system must help people find relevant services without inventing facts, leaking personal information, or confusing a directory record with real-time eligibility, availability, endorsement, or partnership.

## 2. Business vision

Create a trustworthy, accessible, low-bandwidth-tolerant public-service navigation layer with verifiable provenance and clear uncertainty. Use authoritative public sources, maintain human verification, and make source/retrieval status visible enough for operators to correct errors.

Do not scrape private or personal data. Do not imply a government, nonprofit, provider, funder, or community partnership unless the relationship is verified and documented. Allowlisting a source permits review; it does not make every record publishable.

## 3. Current rollout status

Snapshot 2026-07-12: **blocked · security-risk · no-go**. Draft convergence/security work exists, but there is no safe deployment/recovery baseline. Provider `READY` states or passing subsets of CI do not establish privacy, schema, source, rollback, or production readiness.

Refresh `main`, the current PR set, security findings, schema/ledger evidence, and provider ownership before beginning work. Do not describe ORAN as production-ready, partnership-backed, complete, or real-time unless current evidence proves the exact claim.

## 4. Branch naming rules

- Start from current `main`; never push directly to `main`.
- Agent work: `agent/<scope>-<short-description>`.
- Other work: `feat/<lane>/<slug>`, `fix/<lane>/<slug>`, `docs/<lane>/<slug>`, `security/<lane>/<slug>`, or `chore/<lane>/<slug>`, all kebab-case.
- Before editing, run `git status -sb`, record branch/HEAD, inspect open PRs/issues and agent-status docs, and identify the owned files. One owner per task/branch/artifact; do not compete with an active ingestion, schema, recovery, or security lane.
- Open a small PR against `main`. Implementing agents/builders do not merge their own PRs, force-push, rewrite history, delete unmerged branches, or overwrite another agent's work. A designated maintainer or approved automation may merge after independent review and green required checks, then delete the merged branch.

## 5. Required checks before PR

Use the repository's npm lockfile and Node 20 CI baseline.

```text
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run build:functions
git diff --check
```

Run `npm run validate:runtime` when the web runtime contract changes. Run relevant E2E, accessibility, bundle, or UI-consistency checks when those surfaces change. For Markdown-only work, `git diff --check` and focused Markdown/link review are the minimum; list skipped app checks and why.

Ingestion, source bootstrap, owner provisioning, migrations, canary/report, deployment, and provider scripts are operational commands—not routine validation. Never run them against live state to make a PR green.

## 6. Forbidden actions

- Do not deploy, promote, mutate DNS/domains, change provider configuration, rotate secrets, retire providers, or alter billing/RBAC/recovery.
- Do not run live migrations/SQL, replay ledgers, mutate live queues/resources, bulk ingest, provision owner access, or perform destructive cleanup.
- Do not scrape private/personal data, case notes, protected records, authentication material, exact client locations, or non-public contact information.
- Do not publish unverified records as fact, turn unknown domains directly into sources, bypass quarantine/human review, or let an LLM add facts after retrieval.
- Do not imply partnerships, endorsements, official status, eligibility, availability, coverage guarantees, or emergency response capability without current verified evidence.
- Do not introduce payments, advertising, fundraising, or monetization flows. Do not send real email or change production auth.
- Do not add PostHog, tracking, session replay, fingerprints, or new PII fields without an approved civic analytics/privacy policy.
- Do not self-merge or bypass independent review, delete unmerged branches, expose secrets/private data, or redesign the product outside an approved lane.

## 7. Provider no-touch zones

All write operations are prohibited without explicit owner approval for Doppler/secrets, Vercel, Supabase/Postgres/PostGIS, Azure/App Service/Functions/Maps/Application Insights/Communication Services, Microsoft Entra/NextAuth, Resend, Mailgun, DNS/registrar surfaces, Mapbox/geocoding, Sentry, and any source/API provider. This covers dashboards, CLIs, APIs, tokens, projects, environments, deployments, domains, migrations, webhooks, billing, and RBAC.

PostHog is **absent/deferred** unless and until a civic analytics policy approves purpose, consent, taxonomy, PII handling, retention, access, and budget. Do not create a project or add tracking in the meantime. Read-only provider inspection must be explicitly scoped and must record non-sensitive evidence only.

## 8. Data, money, email, and auth guardrails

### Data and sources

- Use authoritative public sources. Automated crawl candidates enter through the Source Registry; unknown domains quarantine and human verification remains mandatory.
- Every publishable record needs source/provenance fields appropriate to the contract, including agency/source, retrieval timing, and verification state. Unverified data must stay visibly unverified or unpublished.
- Minimize PII and use approximate location by default. Never ingest case notes, exact client locations, private contact data, protected records, or credentials. Use synthetic fixtures for tests.
- Live schema, migration ledger, staging/canonical/publish stores, admin review queues, and production data are no-touch without a named data owner, backup/rollback plan, and approved window.

### Money

ORAN has no product payment layer. Do not add checkout, subscriptions, fees, donations, ad targeting, payouts, refunds, or money custody without a separately approved legal/public-interest model.

### Email

Do not activate or reuse Azure Communication Email, Mailgun, Resend, domains, senders, aliases, or lists. No real sends. Protect recipient/resource contact data and never claim delivery without current evidence.

### Auth

NextAuth with Microsoft Entra ID is the current primary boundary; optional providers are feature-gated and must fail closed in production. Do not provision users/owners, weaken admin gates, add parallel auth, or modify production identity without explicit approval.

## 9. Design notes

Favor a calm, neutral, plain-language civic utility: mobile-first, keyboard/screen-reader accessible, low-bandwidth tolerant, and explicit about source, distance, uncertainty, and crisis routing. Directory, map, and chat must share the same verified resource truth rather than competing copies.

Use approximate location and progressive disclosure. Avoid dark patterns, promotional provider treatment, unverifiable badges, stigmatizing language, excessive motion, or a generic marketing redesign. Do not represent map/list presence as availability or partnership.

## 10. Current known PRs and blockers

Status last refreshed 2026-07-13 02:30 UTC (2026-07-12 America/Los_Angeles):

- PR #58, draft convergence to Vercel/Supabase: open and dirty; keep it draft and coordinate before touching its convergence/provider lane.
- PR #66, test dependency update: open and clean at refresh.
- PRs #68, #69, and #71, dependency updates: open and clean at refresh.
- PR #70, Vite/Storybook dependency update: open and blocked at refresh.
- PR #67, security/CI blocker reduction: merged to `main` as `8da2101`; it is no longer an open blocker or active lane. PRs #64 and #65 are also no longer open.

Refresh all PR states before acting. Portfolio blockers include critical/high dependency and CodeQL findings, failing ancillary gates, schema/migration-ledger authority mismatch, no safe Preview/recovery baseline, and unresolved Azure/Mailgun ownership/retention. These are no-go conditions, not invitations to perform provider or schema work from an unrelated branch.

## 11. Output format for future agents

Every handoff/final report must state:

1. branch, HEAD, issue/acceptance criteria, owner/lane, and source-of-truth citations;
2. exact files and behavior changed;
3. commands run and pass/fail/skipped results;
4. source/data/PII, provider, deployment/DNS, email, auth, analytics, and money impact—normally `none`;
5. verified facts versus inferences/unknowns, plus screenshots/accessibility evidence for UI work;
6. remaining security/privacy/schema/recovery blockers, approvals required, and rollback/escalation notes; and
7. PR URL/state or a statement that no PR was created.
