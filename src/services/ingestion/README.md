# ORAN Ingestion Service Helpers

This folder contains service-layer helpers used by ingestion-related routes and workflows.

It is not the canonical home of the ingestion pipeline. The primary ingestion domain lives in
`src/agents/ingestion/**`, and Azure Functions remain the execution layer for background jobs.

## Purpose

- Provide narrow helper modules that can be reused without importing the entire agent runtime
- Keep route-facing or utility-facing ingestion code lightweight
- Avoid duplicating orchestration logic that already exists in `src/agents/ingestion/**`

## Current Scope

- `tagging-prompt.ts` — prompt/helper support for ingestion-related tagging flows
- `docIntelligence.ts` — Azure Document Intelligence helpers
- `hostPortalIntake.ts` — host/operator intake support helpers
- `index.ts` — thin exports only

## Boundary Rule

If a change affects source records, normalization, feed polling, federation, publish readiness,
or ingestion lifecycle state, it belongs in `src/agents/ingestion/**` first.

## Safety Notes

- Any AI-assisted output remains unverified until it enters the canonical review/publish workflow
- These helpers must not create seeker-visible facts directly
- Legacy references to `verification_queue` should be interpreted through the current universal submissions model
