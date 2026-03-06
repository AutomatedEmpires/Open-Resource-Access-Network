# Runbook: Observability Outage

## Metadata

- Owner role: Platform On-Call Lead
- Reviewers: Security Lead, Release Manager
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-2 to SEV-3

## Purpose And Scope

Respond when telemetry pipelines are degraded (Application Insights ingestion delays, missing traces/metrics, alert pipeline blind spots).

## Triggers

- Sudden drop to near-zero telemetry volume while traffic remains normal.
- Missing alerts despite known failures.
- Application Insights query returns stale or incomplete data.

## Mitigation

1. Confirm app health separately (synthetic/API checks) to avoid false recovery assumptions.
2. Verify `APPLICATIONINSIGHTS_CONNECTION_STRING` and telemetry initialization paths.
3. Increase manual health checks while observability is degraded.
4. Track blind spots and escalate if incident coincides with production degradation.

## Validation

- Telemetry ingestion resumes.
- Alerts begin firing normally for test conditions.
- Monitoring queries return expected data volume.

## References

- `src/instrumentation.ts`
- `src/services/telemetry/appInsights.ts`
- `docs/ops/monitoring/MONITORING_QUERIES.md`
