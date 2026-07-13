# ORAN — Venture Operating Contract

This contract is binding for every human and automated contributor. Before changing behavior, read `docs/SSOT.md`, `docs/VISION.md`, `docs/SECURITY_PRIVACY.md`, the source registry, and the relevant data/runtime contract. Civic usefulness requires speed **and** verifiable facts.

## Operating doctrine

Agents are expected to ship meaningful ORAN improvements, not produce endless audits. Prefer merged, tested, reviewable changes over reports. Use protected previews, synthetic records, frozen public-source fixtures, reversible branches, and isolated/dev data paths aggressively. Stop only for destructive, paid, live-money, legal, DNS, credential, ownership, MFA, or public-launch actions listed below.

For ORAN, “move fast” means shortening the path from an authoritative source to a clearly verified resource—not lowering provenance, privacy, crisis, or nonpartisan standards.

## Venture thesis

People should not need insider knowledge to find legitimate government, educational, nonprofit, and community help. ORAN can become neutral civic resource infrastructure: a shared, source-backed layer for directory, map, and guided discovery that makes provenance, freshness, and uncertainty visible.

ORAN is not a provider, case-management system, political advocacy product, emergency service, or source of medical/legal advice. Its job is to route people toward verified resources while explaining the limits of the information.

## Primary user and buyer

- **Primary user:** a person trying to locate relevant public or community resources, often on a phone, under time pressure, or with limited bandwidth.
- **Operational user:** an ORAN verifier, researcher, or outreach operator who needs to evaluate sources, correct stale records, and document evidence.
- **Potential buyer/funder:** civic organizations, grantmakers, institutions, or public-interest partners that value reliable resource infrastructure. Their partnership or endorsement must never be implied before it is documented.

The product must remain useful to a person who never creates an account and never shares precise personal information.

## What the product must become

ORAN should become:

- a canonical resource graph with authoritative source provenance, retrieval time, verification state, and freshness policy;
- a verification workflow that separates candidates, quarantined records, reviewed records, and publishable records;
- directory, map, and guided/chat experiences backed by the same verified truth;
- a stale-record system that makes re-verification, expiry, correction, and removal explicit;
- a grants and provider-outreach operating pipeline with traceable owners and outcomes;
- a calm, nonpartisan, accessible, low-bandwidth civic interface;
- a runtime that can be proved safely in protected previews before any approved public launch.

Deterministic crisis routing and retrieval must remain ahead of optional language-model assistance. A model may organize or explain retrieved facts; it may not invent new resource facts.

## Current stage

As of 2026-07-12, the portfolio has **zero real ORAN users/customers**. The repository contains substantial application, data, source, verification, and runtime work, but the public-data authority, migration ledger, provider convergence, recovery evidence, security findings, and launch posture are still being resolved across active branches.

This is a pre-user infrastructure and trust-building stage. Passing a subset of CI or showing a provider `READY` state is not proof of source accuracy, privacy, recovery, or production readiness. It also does not prevent agents from improving code, tests, source tooling, preview UX, verification workflows, or runbooks now.

Refresh `main`, open PRs, source contracts, current security findings, and runtime ownership before relying on this snapshot.

## Execution authority — act without founder approval

Within a scoped branch, agents may independently:

- fix code, tests, accessibility, security, dependency, CI, performance, and responsive-UI issues;
- improve directory, map, search, guided discovery, source display, stale-state, verification, and operator workflows;
- add authoritative public-source adapters, parsers, validation rules, provenance fields, and frozen fixtures without publishing unverified output;
- add or revise non-destructive migrations in local/dev/preview databases and prove forward/rollback behavior there;
- use synthetic resource/user records and staged copies of permissible public data;
- create static assets, docs, runbooks, grants-tracking files, provider-prospect data, outreach drafts, and validation reports;
- create protected preview deployments in already-configured non-billing lanes;
- configure or improve repository-side runtime validation while keeping missing production credentials fail-closed;
- perform non-customer internal email tests with venture-scoped test recipients;
- refactor app-local code and remove dead pre-launch paths when contracts and tests remain coherent;
- open/update a reviewable PR and address review or CI feedback.

Source research may use authoritative public websites and documented public APIs. Agents may build provider-outreach pipelines and draft one-to-one outreach; sending external outreach requires an assigned outreach task and an approved ORAN sender. A broadcast campaign remains a hard stop.

## True hard stops — founder approval required

Stop before any of the following:

- upgrading a paid provider plan or accepting a new recurring cost;
- buying a domain or performing a DNS/domain cutover;
- activating live money, creating real charges/subscriptions, or adding a real-money flow;
- destructively deleting a provider project, database, source store, queue, environment, deployment history, or other provider resource;
- running a destructive production-database migration, replay, purge, or destructive live-data cleanup;
- revoking or rotating credentials, secrets, signing keys, recovery codes, or tokens;
- transferring repository, provider, domain, or account ownership;
- making a public launch announcement or publicly representing ORAN as launched/official;
- purchasing ads, starting campaigns, or sending broadcast outreach;
- filing legal or regulatory documents for the founder, the venture, or any other entity;
- completing an action that requires MFA when the founder is unavailable.

