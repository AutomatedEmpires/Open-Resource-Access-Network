import crypto from 'node:crypto';

/**
 * Fresh opaque identifier for one anonymous persisted workflow actor.
 * Abuse controls use their own short-lived rate-limit keys; workflow records
 * must not contain a stable, brute-forceable derivative of the source IP.
 */
export function buildAnonymousUserId(): string {
  return `anon_${crypto.randomUUID()}`;
}
