# Agent Control Plane

This document defines the enterprise operator layer for ORAN: a live control plane that turns hidden platform capabilities into explicit, governable operators.

## Why this exists

A world-class agentic platform is not just "some AI features."

It needs:

- explicit operator classes
- live trust posture
- activation blockers that can be acted on
- evidence paths back to code and SSOT docs
- a clean separation between automation, governance, and public trust

ORAN now exposes that layer through:

- `GET /api/admin/agents/control-plane`

This endpoint is ORAN-admin only and returns:

- enterprise readiness score
- active/guarded/planned operator inventory
- integration posture (AI, observability, identity, mapping, communications, data)
- enforced trust controls
- open gaps still preventing a world-class operator platform
- recommended next activation moves

## Operator classes

### 1. Trust Guardian Operator

Mission:

- protect seekers with crisis-first routing, same-origin write protection, and fail-closed auth

Backed by:

- `src/services/security/contentSafety.ts`
- `src/proxy.ts`
- `src/app/api/health/route.ts`

### 2. Resource Alignment Operator

Mission:

- ingest, score, and route verified resources into a defensible civic resource graph

Backed by:

- `src/agents/ingestion/**`
- `src/app/api/internal/ingestion/**`
- `docs/DECISIONS/ADR-0007-hsds-211-federation-canonical-model.md`

### 3. Governance Workbench Operator

Mission:

- keep automation subordinate to accountable human operators with scopes, SLAs, appeals, and approvals

Backed by:

- `src/app/api/admin/**`
- `src/services/escalation/engine.ts`
- `docs/governance/OPERATING_MODEL.md`

### 4. Access & Mobility Operator

Mission:

- expand access across geography, language, and interaction mode without bypassing verified records

Backed by:

- `src/services/geocoding/nominatim.ts`
- `src/components/map/**`
- `src/services/i18n/**`

### 5. Release Observatory Operator

Mission:

- make deployment, health, and telemetry posture continuously inspectable before operators trust a release

Backed by:

- `.github/workflows/ci.yml`
- `vercel.json`
- `src/services/runtime/envContract.ts`
- `src/services/telemetry/sentry.ts`

## Trust posture model

The control plane intentionally reports three states:

- `ready`: foundations and accelerators are in place
- `guarded`: core capability exists, but one or more enterprise accelerators are still missing
- `planned`: the mission is present in the architecture, but runtime foundations are still incomplete

That distinction matters. It prevents the platform from claiming more autonomy than it can safely support.

## Current strategic gaps the control plane surfaces

- feature flags still report as a gap whenever a deployed environment is running on the in-memory fallback instead of the DB-backed catalog
- Redis-backed multi-instance rate limits are still not active
- nonce-based CSP is still planned
- retired Azure/Foundry settings and endpoints are rejected at startup, readiness, and CI boundaries

## What this unlocks next

This endpoint is designed to become the substrate for:

- an ORAN-admin agent operations dashboard
- release evidence snapshots in CI
- operator scorecards for governance reviews
- policy-enforced optional Anthropic ingestion-assist decisions
- enterprise readiness reporting without hand-maintained spreadsheets