A hard stop blocks only the external/gated action. Prepare the code, source evidence, preview, migration plan, rollback steps, launch checklist, or outreach assets so the approval is narrow and well informed.

## High-value work to prioritize

1. Strengthen authoritative source ingestion, normalization, deduplication, and provenance.
2. Make verification state and source freshness visible to both operators and users.
3. Build stale-record detection, re-verification queues, correction history, and safe unpublishing.
4. Improve nonpartisan directory/map/search UX and deterministic crisis routing.
5. Prove source-to-display contracts with fixtures, schema assertions, and end-to-end tests.
6. Build grants and provider-prospect pipelines with owners, evidence, and next actions.
7. Improve privacy minimization, approximate-location behavior, accessibility, and low-bandwidth fallbacks.
8. Close security and dependency findings without weakening fail-closed runtime behavior.
9. Make protected preview/runtime setup reproducible and observable without adding tracking pixels.

## Low-value work to avoid

- Repeating readiness, security, or source audits without fixing an issue or producing an executable next artifact.
- Adding generic AI chat, personalization, or recommendation layers before retrieval and provenance are trustworthy.
- Treating scraped quantity as progress or importing broad unverified datasets directly into publishable inventory.
- Building dashboards whose metrics are not backed by stable source/data definitions.
- Adding marketing polish, partner logos, badges, or “official” language ahead of evidence.
- Replatforming civic UX or provider architecture from an unrelated task.
- Collecting extra PII “for later,” exact location by default, or analytics without a defined civic purpose.

## Provider boundaries

Known provider surfaces include Vercel, Supabase/Postgres/PostGIS, Doppler/secrets, Azure App Service/Functions/Maps/Application Insights/Communication Services, Microsoft Entra/NextAuth, Resend, Mailgun, Mapbox/geocoding, Sentry, and source/API providers.

Agents may use established local, test, isolated, and protected-preview resources when the task requires them. Repository configuration, adapters, validation, and fail-closed preview setup are normal work. Never reveal secret values or reuse another venture's provider account, sender, project, database, or data.

Assigned agents may make reversible, non-billing provider configuration changes in established dev, preview, or production lanes when scope, least privilege, rollback, and verification are explicit. Stop only when the action crosses a listed hard stop: paid plan, live money, domain/DNS, destructive deletion, destructive production migration, credential rotation/revocation, ownership transfer, public launch/campaign, legal filing, or unavailable MFA. Bulk ingestion or publication to live stores still requires an explicitly assigned source/data lane and verification contract; preparing exact runbooks is always allowed.

**PostHog is absent/deferred.** Do not add PostHog, pixels, session replay, fingerprinting, or behavioral tracking unless a civic analytics policy first defines purpose, consent, taxonomy, PII handling, retention, access, and budget.

## Data, legal, compliance, email, auth, and money boundaries

### Sources and data

- Prefer official government, educational, nonprofit, and directly maintained provider sources; use other public sources only with explicit provenance and verification state.
- An allowlisted domain is a candidate source, not proof that each record is accurate or publishable.
- Preserve source URL/identifier, retrieval timing, verification state, and the evidence required by the applicable contract.
- Unknown domains and uncertain records remain quarantined or visibly unverified until human verification criteria are met.
- Do not scrape private/personal data, case notes, protected records, authentication material, exact client locations, or non-public contact information.
- Use approximate location and minimum necessary fields. Tests and previews use synthetic records or permissible staged public data.
- Local/dev/preview migrations must be non-destructive and evidence-backed. Destructive production schema/data work is a hard stop.

### Civic and legal claims

- Do not provide medical, legal, political, eligibility, or emergency advice.
- Do not claim real-time availability, guaranteed eligibility, coverage, official status, endorsement, or partnership unless current evidence proves it.
- Map/list presence means “resource record,” not “available now” or “ORAN partner.”
- Keep crisis language deterministic, conservative, and explicit that ORAN is not emergency response.

### Email and outreach

- Internal delivery tests may use controlled, consenting, team-owned ORAN test recipients and non-user data. Assigned reversible transactional-email configuration may proceed with test/non-user recipients; DNS activation, a public/marketing campaign, or a real-user launch remains a hard stop where applicable.
- External provider outreach requires an assigned outreach lane, approved sender, accurate identity, and one-to-one scope; never imply an existing partnership.
- Keep sender/domain work venture-scoped and protect resource/recipient contact data. Stop before a DNS change, public launch, or broadcast campaign; reversible configuration and internal/non-user delivery proof may proceed in an assigned lane.

### Auth

- NextAuth/Microsoft Entra is the current primary administrative boundary; optional providers must fail closed in production.
- Assigned reversible identity configuration and synthetic/test-user provisioning may proceed with least privilege, rollback, and authorization tests. Do not weaken administrative gates, rotate credentials, transfer ownership, or provision real users without an explicitly assigned identity lane.

### Money

ORAN has no product payment layer. Sandbox-only experiments may be built when explicitly relevant, but real checkout, subscriptions, fees, donations, ads, payouts, refunds, or money custody require a separately approved public-interest/legal model and live-money approval.

