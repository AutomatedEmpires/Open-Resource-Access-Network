-- ============================================================
-- 0029 — Content Templates Library (§2 Admin/Org/Community Templates)
-- ============================================================
-- Role-specific knowledge system: org onboarding, verification
-- guidelines, dispute handling, outreach messages, FAQs, policy
-- training. Templates are versioned, role-scoped, and audited.
-- ============================================================

-- ============================================================
-- TABLES
-- ============================================================

CREATE TABLE IF NOT EXISTS content_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           TEXT        NOT NULL,
  slug            TEXT        NOT NULL UNIQUE,
  role_scope      TEXT        NOT NULL
    CHECK (role_scope IN (
      'shared',
      'host_admin',
      'community_admin',
      'oran_admin'
    )),
  category        TEXT        NOT NULL
    CHECK (category IN (
      'faq',
      'outreach',
      'verification_script',
      'policy',
      'training',
      'onboarding',
      'dispute_handling'
    )),
  content_markdown TEXT       NOT NULL,
  tags            TEXT[]      NOT NULL DEFAULT '{}',
  language        TEXT        NOT NULL DEFAULT 'en',
  jurisdiction_scope TEXT     NULL,  -- NULL means all jurisdictions
  version         INTEGER     NOT NULL DEFAULT 1,
  is_published    BOOLEAN     NOT NULL DEFAULT false,
  created_by      UUID        NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  updated_by      UUID        NULL REFERENCES user_profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE content_templates IS
  'Role-scoped content templates for org onboarding, verification, outreach, and training. §2.';

COMMENT ON COLUMN content_templates.role_scope IS
  'Who can view this template: shared (all authenticated), host_admin, community_admin, oran_admin.';

COMMENT ON COLUMN content_templates.slug IS
  'URL-safe unique identifier. Used for stable deep-linking.';

COMMENT ON COLUMN content_templates.version IS
  'Monotonically incremented on each edit. Used for optimistic concurrency tracking.';

COMMENT ON COLUMN content_templates.is_published IS
  'Only published templates are shown in the library to non-editors.';

-- Optional usage tracking (no user PII — only role + template)
CREATE TABLE IF NOT EXISTS template_usage_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID        NOT NULL REFERENCES content_templates(id) ON DELETE CASCADE,
  action          TEXT        NOT NULL
    CHECK (action IN ('view', 'copy', 'use')),
  actor_role      TEXT        NOT NULL,   -- role at time of action, no user id
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE template_usage_events IS
  'Aggregate usage signals for the template library. No user PII stored — only role.';

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_templates_role_scope
  ON content_templates(role_scope);

CREATE INDEX IF NOT EXISTS idx_templates_category
  ON content_templates(category);

CREATE INDEX IF NOT EXISTS idx_templates_published
  ON content_templates(is_published)
  WHERE is_published = true;

CREATE INDEX IF NOT EXISTS idx_templates_language
  ON content_templates(language);

CREATE INDEX IF NOT EXISTS idx_templates_tags
  ON content_templates USING gin(tags);

CREATE INDEX IF NOT EXISTS idx_template_usage_template_id
  ON template_usage_events(template_id);

CREATE INDEX IF NOT EXISTS idx_template_usage_recorded_at
  ON template_usage_events(recorded_at DESC);

-- ============================================================
-- UPDATED_AT TRIGGER (matches existing pattern in the DB)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.proname = 'set_updated_at' AND n.nspname = 'public'
  ) THEN
    EXECUTE $trig$
      CREATE TRIGGER trg_content_templates_updated_at
        BEFORE UPDATE ON content_templates
        FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    $trig$;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
