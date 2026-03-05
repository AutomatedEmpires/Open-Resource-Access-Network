# ADR-0006 — Opt-In Device Geolocation (Seeker)

**Status**: Accepted
**Date**: 2026-03-05T00:00:00Z
**Author**: Copilot (GPT-5.2)

## Context

ORAN previously operated under a strict stance of **never requesting browser/device geolocation**, enforced both by documentation and by a restrictive `Permissions-Policy` response header.

User needs require a seeker to be able to optionally center map-based discovery around their current location. This must not weaken ORAN’s privacy posture:

- Location must remain **approximate by default**.
- Device geolocation must be **explicitly user-initiated** and **optional**.
- ORAN must **not store** seekers’ precise GPS coordinates.
- Avoid introducing PII into logs/telemetry.

## Decision

Allow opt-in device geolocation for seeker experiences under these constraints:

1. **Explicit user action only**
   - Device geolocation MAY be requested only in response to a user gesture (e.g., a “Use my location” button).

2. **In-session only; no persistence**
   - The app MUST NOT store device geolocation in the database.
   - The app MUST NOT persist device geolocation to localStorage as profile data.

3. **Precision reduction before use**
   - When device geolocation is granted, the client SHOULD round coordinates before use (target: ~0.01° ≈ 1km) to reduce precision exposure while remaining useful for map centering.

4. **Header enablement scoped to same-origin**
   - `Permissions-Policy` MUST allow `geolocation` for same-origin so the consent flow can function, while keeping other sensitive capabilities disabled.

5. **User-facing explanation**
   - The UI MUST explain that location use is optional, is used to improve local results, and is not stored.

## Consequences

- Seekers can quickly center discovery near themselves.
- Privacy posture remains: location is optional, ephemeral, and not stored.
- The response header policy changes and requires contract/doc alignment.

## Alternatives Considered

1. **Keep geolocation fully disabled**
   - Preserves the strictest stance but blocks a key usability need.

2. **IP-based geolocation only**
   - Less sensitive, but often inaccurate and not sufficient for “near me” map centering.

3. **Store device location as a profile preference**
   - Rejected: increases privacy risk and violates privacy-first defaults.

## Verification

- Confirm response headers include `Permissions-Policy` with `geolocation=(self)`.
- Verify `/map` offers an explicit “Use my location” action and that denying permission leaves the app usable.
- Ensure no telemetry/logging captures raw latitude/longitude.
