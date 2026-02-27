-- ============================================================
-- ORAN DEMO SEED DATA
-- ⚠️  DEMO ONLY - NOT REAL SERVICES ⚠️
-- All organizations, addresses, phone numbers, and services
-- in this file are ENTIRELY FICTIONAL.
-- City: "Demoville, DM 00000" does not exist.
-- Phone numbers use 555- prefix (reserved for fictional use).
-- DO NOT use this data in production.
-- ============================================================

-- Demo Taxonomy Terms
INSERT INTO taxonomy_terms (id, term, description, taxonomy) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Food Assistance', 'Programs providing food or nutrition support', 'demo'),
  ('a1000000-0000-0000-0000-000000000002', 'Housing', 'Housing assistance and shelter programs', 'demo'),
  ('a1000000-0000-0000-0000-000000000003', 'Mental Health', 'Counseling and mental health services', 'demo'),
  ('a1000000-0000-0000-0000-000000000004', 'Healthcare', 'Medical and health services', 'demo'),
  ('a1000000-0000-0000-0000-000000000005', 'Employment', 'Job training and employment services', 'demo')
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO ORGANIZATION 1: Demoville Community Food Bank
-- FICTIONAL - NOT A REAL ORGANIZATION
-- ============================================================
INSERT INTO organizations (id, name, description, url, email, legal_status) VALUES
  (
    'b1000000-0000-0000-0000-000000000001',
    'Demoville Community Food Bank [DEMO]',
    'DEMO ONLY: A fictional food bank for testing the ORAN platform.',
    'https://example.com/demo-food-bank',
    'demo@example.com',
    'nonprofit'
  );

INSERT INTO locations (id, organization_id, name, latitude, longitude) VALUES
  (
    'c1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'Demoville Food Bank Main Site [DEMO]',
    0.0,
    0.0
  );

INSERT INTO addresses (location_id, address_1, city, state_province, postal_code, country) VALUES
  (
    'c1000000-0000-0000-0000-000000000001',
    '123 Demo Street',
    'Demoville',
    'DM',
    '00000',
    'US'
  );

INSERT INTO phones (organization_id, location_id, number, type) VALUES
  (
    'b1000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    '555-010-0001',
    'voice'
  );

INSERT INTO services (id, organization_id, name, description, status, fees) VALUES
  (
    'd1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'Emergency Food Boxes [DEMO]',
    'DEMO ONLY: Fictional emergency food boxes for platform testing. Not a real service.',
    'active',
    'Free'
  ),
  (
    'd1000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000001',
    'Weekly Produce Distribution [DEMO]',
    'DEMO ONLY: Fictional weekly produce distribution for platform testing. Not a real service.',
    'active',
    'Free'
  );

INSERT INTO service_at_location (service_id, location_id) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001'),
  ('d1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000001');

INSERT INTO service_taxonomy (service_id, taxonomy_term_id) VALUES
  ('d1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001'),
  ('d1000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001');

INSERT INTO schedules (service_id, days, opens_at, closes_at, description) VALUES
  ('d1000000-0000-0000-0000-000000000001', ARRAY['MO', 'WE', 'FR'], '09:00', '17:00', 'Demo schedule — Monday, Wednesday, Friday 9am–5pm'),
  ('d1000000-0000-0000-0000-000000000002', ARRAY['SA'], '08:00', '12:00', 'Demo schedule — Saturday 8am–noon');

-- ============================================================
-- DEMO ORGANIZATION 2: Demo Housing Services Inc.
-- FICTIONAL - NOT A REAL ORGANIZATION
-- ============================================================
INSERT INTO organizations (id, name, description, legal_status) VALUES
  (
    'b1000000-0000-0000-0000-000000000002',
    'Demo Housing Services Inc. [DEMO]',
    'DEMO ONLY: A fictional housing services organization for testing.',
    'nonprofit'
  );

INSERT INTO locations (id, organization_id, name, latitude, longitude) VALUES
  (
    'c1000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000002',
    'Demo Housing Office [DEMO]',
    0.01,
    0.01
  );

INSERT INTO addresses (location_id, address_1, city, state_province, postal_code, country) VALUES
  (
    'c1000000-0000-0000-0000-000000000002',
    '456 Demo Avenue',
    'Demoville',
    'DM',
    '00000',
    'US'
  );

INSERT INTO phones (organization_id, number, type) VALUES
  ('b1000000-0000-0000-0000-000000000002', '555-010-0002', 'voice');

INSERT INTO services (id, organization_id, name, description, status, fees) VALUES
  (
    'd1000000-0000-0000-0000-000000000003',
    'b1000000-0000-0000-0000-000000000002',
    'Emergency Shelter Referral [DEMO]',
    'DEMO ONLY: Fictional emergency shelter referral for testing. Not a real service.',
    'active',
    'Free'
  ),
  (
    'd1000000-0000-0000-0000-000000000004',
    'b1000000-0000-0000-0000-000000000002',
    'Rental Assistance Program [DEMO]',
    'DEMO ONLY: Fictional rental assistance for testing. Not a real service.',
    'active',
    'Free — income limits apply'
  );

INSERT INTO service_at_location (service_id, location_id) VALUES
  ('d1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000002'),
  ('d1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000002');

INSERT INTO service_taxonomy (service_id, taxonomy_term_id) VALUES
  ('d1000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000002'),
  ('d1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000002');

-- ============================================================
-- DEMO ORGANIZATION 3: Demoville Wellness Center
-- FICTIONAL - NOT A REAL ORGANIZATION
-- ============================================================
INSERT INTO organizations (id, name, description, legal_status) VALUES
  (
    'b1000000-0000-0000-0000-000000000003',
    'Demoville Wellness Center [DEMO]',
    'DEMO ONLY: A fictional mental health and wellness center for testing.',
    'government'
  );

INSERT INTO locations (id, organization_id, name, latitude, longitude) VALUES
  (
    'c1000000-0000-0000-0000-000000000003',
    'b1000000-0000-0000-0000-000000000003',
    'Demo Wellness Center [DEMO]',
    0.02,
    -0.01
  );

INSERT INTO addresses (location_id, address_1, city, state_province, postal_code, country) VALUES
  (
    'c1000000-0000-0000-0000-000000000003',
    '789 Demo Boulevard',
    'Demoville',
    'DM',
    '00000',
    'US'
  );

INSERT INTO phones (organization_id, number, type) VALUES
  ('b1000000-0000-0000-0000-000000000003', '555-010-0003', 'voice');

INSERT INTO services (id, organization_id, name, description, status, fees) VALUES
  (
    'd1000000-0000-0000-0000-000000000005',
    'b1000000-0000-0000-0000-000000000003',
    'Individual Counseling [DEMO]',
    'DEMO ONLY: Fictional counseling service for testing. Not a real service.',
    'active',
    'Sliding scale'
  );

INSERT INTO service_at_location (service_id, location_id) VALUES
  ('d1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000003');

INSERT INTO service_taxonomy (service_id, taxonomy_term_id) VALUES
  ('d1000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000003');

-- ============================================================
-- Seed initial confidence scores for demo services
-- ============================================================
INSERT INTO confidence_scores (service_id, score, data_completeness, verification_recency, community_feedback, host_responsiveness, source_authority)
SELECT
  id,
  0.400 AS score,
  0.600 AS data_completeness,
  0.000 AS verification_recency,
  0.500 AS community_feedback,
  0.100 AS host_responsiveness,
  0.300 AS source_authority
FROM services
WHERE name LIKE '%[DEMO]%'
ON CONFLICT (service_id) DO NOTHING;
