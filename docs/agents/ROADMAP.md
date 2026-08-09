# Ingestion Agent — Current Roadmap

Last reviewed: 2026-08-09

ORAN's ingestion runtime is Vercel route handlers plus Supabase/PostgreSQL.
Azure and Foundry are retired and prohibited; there is no Functions, Storage
Queue, provider fallback, or infrastructure rollback path.

## Current production boundary

- Published records must retain source provenance, verification state, and
  review history.
- Unreviewed or ambiguous records remain out of seeker-facing retrieval.
- Governed 211/HSDS feeds use the source-system, feed, candidate, and approval
  controls under `src/agents/ingestion/**`.
- Vercel Cron may call authenticated internal routes only when the corresponding
  polling and publication gates are explicitly enabled.
- Anthropic-assisted extraction is optional, disabled without an ORAN-specific
  key, and never decides publication, ranking, eligibility, or crisis handling.

## Highest-priority delivery work

1. Configure and canary a governed Washington 211/HSDS cohort through the
   existing review-required pathway. Do not broaden production data without
   licensing, owner, scope, and sample-response evidence.
2. Complete initial reviewer assignment orchestration on the active stack and
   prove normalization through assignment, decision, and publication in an
   end-to-end drill.
3. Add durable, privacy-safe aggregate unmet-need telemetry using canonical
   need and broad-region buckets only—never raw seeker text or precise location.
4. Improve freshness controls, replay safety, and provider correction workflows
   without weakening human review or authority precedence.
5. Exercise feed pause, dependency outage, duplicate collision, and rollback of
   an ORAN application release using Vercel/Supabase runbooks.

## Stable implementation map

- Domain and orchestration: `src/agents/ingestion/**`
- Scheduled/internal execution: `src/app/api/internal/ingestion/**`
- Admin review and source controls: `src/app/api/admin/ingestion/**`
- Runtime provider policy: `src/services/runtime/providerPolicy.ts`
- Current platform contract: `docs/platform/STACK_MIGRATION.md`
- Active feed operations: `docs/ops/services/RUNBOOK_211_API_INGESTION.md`
- Review routing operations: `docs/ops/services/RUNBOOK_ADMIN_ROUTING.md`

## Required release evidence

- focused ingestion, authorization, publication, and provider-policy tests
- repository typecheck, lint, unit suite, production build, and off-Azure gate
- no production feed/data mutation without a separately reviewed activation
- pushed remote SHA, green pull-request checks, and exact deployed-SHA proof
