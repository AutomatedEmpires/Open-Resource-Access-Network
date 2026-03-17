# ADR-0012: Accept Username Enumeration Risk on Registration

Status: Accepted

Timestamp: 2026-03-17T00:00:00Z

## Context

The `POST /api/auth/register` endpoint returns specific error messages when a username, email, or phone number is already taken (e.g., "That username is already taken"). This allows an attacker to enumerate valid usernames on the platform.

This was identified as finding **B4** in the Boundary Layer Security Audit (`docs/audit/BOUNDARY_LAYER_AUDIT.md`).

## Decision

**Accept this risk** for the following reasons:

1. **UX priority**: ORAN is a civic-grade platform serving vulnerable populations. Clear registration error messages reduce friction for seekers and host operators who may have limited technical literacy. Generic "registration failed" messages create confusion and support burden.

2. **Rate limiting mitigates bulk enumeration**: Registration is rate-limited to 5 attempts per IP per window via `checkRateLimitShared()`. A honeypot field (`website`) further filters automated bots.

3. **Usernames are not secrets**: Usernames are display-visible in host operator contexts. Knowing a username exists does not grant access — authentication still requires the correct password, and accounts are protected by bcrypt hashing, complexity requirements, and frozen-account enforcement.

4. **Low-value target**: ORAN does not store financial data, payment information, or other high-value PII that would make username enumeration a precursor to targeted attacks.

## Consequences

- Registration error messages remain specific and user-friendly.
- No code change required.
- If ORAN later handles high-value PII or becomes a target for credential-stuffing campaigns, this decision should be revisited. Possible mitigations at that point:
  - CAPTCHA on registration
  - Uniform response timing (constant-time registration flow)
  - Generic error messages with email-based confirmation

## Alternatives Considered

1. **Return generic "registration failed" for all conflicts**: Rejected — poor UX for legitimate users.
2. **Return generic message + send email to existing user**: Better UX but requires email infrastructure not yet available.
3. **Add CAPTCHA**: Disproportionate friction for the current threat model.
