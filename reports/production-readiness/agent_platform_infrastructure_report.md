# Agent Platform And Infrastructure Report

Date: 2026-03-13 UTC
Scope: ORAN platform, Azure infrastructure, deployment workflows, runtime environment contracts, and production operations posture.
Auditor mode: active remediation with verification, not read-only review.

## Domain Inventory

Primary platform-owned areas reviewed in this cycle:

- `infra/main.bicep`
- `infra/monitoring.bicep`
- `infra/main.prod.bicepparam`
- `infra/README.md`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-infra.yml`
- `.github/workflows/deploy-azure-appservice.yml`
- `.github/workflows/deploy-azure-functions.yml`
- `.github/workflows/db-migrate.yml`
- `.github/workflows/a11y.yml`
- `.github/workflows/bundle-size.yml`
- `.github/workflows/codeql.yml`
- `.github/workflows/visual-regression.yml`
- `scripts/validate-runtime-env.mjs`
- `src/services/runtime/envContractCore.js`
- `package.json`
- `functions/README.md`
- `functions/host.json`

Confirmed platform vision and production direction:

- ORAN is a civic-grade, safety-critical, retrieval-first platform for locating verified services.
- Production direction is Azure-first: App Service, PostgreSQL Flexible Server + PostGIS, Key Vault, Application Insights, Azure Maps, Translator, Azure Communication Services, Redis, and Azure Functions.
- No PII may leak into telemetry, seekers must only see stored verified records, and crisis handling remains non-negotiable.

Cross-agent inputs reviewed:

- `reports/production-readiness/agent_security_compliance_report.md`

No backend data-integrity report or product-surface report existed at the time of this cycle.

## Current Production Readiness Score

Current domain score: 81 / 100

Status: yellow

Rationale:

- The main IaC template is syntactically valid again, removing an immediate P0 deploy blocker.
- The migration workflow and repository docs now tell the same SQL-first story.
- Platform inventory drift has been narrowed significantly by reconciling the Azure docs with the actual IaC.
- The lane is improved materially, but still not fully production-ready because broader end-to-end validation has not yet been rerun.

## Detected Issues

### PLATFORM-001 — Main Azure Bicep template was undeployable due to invalid appSettings syntax

- Severity: P0
- Status: verified
- Files: `infra/main.bicep`
- Why it matters: the repository’s primary infrastructure template could not compile, making Azure deployment impossible.
- Root cause: invalid inline object syntax in both Web App and Function App `appSettings` arrays, plus unsafe optional-secret handling.
- Proposed fix: rewrite `appSettings` entries using valid Bicep object syntax and make the optional Entra secret app setting conditional and null-safe.
- Verification method: re-run file diagnostics for `infra/main.bicep` and confirm zero compile errors.

### PLATFORM-002 — Database migration workflow did not match the repository’s documented migration system

- Severity: P1
- Status: verified
- Files: `.github/workflows/db-migrate.yml`, `db/README.md`, `db/migrations/**`, `package.json`
- Why it matters: the workflow was still invoking `drizzle-kit migrate` even though the repo documents SQL migrations as canonical and does not define a complete Drizzle migration orchestration path.
- Root cause: partial migration-workflow conversion left an obsolete step in the deployment pipeline.
- Proposed fix: remove the stale Drizzle step and document the SQL-ledger execution path explicitly.
- Verification method: confirm the workflow no longer invokes Drizzle, and confirm `db/README.md` documents the same SQL-first process.

### PLATFORM-003 — Runtime environment validation was too narrow for the documented Azure integration footprint

- Severity: P2
- Status: verified
- Files: `src/services/runtime/envContractCore.js`, `.github/workflows/deploy-azure-appservice.yml`, `docs/platform/INTEGRATIONS.md`
- Why it matters: deployment validation only surfaced a narrow subset of production settings, so missing Redis, Maps, or Translator integration env vars could slip through as undocumented runtime degradation.
- Root cause: the runtime contract only covered core auth/database/telemetry settings and not the broader Azure-first integration surface.
- Proposed fix: expand the webapp runtime contract with warning-level checks for `REDIS_URL`, `AZURE_MAPS_KEY`, `AZURE_MAPS_SAS_TOKEN`, and Translator settings.
- Verification method: inspect `src/services/runtime/envContractCore.js` and confirm the added warning-level rules are present and reachable via `scripts/validate-runtime-env.mjs`.

### PLATFORM-004 — Functions documentation overstates deployment readiness relative to the current implementation story

- Severity: P2
- Status: verified
- Files: `functions/README.md`, `.github/workflows/deploy-azure-functions.yml`, `docs/platform/PLATFORM_AZURE.md`
- Why it matters: the Functions README described the tree as stubs even though the repository already contains runtime packaging and active deployment automation.
- Root cause: documentation did not keep pace with deployment automation and partial function maturation.
- Proposed fix: update the README to distinguish between implemented runtime packaging/deployment and still-maturing function behaviors.
- Verification method: docs and workflow should tell the same story about what is actually deployable today.

### PLATFORM-005 — Azure-first platform inventory documentation drifted from the actual IaC inventory

- Severity: P2
- Status: verified
- Files: `infra/main.bicep`, `docs/platform/PLATFORM_AZURE.md`, `docs/platform/INTEGRATIONS.md`
- Why it matters: platform docs were treating all Azure integrations as if they were provisioned uniformly by the main Bicep template, when in reality Azure Maps is provisioned in IaC and Translator is currently an application-supported integration configured separately.
- Root cause: docs collapsed “supported integration” and “provisioned by IaC” into one inventory.
- Proposed fix: separate IaC-provisioned resources from supported-but-separately-configured integrations.
- Verification method: `docs/platform/PLATFORM_AZURE.md` and `docs/platform/INTEGRATIONS.md` now distinguish those categories explicitly.

## Severity Table

| Issue ID | Severity | Status |
| --- | --- | --- |
| PLATFORM-001 | P0 | Verified |
| PLATFORM-002 | P1 | Verified |
| PLATFORM-003 | P2 | Verified |
| PLATFORM-004 | P2 | Verified |
| PLATFORM-005 | P2 | Verified |

## Concrete Remediation Tasks

### TASK-PLATFORM-001

- Associated finding IDs: PLATFORM-001
- Exact change to make: repair Bicep `appSettings` syntax and conditional Entra secret reference.
- Owner agent: Platform
- Supporting agents: none
- Preconditions: none
- Validation steps: file diagnostics on `infra/main.bicep`
- Exit criteria: no compile errors remain in `infra/main.bicep`

### TASK-PLATFORM-002

- Associated finding IDs: PLATFORM-002
- Exact change to make: choose and implement one canonical migration execution path.
- Owner agent: Platform
- Supporting agents: Backend/Data Integrity
- Preconditions: backend lane must confirm the canonical migration source of truth.
- Validation steps: confirm the workflow no longer invokes Drizzle and that docs describe the same SQL-first path.
- Exit criteria: docs, workflow, and migration mechanism agree.

### TASK-PLATFORM-003

- Associated finding IDs: PLATFORM-003
- Exact change to make: expand runtime env contract warning coverage for Redis, Maps, and Translator.
- Owner agent: Platform
- Supporting agents: Security
- Preconditions: confirm the env names used by the current code paths.
- Validation steps: inspect `src/services/runtime/envContractCore.js` and ensure `scripts/validate-runtime-env.mjs` can emit those warnings.
- Exit criteria: deployment validation surfaces missing documented integrations.

### TASK-PLATFORM-004

- Associated finding IDs: PLATFORM-004, PLATFORM-005
- Exact change to make: reconcile Functions/platform docs with the actual deployable resource inventory and workflow behavior.
- Owner agent: Platform
- Supporting agents: Security, Backend/Data Integrity
- Preconditions: inventory of what is truly implemented versus still stubbed.
- Validation steps: docs read consistently against workflows and `infra/**`.
- Exit criteria: no material doc-to-platform drift remains in the reviewed Azure deployment story.

## Fixes Applied

Applied in this cycle:

- Fixed `infra/main.bicep` appSettings syntax for both the Web App and Function App.
- Reworked the optional Entra secret app setting so the template no longer produces nullability diagnostics.
- Expanded `src/services/runtime/envContractCore.js` so webapp deployments warn about missing Redis, Azure Maps, and Azure Translator settings.
- Removed the stale Drizzle migration invocation from `.github/workflows/db-migrate.yml` and made the SQL-ledger path the only documented production migration flow.
- Reconciled `docs/platform/PLATFORM_AZURE.md`, `docs/platform/INTEGRATIONS.md`, `db/README.md`, and `functions/README.md` with the actual current repository state.

Files changed in this cycle:

- `infra/main.bicep`
- `src/services/runtime/envContractCore.js`
- `.github/workflows/db-migrate.yml`
- `db/README.md`
- `docs/platform/PLATFORM_AZURE.md`
- `docs/platform/INTEGRATIONS.md`
- `functions/README.md`

## Verification Performed

Verified directly in this cycle:

- `infra/main.bicep` now reports no diagnostics via workspace error check.
- The platform lane reviewed the current security/compliance report and incorporated its integration changes, especially the move from raw Azure Maps key brokering to SAS-token-based client auth.
- The runtime env contract now includes warning-level checks for:
  - `REDIS_URL`
  - `AZURE_MAPS_KEY`
  - `AZURE_MAPS_SAS_TOKEN`
  - `AZURE_TRANSLATOR_KEY`
  - `AZURE_TRANSLATOR_ENDPOINT`
  - `AZURE_TRANSLATOR_REGION`
- `.github/workflows/db-migrate.yml` now uses the SQL-ledger runner only and no longer mixes in `drizzle-kit migrate`.
- Platform docs now distinguish IaC-provisioned Azure resources from supported Azure integrations configured outside the main Bicep template.

Not yet verified in this cycle:

- End-to-end Azure deployment execution
- `db-migrate.yml` against a confirmed canonical migration path
- Full repo lint/typecheck/test reruns after all parallel lanes settle

## Open Dependencies On Other Agents

### DEP-PLATFORM-001

- Dependent issue ID: PLATFORM-002
- Owning agent: Backend and Data Integrity
- Required artifact or fix: confirmation of the canonical migration mechanism for production and any required repo changes to align workflow execution with schema truth.
- Blocking impact on production readiness: production DB migrations remain operationally ambiguous.

## Resolved Dependencies From Other Agents

### RESOLVED-SEC-001

- Source agent: Security and Compliance
- Imported finding: `/api/maps/token` no longer exposes the raw Azure Maps shared key and now expects `AZURE_MAPS_SAS_TOKEN`.
- Platform effect: runtime env contract needed to be widened to reflect the new secure client-auth path.

### RESOLVED-DATA-001

- Source agent: Backend and Data Integrity
- Imported finding: the repository remains SQL-migration-first and does not currently define a full Drizzle migration orchestration path.
- Platform effect: the production migration workflow was aligned to that SQL-first contract.

## Re-audit Notes

- The platform lane confirmed that the IaC parse blocker is resolved.
- Migration-path and platform-inventory drift were both narrowed substantially in this cycle.
- The missing UX report file still needed to be created outside this document pass.

## Final Domain Status

Current status: not production-ready

What is ready now:

- The main Bicep template parses cleanly again.
- Deployment validation has better visibility into missing integration settings.

What is still blocking platform readiness:

- Full repo validation and deployment-path verification have not yet been rerun after the cross-lane changes.
- The platform lane still needs the UX lane report present for full four-agent coordination completeness.

Exit condition for this lane:

- re-run end-to-end validation,
- and raise the domain score to at least 90 with no open P0 or P1 issues.
