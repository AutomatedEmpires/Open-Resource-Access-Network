-- 0036_seeker_profile_phase1_constraints.sql
-- Phase 1 structured seeker constraints that can be used immediately in deterministic chat retrieval.

BEGIN;

ALTER TABLE seeker_profiles
  ADD COLUMN IF NOT EXISTS transportation_barrier BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_delivery_modes TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS urgency_window TEXT,
  ADD COLUMN IF NOT EXISTS documentation_barriers TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS digital_access_barrier BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN seeker_profiles.transportation_barrier IS 'True when transportation limits materially affect which services are realistically reachable.';
COMMENT ON COLUMN seeker_profiles.preferred_delivery_modes IS 'Preferred ways to receive service such as in-person, virtual, phone, or hybrid.';
COMMENT ON COLUMN seeker_profiles.urgency_window IS 'Structured turnaround preference currently aligned to deterministic same-day or next-day availability tags.';
COMMENT ON COLUMN seeker_profiles.documentation_barriers IS 'Documentation or ID barriers that require providers with explicit no-ID, no-docs, or no-SSN policies.';
COMMENT ON COLUMN seeker_profiles.digital_access_barrier IS 'True when limited device or internet access should influence service-fit ranking.';

COMMIT;
