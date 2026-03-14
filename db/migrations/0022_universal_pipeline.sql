-- ============================================================
-- Migration 0022: Universal Pipeline + Two-Person Approval
-- ============================================================
-- Replaces verification_queue with a universal submissions table.
-- Adds submission_transitions for full audit history of state changes.
-- Adds submission_slas for deadline tracking.
-- Adds platform_scopes, platform_roles, role_scope_assignments,
-- user_scope_grants, pending_scope_grants, scope_audit_log for
-- Google-level RBAC scope center + two-person approval.
--
-- Strategy:
--   1. Create new tables
--   2. Migrate all verification_queue rows → submissions
--   3. Migrate verification_evidence FK → submissions
--   4. Rename verification_queue → verification_queue_archive
--   5. Create a compatibility view for safety
-- ============================================================

BEGIN;

-- ============================================================
-- 1. SUBMISSIONS (Universal Pipeline)
-- ============================================================

CREATE TABLE IF NOT EXISTS submissions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Polymorphic type discriminator
  submission_type     TEXT NOT NULL CHECK (
                        submission_type IN (
                          'service_verification',
                          'org_claim',
                          'data_correction',
                          'new_service',
                          'removal_request',
                          'community_report',
                          'appeal'
                        )
                      ),

  -- Status state machine
  status              TEXT NOT NULL DEFAULT 'draft' CHECK (
                        status IN (
                          'draft',
                          'submitted',
                          'auto_checking',
                          'needs_review',
                          'under_review',
                          'escalated',
                          'pending_second_approval',
                          'approved',
                          'denied',
                          'returned',
                          'withdrawn',
                          'expired',
                          'archived'
                        )
                      ),

  -- Polymorphic reference: the entity this submission is about
  -- For service_verification: references services.id
  -- For org_claim: references organizations.id
  -- For listing_edit: references services.id
  -- etc.
  target_type         TEXT NOT NULL DEFAULT 'service' CHECK (
                        target_type IN ('service', 'organization', 'location', 'user', 'system')
                      ),
  target_id           UUID,

  -- Legacy compatibility: direct service_id reference for
  -- verification workflows that previously used verification_queue
  service_id          UUID REFERENCES services(id) ON DELETE CASCADE,

  -- Who submitted this
  submitted_by_user_id TEXT NOT NULL,

  -- Who is currently assigned to review
  assigned_to_user_id  TEXT,

  -- Human-readable title (auto-generated or user-provided)
  title               TEXT,

  -- Free-text notes from submitter
  notes               TEXT,

  -- Free-text notes from reviewer
  reviewer_notes      TEXT,

  -- Structured payload for type-specific fields (validated by Zod at app layer)
  payload             JSONB NOT NULL DEFAULT '{}',

  -- Structured evidence/attachments metadata
  evidence            JSONB NOT NULL DEFAULT '[]',

  -- Priority for queue ordering (0 = normal, higher = more urgent)
  priority            INTEGER NOT NULL DEFAULT 0,

  -- Locking: prevents edits while under review
  is_locked           BOOLEAN NOT NULL DEFAULT false,
  locked_at           TIMESTAMPTZ,
  locked_by_user_id   TEXT,

  -- SLA tracking
  sla_deadline        TIMESTAMPTZ,
  sla_breached        BOOLEAN NOT NULL DEFAULT false,

  -- Jurisdiction for routing
  jurisdiction_state  TEXT,
  jurisdiction_county TEXT,

  -- Timestamps
  submitted_at        TIMESTAMPTZ,
  reviewed_at         TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Core query indexes
CREATE INDEX idx_submissions_type ON submissions(submission_type);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_target ON submissions(target_type, target_id);
CREATE INDEX idx_submissions_service ON submissions(service_id);
CREATE INDEX idx_submissions_submitter ON submissions(submitted_by_user_id);
CREATE INDEX idx_submissions_assigned ON submissions(assigned_to_user_id);
CREATE INDEX idx_submissions_priority ON submissions(priority DESC, created_at ASC);
CREATE INDEX idx_submissions_sla ON submissions(sla_deadline) WHERE sla_breached = false AND sla_deadline IS NOT NULL;
CREATE INDEX idx_submissions_jurisdiction ON submissions(jurisdiction_state, jurisdiction_county);
CREATE INDEX idx_submissions_created ON submissions(created_at ASC);
CREATE INDEX idx_submissions_type_status ON submissions(submission_type, status);