## Design notes

Favor a calm, neutral, plain-language civic utility that is mobile-first, keyboard/screen-reader accessible, and tolerant of low bandwidth. Make source, verification date, distance, uncertainty, and crisis routing legible without overwhelming the user.

Directory, map, and guided discovery must share canonical resource truth. Use approximate location and progressive disclosure. Avoid partisan framing, promotional provider ranking, stigmatizing language, unverifiable badges, dark patterns, excessive motion, tracking affordances, and generic government-site or AI-chat redesigns.

## Branch and multi-agent coordination

- Start from current `main`; never push directly to `main`.
- Agent branches: `agent/<scope>-<short-description>`.
- Other branches: `feat/<lane>/<slug>`, `fix/<lane>/<slug>`, `docs/<lane>/<slug>`, `security/<lane>/<slug>`, or `chore/<lane>/<slug>`, in kebab-case.
- Before editing, run `git status -sb`, record branch/HEAD, inspect open PRs/issues/agent status, and identify overlaps in source, ingestion, schema, recovery, or security lanes.
- One task/branch has one clear owner. Coordinate rather than overwriting another branch's source contracts, migrations, ledgers, or generated artifacts.
- Implementers do not merge their own PRs, force-push shared work, or delete unmerged branches. A designated maintainer or approved automation may merge after independent review and green required checks.

## Testing and PR requirements

Use the repository's npm lockfile and Node 20 CI baseline:

```text
npm ci
npm run lint
npm run typecheck
npm run test:coverage
npm run build
npm run build:functions
git diff --check
```

Run focused tests during iteration. Run `npm run validate:runtime` when the web runtime contract changes and `npm run validate:runtime:functions` for function runtime changes. Run relevant E2E, accessibility, bundle (`npm run check:bundle`), Storybook, or UI-consistency checks when those surfaces change.

For Markdown-only work, `git diff --check` and a focused content/link/source review are sufficient; list skipped app checks and why. Ingestion, source bootstrap, owner provisioning, migration, canary/report, and deployment scripts are operational commands—not routine validation—and must never be aimed at live state to make a PR green.

Every PR must state source/data/PII impact, verification method, runtime/provider impact, and the user/operator outcome. Include source fixtures or evidence for data-pipeline changes and screenshots/accessibility notes for UI changes.

## Definition of done

Work is done when:

- the intended user/verifier outcome works end to end, including uncertainty, empty, stale, error, and low-bandwidth states;
- new public facts trace to authoritative evidence and carry correct provenance/verification state;
- privacy minimization, crisis routing, nonpartisanship, and fail-closed boundaries remain intact;
- focused tests and all relevant required checks pass;
- no secrets, private data, unverified partnership/availability claims, tracking, real send, or live-money behavior was introduced;
- migrations and source transformations are reproducible and have rollback or forward-fix notes;
- operator docs explain verification, correction, and ownership where behavior changed;
- the PR is scoped, independently reviewable, and coordinated with overlapping lanes.

A report, passing unit test, provider status, or large imported dataset alone is not done.

## What not to overprotect at zero users

ORAN has no real users/customers to migrate. Do not use hypothetical “customer impact” to freeze pre-launch routes, schemas, test datasets, copy, source adapters, verification UX, or provider convergence code. Reversible changes that make the civic contract clearer or safer should move quickly through preview and review.

Still protect authoritative-source integrity, privacy, crisis handling, secrets, live resources, provider ownership, and public claims. Zero users reduces migration cost; it does not reduce the duty to avoid publishing harmful misinformation.

## Current known PRs and blockers

Refreshed 2026-07-13 UTC:

- Draft PR #72, `docs: add agent operating standards`, is this contract branch.
- Draft PR #58 covers Vercel/Supabase convergence and is the active provider/runtime lane. At refresh it is `DIRTY` and failing runbook-freshness, visual-regression, and Codecov patch checks; coordinate before touching its files or relying on its runtime assumptions.
- Dependabot PRs #66 and #68–#71 remain open. Treat their current check state as dynamic and refresh before dependency work.
- The former security/CI reduction PR #67 is merged and no longer an active lane.

Known pre-launch blockers include source/schema/migration-ledger authority, provider convergence/recovery proof, unresolved security/dependency findings, verified public-data coverage, operational ownership for verification/outreach, and an approved launch posture. These blockers do not prevent isolated code, test, source, preview, security, documentation, or operator-workflow improvements.

## Output format for future agents

Every final handoff must report:

1. branch, HEAD, task/acceptance criteria, owner/lane, and source-of-truth documents;
2. exact files and user/operator behavior changed;
3. commands run with pass/fail/skipped results and UI/accessibility evidence where relevant;
4. source/provenance/verification and data/PII impact;
5. provider, deployment, DNS, email, auth, analytics, money, and legal impact—state `none` explicitly where applicable;
6. verified facts versus inferences/unknowns, plus rollback/forward-fix notes and any true hard stop; and
7. PR URL/state or a statement that no PR was created.
