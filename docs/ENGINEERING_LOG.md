# ORAN Engineering Log

This is a human-readable, append-only log for safety-critical and contract-level repository changes.

Rules:
- Use UTC timestamps (ISO 8601).
- Keep entries short.
- Link to PRs/issues when available.
- Do not include PII.

## Entries

- 2026-02-28T00:00:00Z — Added SSOT + operating model docs; established ADR structure; created forensic audit baseline. (docs/SSOT.md, docs/OPERATING_MODEL.md, docs/DECISIONS/*, docs/AUDIT_REPORT.md)
- 2026-02-28T00:10:00Z — Added Azure bootstrap + GitHub OIDC helper scripts for Azure-first deployment; documented scripted quickstart. (scripts/azure/*, docs/DEPLOYMENT_AZURE.md)
- 2026-02-28T03:33:20Z — Hardened API abuse controls: shared in-memory rate limiting added to search/feedback, and search confidence filtering normalized to 0–100 via `minConfidenceScore` (legacy `minConfidence` still supported). (src/services/security/rateLimit.ts, src/app/api/search/route.ts, src/app/api/feedback/route.ts)
- 2026-02-28T03:37:32Z — Hardened auth/telemetry defaults: protected routes fail closed in production when auth is unavailable/misconfigured; sanitized dev telemetry logging to avoid dumping arbitrary extra context. (src/middleware.ts, src/services/telemetry/sentry.ts)
- 2026-02-28T03:57:45Z — Hardened in-memory feature flags: clamp rollout percentage, prevent mutable reference leaks, and add unit tests for expected semantics. (src/services/flags/flags.ts, src/services/flags/__tests__/flags.test.ts)
- 2026-02-28T04:00:32Z — Aligned i18n behavior/docs: dev missing-key now throws; added unit tests; updated i18n workflow doc to match in-code dictionary implementation. (src/services/i18n/i18n.ts, src/services/i18n/__tests__/i18n.test.ts, docs/I18N_WORKFLOW.md)
- 2026-02-28T04:04:21Z — Bounded in-memory chat session quotas: added TTL + max-entry eviction to mitigate memory growth from untrusted session IDs; added tests and documented parameters. (src/services/chat/orchestrator.ts, src/services/chat/__tests__/quota-eviction.test.ts, src/domain/constants.ts, docs/CHAT_ARCHITECTURE.md)
- 2026-02-28T04:08:01Z — Minimized API logging for privacy: removed console logging of feedback request metadata to avoid accidental sensitive data exposure in logs. (src/app/api/feedback/route.ts)

- 2026-03-01T00:00:00Z — Improved Codespaces/devcontainer ergonomics: added `.devcontainer` setup (Node LTS + Azure/Docker/GitHub CLIs) and tuned `.vscode` settings/tasks for ESLint v9 flat config + better problem matching. (.devcontainer/*, .vscode/*, .editorconfig)
- 2026-03-01T00:05:00Z — Fixed GitHub Actions OIDC helper: corrected federated credential JSON generation and made the script idempotent (reuse existing app/SP, skip existing credential). (scripts/azure/github-oidc.sh)

- 2026-03-02T00:00:00Z — Phase 0 UI foundations complete: seeker layout shell with bottom nav (src/app/(seeker)/layout.tsx), landing page replacing Next.js starter (src/app/page.tsx), Skeleton + ErrorBoundary primitives (src/components/ui/), ChatServiceCard extraction (src/components/chat/ChatServiceCard.tsx). Dark mode deferred per ADR-0003; globals.css prefers-color-scheme block removed. UX Flows Mermaid diagram fixed (signed-in node reconnected to discovery flow). All contract docs accepted. (docs/DECISIONS/ADR-0003-defer-dark-mode.md, docs/UX_FLOWS.md, src/app/globals.css)

- 2026-03-02T00:10:00Z — Completed remaining Phase 0 vertical shells: added host, community-admin, and ORAN-admin layouts to prevent cross-role navigation leakage and establish consistent chrome sitewide. (src/app/(host)/layout.tsx, src/app/(community-admin)/layout.tsx, src/app/(oran-admin)/layout.tsx)

- 2026-03-03T00:00:00Z — Azure-native integration rollout: provisioned Application Insights (+ Log Analytics workspace), Azure Maps (G2 Gen2), and Azure AI Translator (F0 free tier) in `oranhf57ir-prod-rg`. All keys stored in Key Vault; App Service configured with KV references for AZURE_MAPS_KEY and AZURE_TRANSLATOR_KEY. Added `applicationinsights@^3` SDK with Next.js instrumentation hook. Created geocoding service (`src/services/geocoding/azureMaps.ts`) and translation service (`src/services/i18n/translator.ts`) with full test coverage (97 tests passing). Updated docs/INTEGRATIONS.md, docs/PLATFORM_AZURE.md, docs/INTEGRATION_CATALOG.md. (ADR-0002-azure-native-integration-plan.md)
