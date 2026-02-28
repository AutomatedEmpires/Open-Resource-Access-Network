# Security Policy

ORAN is safety-critical and privacy-first.

## Reporting a vulnerability

Use the repository issue template: .github/ISSUE_TEMPLATE/security-privacy-report.yml

Do not post secrets, private keys, or exploit code publicly.

## Security & privacy design

Authoritative security/privacy guidance lives in:

- docs/SECURITY_PRIVACY.md

## Key safety constraints

- No hallucinated service facts.
- Crisis routing must take priority (911/988/211).
- No LLM in retrieval/ranking.
- Approximate location by default; explicit consent before saving profile data.
