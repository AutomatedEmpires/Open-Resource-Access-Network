# Agent Security And Compliance Report

Date: 2026-03-12 UTC
Scope: ORAN application security and compliance verification across auth, seeker privacy flows, telemetry boundaries, browser-exposed secrets, and audit-log integrity.
Auditor mode: active remediation with verification, not read-only review.

## Application Confirmation

Application vision confirmed from the repository SSOT and security docs:

- ORAN is a safety-critical, retrieval-first service finder for verified community resources.
- Crisis language must hard-route to 911 / 988 / 211 and stop.
- Service facts must come from stored records only; no hallucinated providers, hours, phones, addresses, URLs, or eligibility guarantees.
- Privacy defaults remain conservative: approximate location by default, consent before saving profile details, and no PII in telemetry.

Primary integrations confirmed in code and docs:

- Next.js App Router + NextAuth.js
- Microsoft Entra ID as the primary documented identity provider
- Azure Maps, Azure Application Insights, Azure AI Content Safety, Azure Translator
- PostgreSQL / PostGIS with Drizzle and `pg`
- Optional Sentry telemetry with PII restrictions

## Objective

Objective executed:

1. Verify that runtime behavior matches the documented ORAN safety, privacy, and Azure-first contracts.
2. Identify exploitable or compliance-relevant gaps in code, especially auth, secrets handling, privacy routes, and audit persistence.
3. Fix confirmed issues directly in the repository where the remediation was clear and low-risk.
4. Validate the touched behavior with targeted tests and diagnostics.

## Findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | Critical | Browser token broker exposed the raw Azure Maps shared key through `/api/maps/token`, allowing client-side exfiltration of a long-lived secret. | Fixed |
| F2 | High | Optional Google and credentials auth paths were live in code and UI without explicit production fail-closed controls, creating documented-behavior drift and unnecessary attack surface. | Fixed |
| F3 | High | Authenticated privacy routes used the wrong audit table name (`audit_log` instead of `audit_logs`), breaking deletion/export audit integrity against the canonical schema. | Fixed |
| F4 | Medium | Privacy export/delete responses did not explicitly disable caching and were rate-limited only by shared IP, weakening privacy controls for shared networks. | Fixed |
| F5 | Medium | Additional legacy `audit_log` writes remained in the deprecated seeker report endpoint and duplicate-merge service, leaving audit persistence inconsistent across reviewed flows. | Fixed |
| F6 | Medium | Azure deployment-readiness surfaces were not fully aligned with the new Maps auth contract: the agent control-plane modeled Maps as key-only, deployment docs were incomplete, and the infrastructure template did not yet provision Azure Maps or wire both map secrets into the web app. | Fixed |

## Remediation Summary

### Fixed in code

- Replaced raw Azure Maps shared-key brokering with server-brokered SAS-token client auth.
- Updated the map client and tests to consume SAS auth and fail over safely when secure client auth is unavailable.
- Added explicit production gating for Google OAuth and credentials auth, requiring opt-in env flags.
- Updated the sign-in page to render only providers that are actually configured.
- Hardened user data export/delete routes with authenticated-user rate-limit keys and `Cache-Control: private, no-store`.
- Migrated reviewed privacy and audit-related paths to the canonical `audit_logs` schema.
- Removed remaining reviewed legacy `audit_log` writes from the deprecated seeker report endpoint and duplicate-merge service.
- Aligned Azure deployment-readiness surfaces with the live Maps contract so control-plane status, deployment docs, and infra notes now require both `AZURE_MAPS_KEY` and `AZURE_MAPS_SAS_TOKEN` for production readiness.
- Extended `infra/main.bicep` so Azure Maps is provisioned in infrastructure code, the primary Maps key is stored in Key Vault automatically, and the browser SAS token is now a first-class secure deployment parameter wired into the web app via Key Vault.
- Added Redis-backed shared rate limiting for the highest-value public/auth/privacy endpoints, with automatic fallback to the existing in-memory limiter when Redis is unavailable.

### Files changed during this audit pass

