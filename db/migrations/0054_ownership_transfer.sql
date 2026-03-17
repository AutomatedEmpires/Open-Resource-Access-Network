-- Migration: 0054_ownership_transfer
-- Adds the ownership_transfer table and supporting structures for
-- transferring community-admin-managed services to their real-world
-- organization owners when they sign up on ORAN.
--
-- Flow:
--   1. Org signs up and claims services via host portal
--   2. System detects existing crawled/community-managed services that match
--   3. ownership_transfers row created linking claim → existing service
--   4. Community admin notified, quota freed on approval
--   5. Service ownership moved to organization, audit trail recorded

-- ============================================================
-- OWNERSHIP TRANSFERS
-- ============================================================
CREATE TABLE IF NOT EXISTS ownership_transfers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The service being transferred
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  -- The organization claiming ownership
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Who initiated and who currently manages
  requested_by_user_id    TEXT NOT NULL,
  current_admin_user_id   TEXT,

  -- Submission that triggered this transfer (links to submissions table)
  submission_id   UUID REFERENCES submissions(id) ON DELETE SET NULL,

  -- Verification
  verification_method TEXT NOT NULL DEFAULT 'admin_review',
  -- domain_match | email_match | manual_review | admin_review
  verification_token  TEXT,
  verification_expires_at TIMESTAMP WITH TIME ZONE,
  verified_at         TIMESTAMP WITH TIME ZONE,

  -- Status machine: pending → verified → approved → completed | rejected | cancelled
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'approved', 'completed', 'rejected', 'cancelled')),

  -- Metadata
  transfer_notes  TEXT,
  admin_notes     TEXT,
  rejection_reason TEXT,

  -- Snapshot of service state at transfer time (for audit)
  service_snapshot JSONB NOT NULL DEFAULT '{}',

  -- Timestamps
  approved_at     TIMESTAMP WITH TIME ZONE,
  completed_at    TIMESTAMP WITH TIME ZONE,
  rejected_at     TIMESTAMP WITH TIME ZONE,
  created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_service
  ON ownership_transfers (service_id);
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_org
  ON ownership_transfers (organization_id);
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_status
  ON ownership_transfers (status);
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_admin
  ON ownership_transfers (current_admin_user_id)
  WHERE current_admin_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_submission
  ON ownership_transfers (submission_id)
  WHERE submission_id IS NOT NULL;

-- Only one active (non-terminal) transfer per service at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_ownership_transfers_active_service
  ON ownership_transfers (service_id)
  WHERE status IN ('pending', 'verified', 'approved');

-- ============================================================
-- ADD submission_type value 'ownership_transfer' support
-- (The submissions.submission_type is TEXT, so no ALTER needed —
--  we just document it here for SSOT)
-- ============================================================

-- ============================================================
-- ADD notification event types
-- (notification_events.event_type is TEXT, so no ALTER needed)
-- New event types:
--   'ownership_transfer_requested'
--   'ownership_transfer_approved'
--   'ownership_transfer_completed'
--   'ownership_transfer_rejected'
--   'admin_quota_freed'
-- ============================================================

-- ============================================================
-- ADMIN REVIEW PROFILES — track freed slots
-- Add transferred_out_count to track how many services were transferred
-- out of an admin's control (useful for metrics)
-- ============================================================
ALTER TABLE admin_review_profiles
  ADD COLUMN IF NOT EXISTS transferred_out_count INTEGER NOT NULL DEFAULT 0;
