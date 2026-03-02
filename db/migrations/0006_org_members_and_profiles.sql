-- 0006_org_members_and_profiles.sql
-- Organization membership (team management) and user profile tables.
-- organization_members: maps users to orgs with role/status.
-- user_profiles: pseudonymous user preferences (privacy-first, no PII beyond IdP).
-- Idempotent: safe to run multiple times.

-- ============================================================
-- ORGANIZATION MEMBERS
-- ============================================================
CREATE TABLE IF NOT EXISTS organization_members (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL,                 -- Microsoft Entra Object ID (pseudonymous)
  role                TEXT NOT NULL DEFAULT 'host_member'
                      CHECK (role IN ('host_member', 'host_admin')),
  status              TEXT NOT NULL DEFAULT 'invited'
                      CHECK (status IN ('invited', 'active', 'deactivated')),
  invited_by_user_id  TEXT,                          -- Entra Object ID of inviter
  invited_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  TEXT,                          -- Entra Object ID (pseudonymous)
  updated_by_user_id  TEXT,                          -- Entra Object ID (pseudonymous)
  UNIQUE(organization_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_org_members_org
  ON organization_members(organization_id);

CREATE INDEX IF NOT EXISTS idx_org_members_user
  ON organization_members(user_id);

CREATE INDEX IF NOT EXISTS idx_org_members_status
  ON organization_members(status);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_organization_members'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_organization_members
      BEFORE UPDATE ON organization_members
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- USER PROFILES
-- ============================================================
-- Privacy-first: stores pseudonymous preferences only.
-- display_name is user-chosen, NOT synced from IdP PII.
-- approximate_city is deliberately imprecise (no street address).
CREATE TABLE IF NOT EXISTS user_profiles (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             TEXT UNIQUE NOT NULL,          -- Microsoft Entra Object ID
  display_name        TEXT,                          -- User-chosen display name
  preferred_locale    TEXT DEFAULT 'en',
  approximate_city    TEXT,                          -- Deliberately imprecise location
  role                TEXT NOT NULL DEFAULT 'seeker'
                      CHECK (role IN ('seeker', 'host_member', 'host_admin', 'community_admin', 'oran_admin')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id  TEXT,                          -- Entra Object ID (pseudonymous)
  updated_by_user_id  TEXT                           -- Entra Object ID (pseudonymous)
);

-- Indexes (user_id UNIQUE already creates an index)
-- No additional indexes needed — user_id is the primary lookup key.

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_user_profiles'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_user_profiles
      BEFORE UPDATE ON user_profiles
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
