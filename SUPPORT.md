# Support

## Quick links

- Product and architecture docs: `docs/README.md`
- Source of truth hierarchy: `docs/SSOT.md`
- Security and privacy policy: `docs/SECURITY_PRIVACY.md`
- Vulnerability reporting: `SECURITY.md`
- Contribution guide: `CONTRIBUTING.md`

## Getting help

Use GitHub Issues for bugs, feature requests, and implementation proposals.

Recommended issue forms:

- Bug report
- Data source import request
- Spec proposal
- Implementation task
- Safety stop-the-line
- Security and privacy report

Issue forms live in `.github/ISSUE_TEMPLATE/` and are tailored to ORAN's safety-critical workflow.

## Routing matrix

- Product bug or regression: `bug-report.yml`
- New delivery request with design details: `implementation-task.yml`
- Behavior or contract change proposal: `spec-proposal.yml`
- Data onboarding request: `data-source-import-request.yml`
- Safety incident or dangerous behavior: `safety-stop-the-line.yml`
- Security/privacy concern: `security-privacy-report.yml`

If uncertain, file a bug report with as much concrete evidence as possible.

## Response expectations

- Safety or crisis-path issues: highest priority triage.
- Security reports: follow the process in `SECURITY.md`.
- General feature/bug issues: triaged in normal backlog order.

## Before opening an issue

- Confirm your report is reproducible on `main`.
- Include exact steps to reproduce and expected vs actual behavior.
- For behavior changes in chat/search/scoring, link relevant SSOT docs in `docs/`.
- Include impact level (user-facing, operational, safety, security).

## Enterprise operations note

ORAN is retrieval-first and safety-critical. Support responses will not accept changes that introduce hallucinated service data, weaken crisis routing, or reduce privacy safeguards.
