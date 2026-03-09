-- Migration 0041: Organization Profile Extensions
--
-- Adds rich profile fields to the organizations table:
--   mission_statement  — public-facing mission text
--   who_we_serve       — plain-language population description
--   service_region     — human-readable geographic scope
--   social_links       — JSON map of social/contact links
--   verified_at        — when ORAN marked this org as verified
--   verified_by_user_id — which ORAN admin granted verified status
--
-- Also creates the org_service_scope table for listing-level
-- access control (which org members can edit which services).

-- ============================================================
-- 1. Org profile columns
-- ============================================================

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS mission_statement   TEXT,
  ADD COLUMN IF NOT EXISTS who_we_serve        TEXT,
  ADD COLUMN IF NOT EXISTS service_region      TEXT,
  ADD COLUMN IF NOT EXISTS social_links        JSONB    DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS verified_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by_user_id UUID     REFERENCES users(id) ON DELETE SET NULL;

-- Fast lookup for verified orgs (badge display, trust scoring)
CREATE INDEX IF NOT EXISTS idx_orgs_verified_at
  ON organizations(verified_at)
  WHERE verified_at IS NOT NULL;

-- ============================================================
-- 2. Listing-level access control
--
--  By default, all host_admin members of an org can edit all
--  that org's services. This table lets host_admins further
--  restrict which host_member accounts can touch a specific
--  service record.
--
--  Row presence = access granted.
--  Empty table = org-wide role rules apply (default).
-- ============================================================

CREATE TABLE IF NOT EXISTS org_service_scope (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID       NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_id      UUID       NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  user_id         UUID       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by      UUID                 REFERENCES users(id) ON DELETE SET NULL,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (service_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_oss_org_id     ON org_service_scope(organization_id);
CREATE INDEX IF NOT EXISTS idx_oss_service_id ON org_service_scope(service_id);
CREATE INDEX IF NOT EXISTS idx_oss_user_id    ON org_service_scope(user_id);

COMMENT ON TABLE org_service_scope IS
  'Optional per-listing access grants for host_member accounts. '
  'When no rows exist for a service, org-wide role rules apply.';
