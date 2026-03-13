-- Migration: Add 'curated' to trust_tier CHECK constraint
-- Rationale: TRUST_TIER_CONFIDENCE map in normalizeSourceRecord.ts includes
-- 'curated' at confidence 75, but the DB CHECK constraint lacked it —
-- any source_system with trustTier='curated' would fail on INSERT.

ALTER TABLE source_systems
  DROP CONSTRAINT IF EXISTS source_systems_trust_tier_check;

ALTER TABLE source_systems
  ADD CONSTRAINT source_systems_trust_tier_check
    CHECK (trust_tier IN (
      'verified_publisher',
      'trusted_partner',
      'curated',
      'community',
      'quarantine',
      'blocked'
    ));
