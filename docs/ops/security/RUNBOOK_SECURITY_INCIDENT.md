# Runbook: Security And Privacy Incident Response

## Metadata

- Owner role: Security Lead
- Reviewers: Platform On-Call Lead, Identity And Access Lead
- Last reviewed (UTC): 2026-03-06
- Next review due (UTC): 2026-06-06
- Severity scope: SEV-1 to SEV-2

## Purpose And Scope

This runbook covers active security/privacy incidents including suspected unauthorized access, credential leakage, data exposure, and integrity compromise.

## Safety Constraints (Must Always Hold)

- Containment actions must preserve evidence integrity.
- Do not expose additional sensitive details in public channels.
- No incident response action should weaken crisis routing or retrieval safety guarantees.
- No PII in telemetry or shared incident artifacts.

## Triggers

- Confirmed or suspected credential leak.
- Unauthorized admin/API activity.
- Suspicious spikes in auth failures or privileged actions.
- Suspected data exposure involving sensitive or restricted data classes.

## Immediate Actions (First 15 Minutes)

1. Declare SEV-1 or SEV-2 and activate incident command.
2. Start security timeline with UTC timestamps.
3. Contain potential blast radius:
   - Freeze deploys.
   - Restrict privileged operations if needed.
4. Notify security owner and platform lead.

## Evidence Checklist

Capture and preserve:
- Incident timeline with UTC timestamps.
- Relevant request IDs/correlation IDs.
- Deployment and config change history for incident window.
- Auth and privileged action traces.
- Secret rotation evidence (what rotated, when, by whom).

Do not include raw secrets or sensitive personal data in incident documents.

## Containment Playbook

### A. Secret/Key Exposure

1. Rotate exposed secrets immediately (Key Vault/App Service references):
   - `NEXTAUTH_SECRET`
   - `AZURE_AD_CLIENT_SECRET`
   - `INTERNAL_API_KEY`
   - Any exposed integration credentials
2. Restart affected apps/functions after rotation.
3. Validate service health and auth flows post-rotation.

### B. Unauthorized Access Patterns

1. Review recent admin actions and scope changes.
2. Temporarily revoke elevated access from suspicious principals.
3. Enforce least privilege and require re-approval of sensitive scopes.

### C. Potential Data Exposure

1. Determine dataset and scope of potential exposure.
2. Preserve evidence (logs, request metadata, deployment timeline).
3. Coordinate internal/legal notification workflow per policy.

## Investigation

1. Correlate timeframe with:
   - Deployments
   - Auth events
   - Admin API usage
   - Internal endpoint access (`/api/internal/*`)
2. Identify root cause category:
   - Credential compromise
   - Authz bypass
   - Misconfiguration
   - Dependency compromise

## Recovery

1. Apply corrective controls.
2. Re-enable services in staged order.
3. Verify:
   - Auth boundary integrity
   - Rate limiting and Retry-After behavior
   - Admin API role enforcement
4. Monitor for recurrence signals.

## Communications

- Follow `SECURITY.md` for reporting expectations.
- Keep public disclosures minimal until facts are confirmed.
- Provide internal updates at fixed intervals until closure.
- Use `docs/ops/templates/INCIDENT_COMMS_TEMPLATE.md` for message consistency.

## Exit Criteria

- Attack/incident vector is contained.
- Exposed credentials rotated and validated.
- No ongoing unauthorized activity.
- Recovery controls are in place and verified.

## Post-Incident

1. Publish security post-incident report.
2. Create remediation backlog with owners and due dates.
3. Update security controls and this runbook.
4. Record operational updates in `docs/ENGINEERING_LOG.md`.

## References

- `SECURITY.md`
- `docs/SECURITY_PRIVACY.md`
- `docs/ops/core/RUNBOOK_INCIDENT_TRIAGE.md`
- `docs/ops/monitoring/MONITORING_QUERIES.md`
