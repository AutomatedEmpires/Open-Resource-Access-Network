# Footer Pages — Master Plan

**Created**: 2026-03-06
**Status**: Stubs deployed · Pages pending
**Route group**: `src/app/(public)/` — all pages use `AppNav` + `AppFooter`

---

## Role Scoping Audit

### Enforcement architecture

The footer is a **display layer** only. Privileged links are surfaced based on session role
but the underlying pages enforce access independently through their own layout shells.
No footer link bypasses an auth gate — every protected route is gated twice: once in
the footer (not shown until the correct role is detected) and once at the destination layout.

| Footer variant | Session state | Trigger |
|---|---|---|
| `public` | Unauthenticated or loading | `session === null` OR `role === undefined` OR `role === 'seeker'` |
| `host` | Authenticated host | `role === 'host_member'` or `'host_admin'` |
| `community_admin` | Authenticated community admin | `role === 'community_admin'` |
| `oran_admin` | Authenticated platform admin | `role === 'oran_admin'` |

### Loading state behavior

`useSession()` returns `{ data: null, status: 'loading' }` while the session resolves.
`session?.user?.role` evaluates to `undefined` → `getFooterVariant(undefined)` → `'public'`.
There is **no flash of elevated links** while the session loads. ✓

### Type safety

`src/types/next-auth.d.ts` augments `Session.user.role: OranRole` (non-optional when session
is present). The optional chain `session?.user?.role` in `AppFooter` is the only path to
`undefined` and it only occurs when `session` itself is `null`. The `as OranRole | undefined`
cast is therefore correct and no invalid role string can reach `getFooterVariant`. ✓

### Known stub behavior

`footerConfig.ts` — "Get Involved" column routes `/partnerships`, `/donate`, `/volunteer`
all to `/partnerships` as a single landing page for now. Once subpages exist, split into
their own routes. Tracked below under Phase 2 — Partnerships.

---

## Pages Overview

### Scope

| Route | Title | Audience | Priority | Status |
|---|---|---|---|---|
| `/about` | About ORAN | Public | P1 | **Built** |
| `/privacy` | Privacy Policy | Public | P1 (legal) | Stub — pending legal review |
| `/terms` | Terms of Use | Public | P1 (legal) | Stub — pending legal review |
| `/accessibility` | Accessibility Statement | Public | P1 (legal/compliance) | **Built** |
| `/contact` | Contact | Public | P2 | Stub — needs API + email infra |
| `/status` | System Status | Public | P2 | **Built** (static Option B) |
| `/security` | Security Policy | Public | P2 | **Built** |
| `/partnerships` | Partnerships & Get Involved | Public | P2 | Stub (multi-CTA) |

All pages live in `src/app/(public)/[route]/page.tsx`.
All share `src/app/(public)/layout.tsx` (AppNav + AppFooter, flex full-height).

---

## Phase 1 — Legal & Compliance (P1)

Must ship before any real end-user traffic or partnership agreements.

---

### 1A. `/privacy` — Privacy Policy

**Purpose**: GDPR/CCPA baseline disclosure. Required for any app that touches location data or
creates user accounts. Platforms without a published policy are disqualified from app stores,
government data sharing agreements, and most nonprofit partnerships.

**Content sections**

1. **What we collect** — location data (approximate by default; precision level depends on consent
   granted), session identifiers, submitted service feedback, optional profile fields (display name,
   city, locale preference), and usage patterns for platform improvement
2. **Data collection scope** — collection is designed around service matching and platform integrity;
   scope may evolve as the platform grows; full details will be documented in the published policy
3. **How we use it** — service matching, fraud prevention, platform integrity, aggregated analytics;
   additional use cases will be described in the published policy
4. **Storage & retention** — PostgreSQL (Azure); retention periods and anonymization windows to be
   defined in the published policy; user-initiated deletion request available at `/contact`
5. **Third parties** — Sentry (anonymized error traces; no PII), Microsoft Entra ID (auth only),
   Azure Application Insights (infrastructure telemetry); third-party data-sharing arrangements
   will be disclosed as required by applicable law
6. **Your rights** — data export request, deletion request, correction request
   → Contact form at `/contact` or email listed on page
7. **Cookies** — session-only NextAuth cookie; no persistent tracking cookies
8. **Children** — platform is 13+; COPPA compliance note
9. **Updates** — versioned with ISO dates; material changes emailed to registered users
10. **Contact** — DPA contact info

**Implementation notes**

- Static content; no DB queries needed
- Add `lastUpdated` date constant at top of file, displayed prominently
- Include version number (e.g. `v1.0 — 2026-03-06`)
- Link to `/contact` for data subject requests
- **Legal review required** before publish — data monetization strategy and corporate structure
  (nonprofit / for-profit parent) are not yet finalized; the published policy must accurately
  reflect the structure in place at launch; do not make forward-looking commitments on data use
  until reviewed by counsel

---

### 1B. `/terms` — Terms of Use

