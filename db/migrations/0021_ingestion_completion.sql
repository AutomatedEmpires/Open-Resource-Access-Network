-- Migration: 0021_ingestion_completion.sql
-- Purpose: Add missing tables for full ingestion agent pipeline completion.
-- Tables: verification_checks, verified_service_links, feed_subscriptions, admin_routing_rules

BEGIN;

-- ============================================================
-- VERIFICATION CHECKS
-- Per-candidate automated check results (domain allowlist,
-- contact validity, location plausibility, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT NOT NULL,
  check_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('critical', 'warning', 'info')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pass', 'fail', 'unknown', 'pending', 'skipped')),
  message TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  evidence_refs TEXT[] NOT NULL DEFAULT '{}',
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_verification_checks_candidate ON verification_checks(candidate_id);
CREATE INDEX idx_verification_checks_type ON verification_checks(check_type);
CREATE INDEX idx_verification_checks_status ON verification_checks(status);
CREATE UNIQUE INDEX idx_verification_checks_unique ON verification_checks(candidate_id, check_type);

-- ============================================================
-- VERIFIED SERVICE LINKS
-- Deep links discovered during ingestion, verified by admins,
-- and available for chat integration after publish.
-- ============================================================
CREATE TABLE IF NOT EXISTS verified_service_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id TEXT,
  service_id UUID,
  url TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  link_type TEXT NOT NULL DEFAULT 'other'
    CHECK (link_type IN ('home', 'contact', 'apply', 'eligibility',
      'intake_form', 'hours', 'pdf', 'privacy', 'service_page',
      'organization_home', 'other')),
  intent_actions TEXT[] NOT NULL DEFAULT '{}',
  intent_categories TEXT[] NOT NULL DEFAULT '{}',
  audience_tags TEXT[] NOT NULL DEFAULT '{}',
  locales TEXT[] NOT NULL DEFAULT '{}',
  is_verified BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  verified_by_user_id TEXT,
  last_checked_at TIMESTAMPTZ,
  last_http_status INTEGER,
  is_link_alive BOOLEAN DEFAULT true,
  evidence_id TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_verified_links_candidate ON verified_service_links(candidate_id);
CREATE INDEX idx_verified_links_service ON verified_service_links(service_id);
CREATE INDEX idx_verified_links_type ON verified_service_links(link_type);
CREATE INDEX idx_verified_links_verified ON verified_service_links(is_verified, is_link_alive);

-- ============================================================
-- FEED SUBSCRIPTIONS
-- RSS, sitemap, and API feed monitoring for automated discovery.
-- ============================================================
CREATE TABLE IF NOT EXISTS feed_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_registry_id UUID REFERENCES ingestion_sources(id),
  feed_url TEXT NOT NULL UNIQUE,
  feed_type TEXT NOT NULL DEFAULT 'rss'
    CHECK (feed_type IN ('rss', 'atom', 'sitemap', 'api', 'other')),
  display_name TEXT,
  poll_interval_hours INTEGER NOT NULL DEFAULT 24,
  last_polled_at TIMESTAMPTZ,
  last_etag TEXT,
  last_modified TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  jurisdiction_state TEXT,
  jurisdiction_county TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feed_subscriptions_active ON feed_subscriptions(is_active);
CREATE INDEX idx_feed_subscriptions_source ON feed_subscriptions(source_registry_id);
CREATE INDEX idx_feed_subscriptions_due ON feed_subscriptions(is_active, last_polled_at);

-- ============================================================
-- ADMIN ROUTING RULES
-- Maps jurisdictions to admin roles/users for candidate routing.
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction_country TEXT NOT NULL DEFAULT 'US',
  jurisdiction_state TEXT,
  jurisdiction_county TEXT,
  assigned_role TEXT NOT NULL DEFAULT 'community_admin'
    CHECK (assigned_role IN ('community_admin', 'oran_admin')),
  assigned_user_id TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_routing_rules_jurisdiction ON admin_routing_rules(
  jurisdiction_country, jurisdiction_state, jurisdiction_county
);
CREATE INDEX idx_admin_routing_rules_active ON admin_routing_rules(is_active);

COMMIT;
