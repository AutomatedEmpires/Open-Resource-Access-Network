-- ============================================================
-- ORAN DEMO SEED — CANONICAL PUBLICATION CHAIN
-- ⚠️  DEMO ONLY - NOT REAL SERVICES ⚠️
-- Grants the fictional Demoville services affirmative publication
-- authority so they pass the positive_authority seeker gate:
--   canonical_services(published, active, winning system)
--   + canonical_provenance(accepted)
--   + source_records(published) + source_feeds(active)
--   + source_systems(family<>manual, purpose=service_catalog).
-- Without this chain, db/seed/demo.sql services are invisible on
-- every public browse surface.
-- ============================================================

-- Demo source system (non-manual, trusted, publishable purpose)
INSERT INTO source_systems (id, name, family, trust_tier, is_active, resource_purpose, notes)
VALUES (
  'e1000000-0000-0000-0000-000000000001',
  'Demoville Open Data Portal [DEMO]',
  'government_open_data',
  'verified_publisher',
  true,
  'service_catalog',
  'DEMO ONLY: fictional source system so seeded services pass the positive_authority publication gate.'
)
ON CONFLICT DO NOTHING;

INSERT INTO source_feeds (id, source_system_id, feed_name, feed_type, is_active, feed_handler)
VALUES (
  'e2000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000001',
  'Demoville services feed [DEMO]',
  'json',
  true,
  'none'
)
ON CONFLICT DO NOTHING;

-- One published source record per demo service
INSERT INTO source_records (id, source_feed_id, source_record_type, source_record_id, payload_sha256, raw_payload, processing_status, processed_at)
SELECT
  ('e3000000-0000-0000-0000-00000000000' || n)::uuid,
  'e2000000-0000-0000-0000-000000000001',
  'service',
  'demo-service-' || n,
  'demo-sha-' || n,
  jsonb_build_object('demo', true, 'service', n),
  'published',
  now()
FROM generate_series(1, 5) AS n
ON CONFLICT DO NOTHING;

-- Canonical organizations mirroring the three demo orgs
INSERT INTO canonical_organizations (id, name, lifecycle_status, publication_status, winning_source_system_id, published_organization_id)
VALUES
  ('e4000000-0000-0000-0000-000000000001', 'Demoville Community Food Bank [DEMO]', 'active', 'published', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'),
  ('e4000000-0000-0000-0000-000000000002', 'Demoville Housing Services [DEMO]',    'active', 'published', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002'),
  ('e4000000-0000-0000-0000-000000000003', 'Demoville Wellness Center [DEMO]',     'active', 'published', 'e1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000003')
ON CONFLICT DO NOTHING;

-- Canonical services pointing at the published demo services
INSERT INTO canonical_services (id, canonical_organization_id, name, status, lifecycle_status, publication_status, winning_source_system_id, published_service_id)
VALUES
  ('e5000000-0000-0000-0000-000000000001', 'e4000000-0000-0000-0000-000000000001', 'Emergency Food Boxes [DEMO]',        'active', 'active', 'published', 'e1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000001'),
  ('e5000000-0000-0000-0000-000000000002', 'e4000000-0000-0000-0000-000000000001', 'Weekly Produce Distribution [DEMO]', 'active', 'active', 'published', 'e1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000002'),
  ('e5000000-0000-0000-0000-000000000003', 'e4000000-0000-0000-0000-000000000002', 'Emergency Shelter Referral [DEMO]',  'active', 'active', 'published', 'e1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000003'),
  ('e5000000-0000-0000-0000-000000000004', 'e4000000-0000-0000-0000-000000000002', 'Rental Assistance Program [DEMO]',   'active', 'active', 'published', 'e1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000004'),
  ('e5000000-0000-0000-0000-000000000005', 'e4000000-0000-0000-0000-000000000003', 'Individual Counseling [DEMO]',       'active', 'active', 'published', 'e1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000005')
ON CONFLICT DO NOTHING;

-- Accepted provenance linking each canonical service to its published record
INSERT INTO canonical_provenance (id, canonical_entity_type, canonical_entity_id, field_name, source_record_id, decision_status, decided_at, decided_by)
SELECT
  ('e6000000-0000-0000-0000-00000000000' || n)::uuid,
  'service',
  ('e5000000-0000-0000-0000-00000000000' || n)::uuid,
  'name',
  ('e3000000-0000-0000-0000-00000000000' || n)::uuid,
  'accepted',
  now(),
  'demo-seed'
FROM generate_series(1, 5) AS n
ON CONFLICT DO NOTHING;

-- ============================================================
-- NOTE: flag-gated seeker surfaces (plan workspace, reminders, execution
-- dashboard) stay dark by default. To expose them locally, flip the
-- seeker_plans_enabled / seeker_reminders_enabled /
-- seeker_execution_dashboard_enabled rows in feature_flags yourself —
-- deliberately NOT done by this seed so demo data never implies a rollout.
-- ============================================================
