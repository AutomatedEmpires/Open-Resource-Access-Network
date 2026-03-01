# src/services

This folder contains ORAN’s deterministic business logic.

## Structure

- chat/ — chat pipeline orchestration (crisis gate → intent → retrieval → response)
- search/ — SQL query builder and search engine contract (no LLM)
- scoring/ — confidence scoring contract (0–100 x3 with fixed weights)
- flags/ — feature flags (currently in-memory)
- i18n/ — translation helper (currently in-code English dictionary)
- telemetry/ — Sentry wrapper (no PII)

## Update-on-touch

If you modify any module under this folder:

- Update the module’s README (e.g., src/services/chat/README.md).
- Update docs/SSOT.md if the change affects SSOT mapping.
- Add or update the smallest relevant test file under `src/services/**/__tests__`.