**Purpose**: Governs user conduct, service accuracy disclaimers, and platform liability.
Required before accepting user-generated content (service submissions, reports, feedback).

**Content sections**

1. **Acceptance** — using the platform constitutes agreement
2. **Eligibility** — 13+ to create an account
3. **Service accuracy disclaimer** — ORAN provides best-effort verified information;
   always confirm with the provider before acting on it
4. **Eligibility caution** — "may qualify" language; ORAN does not guarantee eligibility
5. **Prohibited conduct** — submitting false/misleading service data, scraping, impersonation,
   circumventing access controls
6. **User-generated content** — service submissions, feedback ratings, verification evidence
   → user grants ORAN license to publish; user warrants accuracy
7. **Crisis disclaimer** — ORAN is not a substitute for emergency services; call 911/988/211
8. **Intellectual property** — platform is open source (link to GitHub + license);
   service data is open under CC0 where applicable
9. **Limitation of liability** — boilerplate
10. **Governing law** — [jurisdiction TBD by legal review]
11. **Updates** — versioned; continued use = acceptance

**Implementation notes**

- Static content
- Add version + effective date
- Legal review required before final publish

---

### 1C. `/accessibility` — Accessibility Statement

**Purpose**: Required by WCAG 2.1 for any public-sector-adjacent service platform. Establishes
trust with disability advocacy organizations and government procurement reviewers.

**Content sections**

1. **Conformance target** — WCAG 2.1 Level AA
2. **Tested against** — NVDA/VoiceOver, keyboard-only, high contrast, 200% zoom
3. **Known issues** — honest list of current limitations + remediation timeline
4. **Technical approach** — semantic HTML, ARIA labeling, skip links, 44px touch targets,
   screen-reader only text, no `maximumScale`/ `userScalable` on viewport
5. **Third-party content** — map tiles, embedded content disclaim
6. **Feedback / request accommodation** — contact form link
7. **Enforcement** — link to relevant accessibility authority
8. **Last evaluated** — ISO date

**Implementation notes**

- Static content; update `lastEvaluated` date after each accessibility audit
- CI gate (`e2e/` has accessibility tests) — link to the badge

---

## Phase 2 — Operational Pages (P2)

Ship after legal pages; required for production credibility.

---

### 2A. `/about` — About ORAN

**Purpose**: The public face of the platform for seekers, partners, investors, and press.
Explains the mission, non-negotiables, and governance model.

**Content sections**

