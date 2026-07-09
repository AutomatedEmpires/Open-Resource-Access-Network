/**
 * Auth configuration shim.
 *
 * Authentication is handled by Clerk (see src/services/auth/session.ts and
 * src/proxy.ts). Email/password credentials and sign-up are owned by Clerk, so
 * ORAN no longer manages password hashes itself.
 *
 * This module remains only to report that self-managed credential auth is
 * disabled, for the legacy account-password route.
 */

/**
 * Whether ORAN-managed email/password credentials are enabled.
 * Always false now — Clerk owns credential auth and password management.
 */
export function isCredentialsAuthEnabled(): boolean {
  return false;
}