-- ============================================================
-- 2. SUBMISSION TRANSITIONS (Full State Audit Trail)
-- ============================================================

CREATE TABLE IF NOT EXISTS submission_transitions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_id       UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,

  from_status         TEXT NOT NULL,
  to_status           TEXT NOT NULL,

  -- Who triggered this transition
  actor_user_id       TEXT NOT NULL,
  actor_role          TEXT,

  -- Why the transition happened
  reason              TEXT,

  -- Gate conditions that were checked
  gates_checked       JSONB NOT NULL DEFAULT '[]',
  gates_passed        BOOLEAN NOT NULL DEFAULT true,

  -- Metadata
  metadata            JSONB NOT NULL DEFAULT '{}',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sub_transitions_submission ON submission_transitions(submission_id);
CREATE INDEX idx_sub_transitions_actor ON submission_transitions(actor_user_id);
CREATE INDEX idx_sub_transitions_created ON submission_transitions(created_at);
CREATE INDEX idx_sub_transitions_status ON submission_transitions(to_status);

-- ============================================================
-- 3. SUBMISSION SLAS (Deadline Rules per Type + Jurisdiction)
-- ============================================================

CREATE TABLE IF NOT EXISTS submission_slas (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submission_type     TEXT NOT NULL,
  jurisdiction_state  TEXT,
  jurisdiction_county TEXT,

  -- SLA duration in hours from submission to expected resolution
  review_hours        INTEGER NOT NULL DEFAULT 48,
  escalation_hours    INTEGER NOT NULL DEFAULT 72,

  -- Who gets notified on breach
  notify_on_breach    TEXT[] DEFAULT '{}',

  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sub_slas_type ON submission_slas(submission_type);
CREATE INDEX idx_sub_slas_jurisdiction ON submission_slas(jurisdiction_state, jurisdiction_county);

-- ============================================================
-- 4. PLATFORM SCOPES (Global Scope Registry)
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_scopes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL UNIQUE,
  description         TEXT NOT NULL,
  category            TEXT NOT NULL CHECK (
                        category IN (
                          'platform',
                          'organization',
                          'service',
                          'verification',
                          'review',
                          'user',
                          'ingestion',
                          'audit',
                          'system'
                        )
                      ),

  -- Risk level determines approval requirements
  risk_level          TEXT NOT NULL DEFAULT 'standard' CHECK (
                        risk_level IN ('low', 'standard', 'high', 'critical')
                      ),

  -- Whether granting this scope requires two-person approval
  requires_approval   BOOLEAN NOT NULL DEFAULT false,

  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_scopes_category ON platform_scopes(category);
CREATE INDEX idx_platform_scopes_risk ON platform_scopes(risk_level);

-- ============================================================
-- 5. PLATFORM ROLES (Role Templates)
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_roles (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL UNIQUE,
  description         TEXT NOT NULL,

  -- System roles cannot be deleted or modified by admins
  is_system           BOOLEAN NOT NULL DEFAULT false,

  -- Whether this role is org-scoped (vs platform-wide)
  is_org_scoped       BOOLEAN NOT NULL DEFAULT false,

  -- Role hierarchy level (matches OranRole levels for backward compat)
  hierarchy_level     INTEGER NOT NULL DEFAULT 0,

  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_platform_roles_active ON platform_roles(is_active);

-- ============================================================
-- 6. ROLE SCOPE ASSIGNMENTS (Role → Scope mappings)
-- ============================================================

CREATE TABLE IF NOT EXISTS role_scope_assignments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id             UUID NOT NULL REFERENCES platform_roles(id) ON DELETE CASCADE,
  scope_id            UUID NOT NULL REFERENCES platform_scopes(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(role_id, scope_id)
);

CREATE INDEX idx_role_scopes_role ON role_scope_assignments(role_id);
CREATE INDEX idx_role_scopes_scope ON role_scope_assignments(scope_id);

-- ============================================================
-- 7. USER SCOPE GRANTS (Direct scope grants to users)
-- ============================================================

CREATE TABLE IF NOT EXISTS user_scope_grants (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             TEXT NOT NULL,
  scope_id            UUID NOT NULL REFERENCES platform_scopes(id) ON DELETE CASCADE,

  -- Optional org scoping (NULL = platform-wide)
  organization_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Who granted this
  granted_by_user_id  TEXT NOT NULL,
  granted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Expiration (NULL = permanent)
  expires_at          TIMESTAMPTZ,

  -- Whether this grant is active
  is_active           BOOLEAN NOT NULL DEFAULT true,

  -- If this required two-person approval, link to the approval record
  approval_id         UUID,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, scope_id, organization_id)
);

CREATE INDEX idx_user_scopes_user ON user_scope_grants(user_id);
CREATE INDEX idx_user_scopes_scope ON user_scope_grants(scope_id);
CREATE INDEX idx_user_scopes_org ON user_scope_grants(organization_id);
CREATE INDEX idx_user_scopes_active ON user_scope_grants(is_active, expires_at);

-- ============================================================
-- 8. PENDING SCOPE GRANTS (Two-Person Approval Queue)
-- ============================================================

CREATE TABLE IF NOT EXISTS pending_scope_grants (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- What is being requested
  user_id             TEXT NOT NULL,
  scope_id            UUID NOT NULL REFERENCES platform_scopes(id) ON DELETE CASCADE,
  organization_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,

  -- Who requested this grant
  requested_by_user_id TEXT NOT NULL,
  requested_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Justification (required for high-risk scopes)
  justification       TEXT NOT NULL,

  -- Status of the approval
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (
                        status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')
                      ),

  -- Who approved/denied
  decided_by_user_id  TEXT,
  decided_at          TIMESTAMPTZ,
  decision_reason     TEXT,

  -- Must not be approved by the same person who requested
  -- Enforced at app layer (cannot self-approve)

  -- Expiration: pending requests expire after N hours
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '72 hours'),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pending_grants_status ON pending_scope_grants(status);
CREATE INDEX idx_pending_grants_user ON pending_scope_grants(user_id);
CREATE INDEX idx_pending_grants_requester ON pending_scope_grants(requested_by_user_id);
CREATE INDEX idx_pending_grants_expires ON pending_scope_grants(expires_at) WHERE status = 'pending';

-- ============================================================
-- 9. SCOPE AUDIT LOG
-- ============================================================

CREATE TABLE IF NOT EXISTS scope_audit_log (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id       TEXT NOT NULL,
  actor_role          TEXT,
  action              TEXT NOT NULL CHECK (
                        action IN (
                          'scope_created', 'scope_updated', 'scope_deactivated',
                          'role_created', 'role_updated', 'role_deactivated',
                          'scope_assigned_to_role', 'scope_removed_from_role',
                          'scope_granted_to_user', 'scope_revoked_from_user',
                          'grant_requested', 'grant_approved', 'grant_denied',
                          'grant_expired', 'grant_cancelled',
                          'break_glass_activated', 'break_glass_deactivated',
                          'submission_assigned'
                        )
                      ),
  target_type         TEXT NOT NULL CHECK (
                        target_type IN ('scope', 'role', 'user_grant', 'pending_grant', 'submission', 'system')
                      ),
  target_id           TEXT NOT NULL,
  before_state        JSONB,
  after_state         JSONB,
  justification       TEXT,
  ip_digest           TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_scope_audit_actor ON scope_audit_log(actor_user_id);
CREATE INDEX idx_scope_audit_action ON scope_audit_log(action);
CREATE INDEX idx_scope_audit_target ON scope_audit_log(target_type, target_id);
CREATE INDEX idx_scope_audit_created ON scope_audit_log(created_at);

-- ============================================================
-- 10. NOTIFICATION EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_events (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_user_id   TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  channel             TEXT NOT NULL DEFAULT 'in_app' CHECK (
                        channel IN ('in_app', 'email', 'sms')
                      ),
  title               TEXT NOT NULL,
  body                TEXT NOT NULL,

  -- Link to relevant resource
  resource_type       TEXT,
  resource_id         TEXT,
  action_url          TEXT,

  -- Delivery status
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (
                        status IN ('pending', 'sent', 'delivered', 'read', 'failed')
                      ),
  sent_at             TIMESTAMPTZ,
  read_at             TIMESTAMPTZ,

  -- Prevent duplicate notifications
  idempotency_key     TEXT UNIQUE,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient ON notification_events(recipient_user_id, status);
CREATE INDEX idx_notifications_type ON notification_events(event_type);
CREATE INDEX idx_notifications_created ON notification_events(created_at);
CREATE INDEX idx_notifications_unread ON notification_events(recipient_user_id)
  WHERE status IN ('pending', 'sent', 'delivered');

-- ============================================================
-- 11. NOTIFICATION PREFERENCES
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  channel             TEXT NOT NULL DEFAULT 'in_app',
  enabled             BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, event_type, channel)
);

CREATE INDEX idx_notif_prefs_user ON notification_preferences(user_id);

-- ============================================================
-- 12. DATA MIGRATION: verification_queue → submissions
-- ============================================================

-- Migrate all existing verification_queue rows into submissions
INSERT INTO submissions (
  id,
  submission_type,
  status,
  target_type,
  target_id,
  service_id,
  submitted_by_user_id,
  assigned_to_user_id,
  notes,
  submitted_at,
  created_at,
  updated_at
)
SELECT
  vq.id,
  -- Determine submission_type based on context:
  -- If the service description contains 'Placeholder service created during organization claim'
  -- then this was an org_claim, otherwise it's a service_verification
  CASE
    WHEN s.description ILIKE '%Placeholder service created during organization claim%'
    THEN 'org_claim'
    ELSE 'service_verification'
  END AS submission_type,
  -- Map old statuses to new statuses
  CASE vq.status
    WHEN 'pending' THEN 'submitted'
    WHEN 'in_review' THEN 'under_review'
    WHEN 'verified' THEN 'approved'
    WHEN 'rejected' THEN 'denied'
    WHEN 'escalated' THEN 'escalated'
    ELSE 'submitted'
  END AS status,
  -- Target type
  CASE
    WHEN s.description ILIKE '%Placeholder service created during organization claim%'
    THEN 'organization'
    ELSE 'service'
  END AS target_type,
  -- Target ID
  CASE
    WHEN s.description ILIKE '%Placeholder service created during organization claim%'
    THEN s.organization_id
    ELSE vq.service_id
  END AS target_id,
  vq.service_id,
  vq.submitted_by_user_id,
  vq.assigned_to_user_id,
  vq.notes,
  vq.created_at AS submitted_at,
  vq.created_at,
  vq.updated_at
FROM verification_queue vq
JOIN services s ON s.id = vq.service_id
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 13. MIGRATE verification_evidence FK
-- ============================================================

-- Add submission_id column to verification_evidence
ALTER TABLE verification_evidence
  ADD COLUMN IF NOT EXISTS submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL;

-- Backfill submission_id from the migrated data
UPDATE verification_evidence ve
SET submission_id = ve.queue_entry_id::uuid
WHERE EXISTS (SELECT 1 FROM submissions s WHERE s.id = ve.queue_entry_id::uuid);

CREATE INDEX IF NOT EXISTS idx_verification_evidence_submission
  ON verification_evidence(submission_id);

-- ============================================================
-- 14. ARCHIVE verification_queue
-- ============================================================

-- Rename the old table for archival (not dropped — preserves data safety)
ALTER TABLE verification_queue RENAME TO verification_queue_archive;

-- Rename old indexes to avoid confusion
ALTER INDEX IF EXISTS idx_vq_service RENAME TO idx_vq_archive_service;
ALTER INDEX IF EXISTS idx_vq_status RENAME TO idx_vq_archive_status;
ALTER INDEX IF EXISTS idx_vq_assigned_to_user_id RENAME TO idx_vq_archive_assigned;
ALTER INDEX IF EXISTS idx_vq_status_created RENAME TO idx_vq_archive_status_created;

-- ============================================================
-- 15. COMPATIBILITY VIEW
-- ============================================================

-- Create a view that maps submissions back to the old verification_queue shape.
-- This ensures any read-only queries that haven't been migrated yet still work.
CREATE OR REPLACE VIEW verification_queue AS
SELECT
  s.id,
  s.service_id,
  CASE s.status
    WHEN 'submitted' THEN 'pending'
    WHEN 'auto_checking' THEN 'pending'
    WHEN 'needs_review' THEN 'pending'
    WHEN 'under_review' THEN 'in_review'
    WHEN 'pending_second_approval' THEN 'in_review'
    WHEN 'approved' THEN 'verified'
    WHEN 'denied' THEN 'rejected'
    WHEN 'returned' THEN 'rejected'
    WHEN 'escalated' THEN 'escalated'
    WHEN 'withdrawn' THEN 'rejected'
    WHEN 'expired' THEN 'rejected'
    WHEN 'archived' THEN 'rejected'
    ELSE 'pending'
  END AS status,
  s.submitted_by_user_id,
  s.assigned_to_user_id,
  s.notes,
  s.created_at,
  s.updated_at
FROM submissions s
WHERE s.submission_type IN ('service_verification', 'org_claim');

-- ============================================================
-- 16. UPDATED_AT TRIGGER for new tables
-- ============================================================

-- Reuse the set_updated_at function from migration 0001
CREATE TRIGGER trg_set_updated_at_submissions
  BEFORE UPDATE ON submissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_set_updated_at_submission_slas
  BEFORE UPDATE ON submission_slas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_set_updated_at_platform_scopes
  BEFORE UPDATE ON platform_scopes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_set_updated_at_platform_roles
  BEFORE UPDATE ON platform_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_set_updated_at_user_scope_grants
  BEFORE UPDATE ON user_scope_grants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_set_updated_at_pending_scope_grants
  BEFORE UPDATE ON pending_scope_grants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_set_updated_at_notification_preferences
  BEFORE UPDATE ON notification_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- 17. SEED DEFAULT PLATFORM SCOPES (60+)
-- ============================================================

INSERT INTO platform_scopes (name, description, category, risk_level, requires_approval) VALUES
  -- Platform administration (critical)
  ('platform:admin:manage_scopes', 'Create, edit, and deactivate platform scopes', 'platform', 'critical', true),
  ('platform:admin:manage_roles', 'Create, edit, and deactivate platform roles', 'platform', 'critical', true),
  ('platform:admin:grant_scopes', 'Grant scopes to users', 'platform', 'critical', true),
  ('platform:admin:revoke_scopes', 'Revoke scopes from users', 'platform', 'high', true),
  ('platform:admin:manage_admins', 'Add or remove platform administrators', 'platform', 'critical', true),
  ('platform:admin:break_glass', 'Emergency override — bypasses all permission checks', 'platform', 'critical', true),
  ('platform:admin:manage_feature_flags', 'Enable/disable feature flags', 'platform', 'high', true),
  ('platform:admin:manage_slas', 'Configure SLA deadlines per submission type', 'platform', 'high', false),
  ('platform:admin:view_audit_logs', 'View all audit logs (platform + scope)', 'audit', 'standard', false),
  ('platform:admin:manage_system_settings', 'Modify system-wide settings', 'platform', 'critical', true),

  -- Organization management
  ('org:read', 'View organization profiles and details', 'organization', 'low', false),
  ('org:create', 'Create new organizations', 'organization', 'standard', false),
  ('org:update:own', 'Edit own organization profile', 'organization', 'low', false),
  ('org:update:any', 'Edit any organization profile', 'organization', 'high', false),
  ('org:delete:own', 'Delete own organization', 'organization', 'high', false),
  ('org:delete:any', 'Delete any organization', 'organization', 'critical', true),
  ('org:claim', 'Submit an organization claim', 'organization', 'standard', false),
  ('org:approve_claim', 'Approve or deny organization claims', 'organization', 'high', false),
  ('org:manage_members', 'Invite, edit, or remove org team members', 'organization', 'standard', false),
  ('org:manage_roles', 'Assign roles to org team members', 'organization', 'standard', false),
  ('org:verify', 'Submit org for verification', 'organization', 'standard', false),

  -- Service / Listing management
  ('service:read', 'View service listings', 'service', 'low', false),
  ('service:create:own', 'Create listings for own organization', 'service', 'standard', false),
  ('service:create:any', 'Create listings for any organization', 'service', 'high', false),
  ('service:update:own', 'Edit own organization listings', 'service', 'low', false),
  ('service:update:any', 'Edit any listing', 'service', 'high', false),
  ('service:delete:own', 'Delete own organization listings', 'service', 'standard', false),
  ('service:delete:any', 'Delete any listing', 'service', 'critical', true),
  ('service:publish', 'Publish a listing (make visible to seekers)', 'service', 'high', false),
  ('service:unpublish', 'Unpublish a listing (hide from seekers)', 'service', 'high', false),
  ('service:merge', 'Merge duplicate listings', 'service', 'high', true),

  -- Verification workflows
  ('verification:submit', 'Submit items for verification', 'verification', 'standard', false),
  ('verification:review', 'Review verification queue entries', 'verification', 'standard', false),
  ('verification:approve', 'Approve verification entries', 'verification', 'high', false),
  ('verification:reject', 'Reject verification entries', 'verification', 'standard', false),
  ('verification:escalate', 'Escalate verification entries', 'verification', 'standard', false),
  ('verification:override_score', 'Override trust/confidence scores', 'verification', 'high', true),
  ('verification:manage_evidence', 'Upload and manage verification evidence', 'verification', 'standard', false),

  -- Review / Triage
  ('review:queue:read', 'View submission review queues', 'review', 'low', false),
  ('review:queue:claim', 'Claim a queue entry for review', 'review', 'standard', false),
  ('review:queue:assign', 'Assign queue entries to other reviewers', 'review', 'standard', false),
  ('review:queue:bulk_action', 'Perform bulk actions on queue entries', 'review', 'high', false),
  ('review:dispute:read', 'View dispute/appeal submissions', 'review', 'standard', false),
  ('review:dispute:resolve', 'Resolve disputes and appeals', 'review', 'high', false),
  ('review:fraud:read', 'View flagged/fraud submissions', 'review', 'standard', false),
  ('review:fraud:resolve', 'Resolve fraud reports', 'review', 'high', false),

  -- User management
  ('user:read:own_profile', 'View own user profile', 'user', 'low', false),
  ('user:update:own_profile', 'Edit own user profile', 'user', 'low', false),
  ('user:read:any_profile', 'View any user profile', 'user', 'standard', false),
  ('user:update:any_profile', 'Edit any user profile', 'user', 'high', true),
  ('user:deactivate', 'Deactivate a user account', 'user', 'high', true),
  ('user:manage_notifications', 'Manage own notification preferences', 'user', 'low', false),

  -- Ingestion pipeline
  ('ingestion:read_sources', 'View ingestion source registry', 'ingestion', 'low', false),
  ('ingestion:manage_sources', 'Create, edit, delete ingestion sources', 'ingestion', 'high', false),
  ('ingestion:trigger_jobs', 'Trigger ingestion batch jobs', 'ingestion', 'high', false),
  ('ingestion:read_candidates', 'View extracted candidates', 'ingestion', 'low', false),
  ('ingestion:review_candidates', 'Review and decide on candidates', 'ingestion', 'standard', false),
  ('ingestion:publish_candidates', 'Publish candidates as live services', 'ingestion', 'high', false),
  ('ingestion:manage_tags', 'Manage resource tags and confirmations', 'ingestion', 'standard', false),
  ('ingestion:manage_llm_suggestions', 'Review LLM-generated suggestions', 'ingestion', 'standard', false),

  -- Audit
  ('audit:read:platform', 'View platform audit logs', 'audit', 'standard', false),
  ('audit:read:scope', 'View scope change audit logs', 'audit', 'standard', false),
  ('audit:read:ingestion', 'View ingestion audit events', 'audit', 'low', false),
  ('audit:export', 'Export audit data for compliance', 'audit', 'high', false),

  -- System
  ('system:manage_coverage_zones', 'Create, edit, delete coverage zones', 'system', 'high', false),
  ('system:manage_routing_rules', 'Manage admin routing rules', 'system', 'high', false),
  ('system:manage_publish_criteria', 'Manage jurisdiction publish criteria', 'system', 'high', false),
  ('system:manage_taxonomy', 'Manage taxonomy terms and categories', 'system', 'standard', false),
  ('system:manage_notifications', 'Manage notification templates and settings', 'system', 'high', false)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- 18. SEED DEFAULT PLATFORM ROLES
-- ============================================================

INSERT INTO platform_roles (name, description, is_system, is_org_scoped, hierarchy_level) VALUES
  ('viewer', 'Read-only access to public resources', true, false, 0),
  ('seeker', 'Authenticated seeker — can save services, submit feedback', true, false, 0),
  ('org_editor', 'Can edit listings within their organization', true, true, 1),
  ('org_verifier', 'Can verify listings within their organization', true, true, 1),
  ('org_request_handler', 'Can respond to inbound seeker requests', true, true, 1),
  ('org_admin', 'Full admin of their organization', true, true, 2),
  ('triager', 'Can triage and assign queue entries (cannot approve)', true, false, 3),
  ('reviewer', 'Can review and approve/deny queue entries', true, false, 3),
  ('approver', 'Can approve high-impact actions (scopes, merges)', true, false, 4),
  ('super_admin', 'Full platform access — scope authority', true, false, 5)
ON CONFLICT (name) DO NOTHING;

-- Wire default role→scope mappings for system roles
-- (seeker role scopes)
INSERT INTO role_scope_assignments (role_id, scope_id)
SELECT r.id, s.id FROM platform_roles r, platform_scopes s
WHERE r.name = 'seeker' AND s.name IN (
  'service:read', 'user:read:own_profile', 'user:update:own_profile',
  'user:manage_notifications', 'org:read'
)
ON CONFLICT (role_id, scope_id) DO NOTHING;

-- (org_editor scopes)
INSERT INTO role_scope_assignments (role_id, scope_id)
SELECT r.id, s.id FROM platform_roles r, platform_scopes s
WHERE r.name = 'org_editor' AND s.name IN (
  'service:read', 'service:create:own', 'service:update:own', 'service:delete:own',
  'org:read', 'org:update:own', 'user:read:own_profile', 'user:update:own_profile',
  'user:manage_notifications', 'verification:submit'
)
ON CONFLICT (role_id, scope_id) DO NOTHING;

-- (org_admin scopes)
INSERT INTO role_scope_assignments (role_id, scope_id)
SELECT r.id, s.id FROM platform_roles r, platform_scopes s
WHERE r.name = 'org_admin' AND s.name IN (
  'service:read', 'service:create:own', 'service:update:own', 'service:delete:own',
  'org:read', 'org:update:own', 'org:delete:own', 'org:claim', 'org:manage_members',
  'org:manage_roles', 'org:verify', 'verification:submit', 'verification:manage_evidence',
  'user:read:own_profile', 'user:update:own_profile', 'user:manage_notifications'
)
ON CONFLICT (role_id, scope_id) DO NOTHING;

-- (reviewer scopes)
INSERT INTO role_scope_assignments (role_id, scope_id)
SELECT r.id, s.id FROM platform_roles r, platform_scopes s
WHERE r.name = 'reviewer' AND s.name IN (
  'service:read', 'org:read', 'verification:review', 'verification:approve',
  'verification:reject', 'verification:escalate', 'verification:manage_evidence',
  'review:queue:read', 'review:queue:claim', 'review:dispute:read',
  'ingestion:read_candidates', 'ingestion:review_candidates',
  'ingestion:manage_tags', 'ingestion:manage_llm_suggestions',
  'audit:read:ingestion', 'user:read:own_profile', 'user:update:own_profile',
  'user:manage_notifications'
)
ON CONFLICT (role_id, scope_id) DO NOTHING;

-- (super_admin gets ALL scopes)
INSERT INTO role_scope_assignments (role_id, scope_id)
SELECT r.id, s.id FROM platform_roles r, platform_scopes s
WHERE r.name = 'super_admin'
ON CONFLICT (role_id, scope_id) DO NOTHING;

COMMIT;
