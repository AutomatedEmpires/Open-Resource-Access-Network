# `src/services/profile`

Profile-domain service helpers and tests for authenticated profile management.

## Scope

- Supports seeker profile read/update/delete flows consumed by `src/app/api/profile/**`.
- Handles `approximateCity` and `preferredLocale` style profile preferences.
- Supports server-side chat hydration for authenticated seekers.

## Current Implementation Status

- Runtime profile logic is currently implemented in `src/app/api/profile/route.ts`.
- Server-side chat hydration lives in `src/services/profile/chatHydration.ts`.
- Canonical seeker-to-discovery derivation lives in `src/services/profile/discoveryProfile.ts`.
- Local stored browse defaults live in `src/services/profile/discoveryPreference.ts`.
- Shared device sync-consent helpers live in `src/services/profile/syncPreference.ts` and gate both profile writes and saved-service sync.
- Cross-device profile writes are gated in the seeker UI by an explicit local sync-consent toggle; local personalization still works without enabling server sync.

## Shared Contracts

- Defines the closed `serviceInterests` vocabulary shared by profile persistence and chat retrieval shaping.
- Defines Phase 1 structured seeker constraints that are persisted and hydrated into deterministic chat retrieval signals: transportation, delivery mode, same-day / next-day urgency, documentation barriers, and digital-access barriers.
- Keeps one derived discovery-profile contract for browse/chat/map defaults so seeker personalization does not drift across surfaces.

## Contract (Target Extraction)

When moved into this folder, service functions should include:

- `getProfile(actor)`
- `upsertProfile(input, actor)`
- `deleteProfile(actor)`
- `hydrateChatContext(context)`
- `buildSeekerDiscoveryProfile(profile, options?)`
- `readStoredDiscoveryPreference()`

## Security & Privacy Rules

- Profile access is always actor-scoped; no cross-user access.
- Never log raw profile values or identifying metadata.
- Default to approximate location patterns; avoid precise geolocation behavior.
- Do not send profile updates to `/api/profile` unless the user has explicitly enabled cross-device sync on that device.
- Do not send saved-service bookmark updates to `/api/saved` unless the user has explicitly enabled cross-device sync on that device.
- Chat hydration must fail open and only expose schema-backed, deterministic fields to retrieval.

## Tests

Run only this area:

- `npx vitest run src/services/profile`