1. **Hero** — tagline + one-line mission ("Connecting people to verified services.
   No hallucinated results — real help, real fast.")
2. **The problem we solve** — brief framing of the fragmented 211/resource gap
3. **How it works** — 3-step: find → verify → connect
4. **Non-negotiables** — truth first, crisis-first routing, privacy, accessibility
5. **Open governance** — community-admin verification loop, confidence scoring, open source
6. **Platform by the numbers** — service count, verification rate, organizations listed
   → Needs read-only API call: `GET /api/health` extended with stats, OR `GET /api/about/stats`
   → Alternatively: hard-coded periodically-updated values for v1
7. **Get involved** — three CTAs: Get Help · List Your Org · Contribute
8. **Open source** — GitHub link, license badge

**New API needed (Phase 2)**

```
GET /api/about/stats
→ { serviceCount: number, orgCount: number, verifiedCount: number, zonesActive: number }
```

Cached, public, read-only. No PII.

---

### 2B. `/contact` — Contact

**Purpose**: Single front-door for support, press, partnership intake, and data subject requests.

**Content sections**

1. **Routed contact form** — dropdown: General · Support · Partnership · Press · Data Request
2. **Expected response time** — per category
3. **Emergency / crisis escalation** — prominent callout: "If you or someone else is in danger, call 911 now."
4. **For developers** — link to GitHub Issues for bugs

**Form fields**: Category (select) · Name · Email · Subject · Message · [Honeypot]

**Infrastructure needed**

- `POST /api/contact` route with Zod validation
- Email delivery: Azure Communication Services (aligns with Azure-first platform rule)
- Rate limiting per IP (5 submissions / 15min)
- No PII stored beyond 30-day window; anonymize after delivery confirmed
- Recaptcha or turnstile (optional, adds complexity — decide in ADR)

**Security notes**: Honeypot field. Server-side validation only (Zod). Sanitize all fields
before logging. Never echo user input back in a server-side email template unsanitized.

---

### 2C. `/status` — System Status

**Purpose**: Public trust signal, especially important for intake organizations (hospitals, libraries)
that depend on ORAN being available. Reduces support ticket volume during outages.

**Content sections**

1. **Overall status badge** — Operational / Degraded / Outage
2. **Component table** — per service:

   | Component | Status | Uptime 90d |
   |---|---|---|
   | Web App | ✅ Operational | 99.9% |
   | Search API | ✅ Operational | 99.8% |
   | Chat API | ✅ Operational | 99.7% |
   | Data Ingestion | ✅ Operational | 99.5% |
   | Authentication | ✅ Operational | 100% |

3. **Active incidents** — zero-state copy + active incident cards
4. **Incident history** — 90-day log

**Implementation options (choose one)**

Option A: **Azure-native** — read from Azure Application Insights REST API + Azure Monitor
health checks. Matches existing infra in `infra/monitoring.bicep`.
→ `GET /api/status` (server-side, cached 60s)

Option B: **Static + GitHub incident log** — `docs/ops/incidents/` YAML files drive the page.
Lower infrastructure complexity. Reasonable for v1.

**Recommendation**: Ship Option B for v1, migrate to Option A when Application Insights
integration matures.

---

### 2D. `/security` — Security Policy

**Purpose**: Public disclosure statement. Required for any platform that handles PII, authentication,
or health-adjacent data. Enables responsible disclosure from security researchers.

**Content sections**

1. **Reporting a vulnerability** — GPG-encrypted email or GitHub private advisory
2. **Scope** — what is in-scope (web app, API, data pipeline) / out-of-scope (third-party infra)
3. **Our commitments** — acknowledge within 48h, remediate critical within 14 days,
   no legal action for good-faith researchers
4. **Known past disclosures** — empty on launch; maintain a CVE log over time
5. **Security practices** — brief overview: auth (Entra ID), encryption in transit (TLS 1.3),
   encryption at rest (Azure), no PII in logs, Sentry anonymization policy
6. **Link to `SECURITY.md`** on GitHub for the programmatic disclosure file

**Implementation notes**

- Mostly static
- Link to `SECURITY.md` in repo — keep in sync

---

## Phase 3 — Partnership & Growth (P3)

Ship when the platform is ready to actively recruit organizations and partners.

---

### 3A. `/partnerships` — Partnerships & Get Involved (full page)

**Current state**: Single page with 4 stub cards. Phase 3 breaks this into a rich landing page
with distinct sub-flows.

**Sub-flows to build**

| Path | Purpose | Status |
|---|---|---|
| `/partnerships` | Overview landing page | Stub |
| `/partnerships/list-org` | Self-service org listing intake form | Future |
| `/partnerships/donate` | Donation options (Stripe / Open Collective TBD) | Future |
| `/partnerships/volunteer` | Volunteer role application | Future |
| `/partnerships/institutional` | Institutional partnership intake | Future |

**Landing page sections**

1. **Hero** — "Join the network. Help more people find real help."
2. **4-card grid** — List Org · Institutional Partner · Donate · Volunteer
   Each card includes: what it involves, who it's for, CTA button → sub-flow
3. **Current partners** — logos of orgs that have listed (once we have them)
4. **Impact numbers** — pulled from same `GET /api/about/stats` endpoint as `/about`

**`/partnerships/list-org` form flow**

Fields: Org name · Type (nonprofit/gov/community/health/other) · Address ·
Primary service categories · Contact name · Email · Phone · Website ·
Description · Terms acknowledgement → `POST /api/host/claim` (already exists)

**Security notes**: All forms use server-side Zod validation. Honeypot fields on public forms.
Rate limit org listing submissions at 3/IP/hour to prevent spam.

---

## File Map — Current State

```
src/components/footer/
  crisisData.ts          ← 18 national crisis hotlines, 13 categories
  footerConfig.ts        ← Role-scoped columns + legal bar definitions
  CrisisModal.tsx        ← Category-filtered full-screen/modal dialog
  AppFooter.tsx          ← Role-aware 2-tier footer (grid + legal bar)
  index.ts               ← Barrel export

src/app/(public)/
  layout.tsx             ← AppNav + AppFooter shell
  about/page.tsx         ← Stub
  accessibility/page.tsx ← Stub
  contact/page.tsx       ← Stub
  partnerships/page.tsx  ← Stub (4 CTA cards)
  privacy/page.tsx       ← Stub
  security/page.tsx      ← Stub
  status/page.tsx        ← Stub
  terms/page.tsx         ← Stub
```

---

## Backlog — Nice to Have

- `/about/press` — press kit with logo assets and boilerplate copy
- `/about/team` — team page (optional for open source project; adds trust signal)
- `/changelog` — user-facing changelog driven from `docs/ENGINEERING_LOG.md`
- Crisis resource contribution guide — how verified orgs can submit hotline corrections
- i18n of all footer pages (Spanish as first target, aligns with service population data)
- Dark mode support verified on all public pages (theme init already in root `layout.tsx`)

---

## Dependencies

| Dependency | Needed by |
|---|---|
| `POST /api/contact` + Azure Communication Services | `/contact` (Phase 2) |
| `GET /api/about/stats` | `/about` platform stats block (Phase 2) |
| `GET /api/status` or incident YAML | `/status` (Phase 2) |
| Legal review | `/privacy`, `/terms` finalization (Phase 1) |
| Accessibility audit report | `/accessibility` finalization (Phase 1) |