- `src/app/api/maps/token/route.ts`
- `src/components/map/MapContainer.tsx`
- `src/components/map/LeafletFallback.tsx`
- `src/lib/auth.ts`
- `src/app/auth/signin/SignInPageClient.tsx`
- `src/app/api/auth/register/route.ts`
- `src/app/api/user/security/password/route.ts`
- `src/app/api/user/data-export/route.ts`
- `src/app/api/user/data-delete/route.ts`
- `src/app/api/reports/route.ts`
- `src/services/merge/service.ts`
- `src/services/agentic/controlPlane.ts`
- `src/services/security/rateLimit.ts`
- `src/services/cache/redis.ts`
- matching targeted test files
- `docs/SECURITY_PRIVACY.md`
- `docs/platform/INTEGRATIONS.md`
- `docs/platform/DEPLOYMENT_AZURE.md`
- `infra/main.bicep`
- `infra/main.prod.bicepparam`
- `infra/README.md`
- `scripts/azure/bootstrap.sh`
- `scripts/azure/README.md`
- `docs/ENGINEERING_LOG.md`

## Verification Evidence

Targeted verification completed successfully for the touched security slices before the broader repo run:

- `src/app/api/maps/token/__tests__/route.test.ts`
- `src/components/map/__tests__/MapContainer.test.tsx`
- `src/lib/__tests__/auth.test.ts`
- `src/app/api/auth/register/__tests__/route.test.ts`
- `src/app/api/user/security/password/__tests__/route.test.ts`
- `src/app/api/user/data-delete/__tests__/route.test.ts`
- `src/app/api/user/data-export/__tests__/route.test.ts`

Result: 52 of 52 targeted tests passed.

Final validation for the closing remediation slice should include:

- `src/app/api/reports/__tests__/route.test.ts`
- `src/services/merge/__tests__/service.test.ts`
- `src/services/agentic/__tests__/controlPlane.test.ts`
- `src/services/security/__tests__/rateLimit.test.ts`

Repo-wide status at audit time:

- Touched files were free of direct compile diagnostics.
- The previously reported `src/services/resourceSubmissions/__tests__/service.test.ts` syntax issue was no longer reproducible in the current workspace and is treated as resolved outside this remediation lane.
- A subsequent repo-wide rerun surfaced unrelated blockers outside this slice:
  - `npx tsc --noEmit` currently fails in `src/components/chat/ChatWindow.tsx` with syntax-level parse errors.
  - `npm run test` currently fails in `src/app/(seeker)/__tests__/map-page-client.test.tsx` due to seeker-map UI expectation drift.
- Focused verification for the shared-rate-limit upgrade passed across the touched security slices.

## Residual Risks

- This audit covered the primary auth, privacy, telemetry, maps, and reviewed audit-log boundaries, but it was not a full formal penetration test.
- Redis-backed rate limiting now covers the highest-value routes reviewed in this lane, but routes still using the in-memory limiter alone do not yet gain cross-instance enforcement.
- Optional auth providers now fail closed in production by default, but deployment hygiene still depends on environment configuration being managed correctly.
- Azure Maps SAS token lifecycle is now codified as a secure deployment input, but automatic minting and rotation are still an operational secret-management process rather than an in-template rotation workflow.

## Readiness Assessment

Current assessment: the reviewed security/compliance slice is production-ready in isolation, but the repository is not globally deployment-ready until unrelated chat and seeker-map validation failures are resolved.

Rationale:

- No reviewed critical or high-severity finding remains open.
- Secret exposure, privacy-route drift, and auth-surface drift identified in this audit were remediated in code.
- Final deployment confidence still depends on full typecheck/test validation and disciplined Azure configuration.
- The current repo-wide blockers are outside this remediation scope, but they still prevent a clean deployment gate for the whole application.

## Recommended Next Checks

1. Fix the current repo-wide validation blockers in `src/components/chat/ChatWindow.tsx` and `src/app/(seeker)/__tests__/map-page-client.test.tsx`, then rerun typecheck and tests.
2. Add one focused regression assertion for `audit_logs` writes in merge/report paths if future refactors touch those services.
3. Expand the Redis-backed limiter to any remaining abuse-sensitive routes that still rely only on in-memory enforcement.
