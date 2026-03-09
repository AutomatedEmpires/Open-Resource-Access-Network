-- ============================================================
-- 0039 — Managed Form Vault
-- ============================================================
-- Submission-backed in-app form storage for ORAN admins, community
-- admins, and organization users. PostgreSQL remains the workflow
-- source of truth; Azure Blob Storage is reserved for large artifacts
-- referenced by deterministic blob prefixes.
-- ============================================================

CREATE TABLE IF NOT EXISTS form_templates (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  TEXT        NOT NULL UNIQUE,
  title                 TEXT        NOT NULL,
  description           TEXT,
  category              TEXT        NOT NULL DEFAULT 'general',
  audience_scope        TEXT        NOT NULL
    CHECK (audience_scope IN (
      'shared',
      'host_member',
      'host_admin',
      'community_admin',
      'oran_admin'
    )),
  storage_scope         TEXT        NOT NULL DEFAULT 'platform'
    CHECK (storage_scope IN ('platform', 'organization', 'community')),
  default_target_role   TEXT
    CHECK (default_target_role IN (
      'host_member',
      'host_admin',
      'community_admin',
      'oran_admin'
    )),
  schema_json           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  ui_schema_json        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  instructions_markdown TEXT,
  version               INTEGER     NOT NULL DEFAULT 1,
  is_published          BOOLEAN     NOT NULL DEFAULT false,
  blob_storage_prefix   TEXT,
  created_by_user_id    TEXT,
  updated_by_user_id    TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE form_templates IS
  'Fillable in-app form definitions. Metadata and schema live in Postgres; large attachment payloads may be stored in Blob Storage under deterministic prefixes.';

CREATE TABLE IF NOT EXISTS form_instances (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id             UUID        NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  template_id               UUID        NOT NULL REFERENCES form_templates(id) ON DELETE RESTRICT,
  template_version          INTEGER     NOT NULL,
  storage_scope             TEXT        NOT NULL
    CHECK (storage_scope IN ('platform', 'organization', 'community')),
  owner_organization_id     UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  coverage_zone_id          UUID        REFERENCES coverage_zones(id) ON DELETE SET NULL,
  recipient_role            TEXT
    CHECK (recipient_role IN (
      'host_member',
      'host_admin',
      'community_admin',
      'oran_admin'
    )),
  recipient_user_id         TEXT,
  recipient_organization_id UUID        REFERENCES organizations(id) ON DELETE SET NULL,
  blob_storage_prefix       TEXT,
  form_data                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  attachment_manifest       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  last_saved_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE form_instances IS
  'Per-submission fillable form state. Lifecycle status is owned by submissions + submission_transitions; this table stores form payload, recipients, and storage metadata.';

CREATE INDEX IF NOT EXISTS idx_form_templates_audience
  ON form_templates(audience_scope);

CREATE INDEX IF NOT EXISTS idx_form_templates_published
  ON form_templates(is_published)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS idx_form_templates_storage_scope
  ON form_templates(storage_scope);

CREATE INDEX IF NOT EXISTS idx_form_instances_template
  ON form_instances(template_id);

CREATE INDEX IF NOT EXISTS idx_form_instances_owner_org
  ON form_instances(owner_organization_id);

CREATE INDEX IF NOT EXISTS idx_form_instances_recipient_role
  ON form_instances(recipient_role);

CREATE INDEX IF NOT EXISTS idx_form_instances_recipient_org
  ON form_instances(recipient_organization_id);

CREATE INDEX IF NOT EXISTS idx_form_instances_coverage_zone
  ON form_instances(coverage_zone_id);

CREATE INDEX IF NOT EXISTS idx_form_instances_last_saved
  ON form_instances(last_saved_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'set_updated_at' AND n.nspname = 'public'
  ) THEN
    EXECUTE $trig$
      CREATE TRIGGER trg_form_templates_updated_at
        BEFORE UPDATE ON form_templates
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    $trig$;

    EXECUTE $trig$
      CREATE TRIGGER trg_form_instances_updated_at
        BEFORE UPDATE ON form_instances
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    $trig$;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;