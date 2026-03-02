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
INSERT INTO confidence_scores (service_id, score, verification_confidence, eligibility_match, constraint_fit)
SELECT
  id,
  40.0 AS score,
  35.0 AS verification_confidence,
  45.0 AS eligibility_match,
  40.0 AS constraint_fit
FROM services
WHERE name LIKE '%[DEMO]%'
ON CONFLICT (service_id) DO NOTHING;

-- ============================================================
-- DEMO COVERAGE ZONES (fictional — geometry uses small Null-Island area)
-- ============================================================
INSERT INTO coverage_zones (id, name, description, geometry, assigned_user_id, status) VALUES
  (
    'e1000000-0000-0000-0000-000000000001',
    'Demoville Central Zone [DEMO]',
    'DEMO ONLY: Fictional coverage zone covering central Demoville.',
    ST_GeomFromText('POLYGON((
      -0.02 -0.02,
       0.02 -0.02,
       0.02  0.02,
      -0.02  0.02,
      -0.02 -0.02
    ))', 4326),
    'demo-entra-user-001',
    'active'
  ),
  (
    'e1000000-0000-0000-0000-000000000002',
    'Demoville East Zone [DEMO]',
    'DEMO ONLY: Fictional coverage zone for eastern Demoville.',
    ST_GeomFromText('POLYGON((
       0.02 -0.02,
       0.06 -0.02,
       0.06  0.02,
       0.02  0.02,
       0.02 -0.02
    ))', 4326),
    'demo-entra-user-002',
    'inactive'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO ORGANIZATION MEMBERS
-- ============================================================
INSERT INTO organization_members (id, organization_id, user_id, role, status, invited_by_user_id, activated_at) VALUES
  (
    'f1000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'demo-entra-user-003',
    'host_admin',
    'active',
    'demo-entra-user-001',
    now()
  ),
  (
    'f1000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000001',
    'demo-entra-user-004',
    'host_member',
    'invited',
    'demo-entra-user-003',
    NULL
  ),
  (
    'f1000000-0000-0000-0000-000000000003',
    'b1000000-0000-0000-0000-000000000002',
    'demo-entra-user-005',
    'host_admin',
    'active',
    'demo-entra-user-001',
    now()
  ),
  (
    'f1000000-0000-0000-0000-000000000004',
    'b1000000-0000-0000-0000-000000000003',
    'demo-entra-user-006',
    'host_admin',
    'deactivated',
    'demo-entra-user-001',
    now() - interval '30 days'
  )
ON CONFLICT (organization_id, user_id) DO NOTHING;

-- ============================================================
-- DEMO USER PROFILES
-- ============================================================
INSERT INTO user_profiles (id, user_id, display_name, preferred_locale, approximate_city, role) VALUES
  (
    'f2000000-0000-0000-0000-000000000001',
    'demo-entra-user-001',
    'Demo Community Admin',
    'en',
    'Demoville',
    'community_admin'
  ),
  (
    'f2000000-0000-0000-0000-000000000002',
    'demo-entra-user-002',
    'Demo Community Admin 2',
    'es',
    'Demoville',
    'community_admin'
  ),
  (
    'f2000000-0000-0000-0000-000000000003',
    'demo-entra-user-003',
    'Demo Host Admin',
    'en',
    'Demoville',
    'host_admin'
  ),
  (
    'f2000000-0000-0000-0000-000000000004',
    'demo-entra-user-004',
    'Demo Host Member',
    'en',
    'Demoville',
    'host_member'
  ),
  (
    'f2000000-0000-0000-0000-000000000005',
    'demo-entra-user-005',
    'Demo Housing Admin',
    'en',
    'Demoville',
    'host_admin'
  ),
  (
    'f2000000-0000-0000-0000-000000000006',
    'demo-entra-user-006',
    NULL,
    'en',
    NULL,
    'seeker'
  )
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- DEMO PROGRAMS (funding streams that group services)
-- ============================================================
INSERT INTO programs (id, organization_id, name, alternate_name, description) VALUES
  (
    'f3000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    'Emergency Food Assistance Program [DEMO]',
    'EFAP [DEMO]',
    'DEMO ONLY: Fictional emergency food distribution program.'
  ),
  (
    'f3000000-0000-0000-0000-000000000002',
    'b1000000-0000-0000-0000-000000000002',
    'Section 8 Housing Choice Voucher [DEMO]',
    'Section 8 [DEMO]',
    'DEMO ONLY: Fictional rental assistance voucher program.'
  ),
  (
    'f3000000-0000-0000-0000-000000000003',
    'b1000000-0000-0000-0000-000000000003',
    'Community Mental Health Grant [DEMO]',
    NULL,
    'DEMO ONLY: Fictional grant-funded counseling program.'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO ELIGIBILITY CRITERIA
-- ============================================================
INSERT INTO eligibility (id, service_id, description, minimum_age, maximum_age, eligible_values) VALUES
  (
    'f4000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'Open to all Demoville residents [DEMO]',
    NULL, NULL,
    NULL
  ),
  (
    'f4000000-0000-0000-0000-000000000002',
    'd1000000-0000-0000-0000-000000000003',
    'Must be 18 or older [DEMO]',
    18, NULL,
    NULL
  ),
  (
    'f4000000-0000-0000-0000-000000000003',
    'd1000000-0000-0000-0000-000000000003',
    'Priority for veterans and families with children [DEMO]',
    NULL, NULL,
    ARRAY['veteran', 'family']
  ),
  (
    'f4000000-0000-0000-0000-000000000004',
    'd1000000-0000-0000-0000-000000000004',
    'Income must be below 200% Federal Poverty Level [DEMO]',
    NULL, NULL,
    ARRAY['low_income']
  ),
  (
    'f4000000-0000-0000-0000-000000000005',
    'd1000000-0000-0000-0000-000000000005',
    'Must be 16 or older; seniors welcome [DEMO]',
    16, NULL,
    ARRAY['senior', 'youth']
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO REQUIRED DOCUMENTS
-- ============================================================
INSERT INTO required_documents (id, service_id, document, type, uri) VALUES
  (
    'f5000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'Photo ID [DEMO]',
    'identification',
    NULL
  ),
  (
    'f5000000-0000-0000-0000-000000000002',
    'd1000000-0000-0000-0000-000000000003',
    'Proof of Residency [DEMO]',
    'residency',
    'https://example.com/demo-residency-form'
  ),
  (
    'f5000000-0000-0000-0000-000000000003',
    'd1000000-0000-0000-0000-000000000003',
    'DD-214 or VA letter for veterans [DEMO]',
    'identification',
    NULL
  ),
  (
    'f5000000-0000-0000-0000-000000000004',
    'd1000000-0000-0000-0000-000000000004',
    'Proof of Income [DEMO]',
    'income',
    NULL
  ),
  (
    'f5000000-0000-0000-0000-000000000005',
    'd1000000-0000-0000-0000-000000000004',
    'Photo ID [DEMO]',
    'identification',
    NULL
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO SERVICE AREAS (geographic coverage)
-- ============================================================
INSERT INTO service_areas (id, service_id, name, description, extent_type, extent) VALUES
  (
    'f6000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    'Demoville County [DEMO]',
    'DEMO ONLY: Serves all of fictional Demoville County.',
    'county',
    ST_GeomFromText('POLYGON((
      -0.05 -0.05,
       0.05 -0.05,
       0.05  0.05,
      -0.05  0.05,
      -0.05 -0.05
    ))', 4326)
  ),
  (
    'f6000000-0000-0000-0000-000000000002',
    'd1000000-0000-0000-0000-000000000003',
    'Demoville Central [DEMO]',
    'DEMO ONLY: Shelter referral limited to central Demoville ZIP.',
    'zip',
    NULL
  ),
  (
    'f6000000-0000-0000-0000-000000000003',
    'd1000000-0000-0000-0000-000000000005',
    'State of Demoville [DEMO]',
    'DEMO ONLY: Counseling available statewide.',
    'state',
    NULL
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO LANGUAGES
-- ============================================================
INSERT INTO languages (id, service_id, location_id, language, note) VALUES
  (
    'f7000000-0000-0000-0000-000000000001',
    'd1000000-0000-0000-0000-000000000001',
    NULL,
    'en',
    'English spoken at all times [DEMO]'
  ),
  (
    'f7000000-0000-0000-0000-000000000002',
    'd1000000-0000-0000-0000-000000000001',
    NULL,
    'es',
    'Spanish interpreter available Mon/Wed [DEMO]'
  ),
  (
    'f7000000-0000-0000-0000-000000000003',
    'd1000000-0000-0000-0000-000000000003',
    NULL,
    'en',
    NULL
  ),
  (
    'f7000000-0000-0000-0000-000000000004',
    NULL,
    'c1000000-0000-0000-0000-000000000003',
    'en',
    NULL
  ),
  (
    'f7000000-0000-0000-0000-000000000005',
    NULL,
    'c1000000-0000-0000-0000-000000000003',
    'vi',
    'Vietnamese interpreter available by appointment [DEMO]'
  ),
  (
    'f7000000-0000-0000-0000-000000000006',
    'd1000000-0000-0000-0000-000000000005',
    NULL,
    'es',
    'Bilingual counselor on staff [DEMO]'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO ACCESSIBILITY FEATURES
-- ============================================================
INSERT INTO accessibility_for_disabilities (id, location_id, accessibility, details) VALUES
  (
    'f8000000-0000-0000-0000-000000000001',
    'c1000000-0000-0000-0000-000000000001',
    'wheelchair',
    'Full wheelchair access including ramp at main entrance [DEMO]'
  ),
  (
    'f8000000-0000-0000-0000-000000000002',
    'c1000000-0000-0000-0000-000000000001',
    'accessible_parking',
    'Two accessible parking spots at front [DEMO]'
  ),
  (
    'f8000000-0000-0000-0000-000000000003',
    'c1000000-0000-0000-0000-000000000002',
    'wheelchair',
    'Ground floor, wheelchair accessible [DEMO]'
  ),
  (
    'f8000000-0000-0000-0000-000000000004',
    'c1000000-0000-0000-0000-000000000003',
    'elevator',
    'Elevator to all floors [DEMO]'
  ),
  (
    'f8000000-0000-0000-0000-000000000005',
    'c1000000-0000-0000-0000-000000000003',
    'hearing_loop',
    'Hearing loop in counseling rooms [DEMO]'
  ),
  (
    'f8000000-0000-0000-0000-000000000006',
    'c1000000-0000-0000-0000-000000000003',
    'service_animal_friendly',
    'Service animals welcome throughout facility [DEMO]'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO CONTACTS (public-facing staff contacts)
-- ============================================================
INSERT INTO contacts (id, organization_id, service_id, location_id, name, title, department, email) VALUES
  (
    'f9000000-0000-0000-0000-000000000001',
    'b1000000-0000-0000-0000-000000000001',
    NULL,
    NULL,
    'Jane Doe [DEMO]',
    'Executive Director',
    'Administration',
    'jane.doe@example.com'
  ),
  (
    'f9000000-0000-0000-0000-000000000002',
    NULL,
    'd1000000-0000-0000-0000-000000000001',
    NULL,
    'John Smith [DEMO]',
    'Pantry Coordinator',
    'Food Distribution',
    'john.smith@example.com'
  ),
  (
    'f9000000-0000-0000-0000-000000000003',
    NULL,
    'd1000000-0000-0000-0000-000000000003',
    NULL,
    'Maria Garcia [DEMO]',
    'Intake Specialist',
    'Housing Services',
    'maria.garcia@example.com'
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- DEMO SAVED SERVICES (server-side bookmarks)
-- ============================================================
INSERT INTO saved_services (id, user_id, service_id, notes) VALUES
  (
    'fa000000-0000-0000-0000-000000000001',
    'demo-entra-user-006',
    'd1000000-0000-0000-0000-000000000001',
    'Need to visit Monday for food boxes [DEMO]'
  ),
  (
    'fa000000-0000-0000-0000-000000000002',
    'demo-entra-user-006',
    'd1000000-0000-0000-0000-000000000005',
    NULL
  )
ON CONFLICT (user_id, service_id) DO NOTHING;

-- ============================================================
-- DEMO SERVICE ATTRIBUTES
-- ============================================================
-- Tags every demo service across all 6 taxonomy dimensions to exercise
-- the full query surface. Each service gets realistic attribute profiles.

-- ---- Service d1..001: Emergency Food Boxes (Food Bank) ----
INSERT INTO service_attributes (id, service_id, taxonomy, tag, details) VALUES
  -- DELIVERY
  ('fb000000-0000-0000-0001-000000000001', 'd1000000-0000-0000-0000-000000000001', 'delivery', 'in_person',       'Pick up at pantry location [DEMO]'),
  ('fb000000-0000-0000-0001-000000000002', 'd1000000-0000-0000-0000-000000000001', 'delivery', 'drive_through',   'Drive-through lane available Saturdays [DEMO]'),
  ('fb000000-0000-0000-0001-000000000003', 'd1000000-0000-0000-0000-000000000001', 'delivery', 'home_delivery',   'Homebound delivery for elderly/disabled upon request [DEMO]'),
  -- COST
  ('fb000000-0000-0000-0001-000000000010', 'd1000000-0000-0000-0000-000000000001', 'cost', 'free',               NULL),
  ('fb000000-0000-0000-0001-000000000011', 'd1000000-0000-0000-0000-000000000001', 'cost', 'ebt_snap',           'SNAP recipients receive priority [DEMO]'),
  -- ACCESS
  ('fb000000-0000-0000-0001-000000000020', 'd1000000-0000-0000-0000-000000000001', 'access', 'walk_in',          'No appointment needed [DEMO]'),
  ('fb000000-0000-0000-0001-000000000021', 'd1000000-0000-0000-0000-000000000001', 'access', 'no_id_required',   'Self-declaration of need accepted [DEMO]'),
  ('fb000000-0000-0000-0001-000000000022', 'd1000000-0000-0000-0000-000000000001', 'access', 'no_referral_needed', NULL),
  ('fb000000-0000-0000-0001-000000000023', 'd1000000-0000-0000-0000-000000000001', 'access', 'first_come_first_served', NULL),
  -- CULTURE
  ('fb000000-0000-0000-0001-000000000030', 'd1000000-0000-0000-0000-000000000001', 'culture', 'family_centered', 'Box sizes adjusted for family size [DEMO]'),
  -- POPULATION
  ('fb000000-0000-0000-0001-000000000040', 'd1000000-0000-0000-0000-000000000001', 'population', 'single_parent',  NULL),
  ('fb000000-0000-0000-0001-000000000041', 'd1000000-0000-0000-0000-000000000001', 'population', 'undocumented_friendly', 'No documentation status questions asked [DEMO]'),
  ('fb000000-0000-0000-0001-000000000042', 'd1000000-0000-0000-0000-000000000001', 'population', 'chronically_homeless', NULL),
  -- SITUATION
  ('fb000000-0000-0000-0001-000000000050', 'd1000000-0000-0000-0000-000000000001', 'situation', 'no_fixed_address', 'No proof of address required [DEMO]'),
  ('fb000000-0000-0000-0001-000000000051', 'd1000000-0000-0000-0000-000000000001', 'situation', 'no_documents',    NULL),
  ('fb000000-0000-0000-0001-000000000052', 'd1000000-0000-0000-0000-000000000001', 'situation', 'benefit_gap',     'Bridge food while waiting for SNAP approval [DEMO]')
ON CONFLICT (service_id, taxonomy, tag) DO NOTHING;

-- ---- Service d1..002: Weekly Produce Distribution (Food Bank) ----
INSERT INTO service_attributes (id, service_id, taxonomy, tag, details) VALUES
  ('fb000000-0000-0000-0002-000000000001', 'd1000000-0000-0000-0000-000000000002', 'delivery', 'in_person',       NULL),
  ('fb000000-0000-0000-0002-000000000002', 'd1000000-0000-0000-0000-000000000002', 'delivery', 'curbside',        'Curbside pickup option available [DEMO]'),
  ('fb000000-0000-0000-0002-000000000010', 'd1000000-0000-0000-0000-000000000002', 'cost', 'free',               NULL),
  ('fb000000-0000-0000-0002-000000000011', 'd1000000-0000-0000-0000-000000000002', 'cost', 'wic_accepted',       'WIC vouchers accepted for additional items [DEMO]'),
  ('fb000000-0000-0000-0002-000000000020', 'd1000000-0000-0000-0000-000000000002', 'access', 'walk_in',          NULL),
  ('fb000000-0000-0000-0002-000000000021', 'd1000000-0000-0000-0000-000000000002', 'access', 'no_id_required',   NULL),
  ('fb000000-0000-0000-0002-000000000030', 'd1000000-0000-0000-0000-000000000002', 'culture', 'culturally_specific', 'Produce selections include culturally diverse options [DEMO]'),
  ('fb000000-0000-0000-0002-000000000040', 'd1000000-0000-0000-0000-000000000002', 'population', 'immigrant',     NULL),
  ('fb000000-0000-0000-0002-000000000041', 'd1000000-0000-0000-0000-000000000002', 'population', 'pregnant',       'Extra portions for expectant mothers [DEMO]'),
  ('fb000000-0000-0000-0002-000000000050', 'd1000000-0000-0000-0000-000000000002', 'situation', 'language_barrier', 'Multilingual signage and volunteers [DEMO]')
ON CONFLICT (service_id, taxonomy, tag) DO NOTHING;

-- ---- Service d1..003: Emergency Shelter Referral (Housing Services) ----
INSERT INTO service_attributes (id, service_id, taxonomy, tag, details) VALUES
  ('fb000000-0000-0000-0003-000000000001', 'd1000000-0000-0000-0000-000000000003', 'delivery', 'in_person',       'In-person intake at housing office [DEMO]'),
  ('fb000000-0000-0000-0003-000000000002', 'd1000000-0000-0000-0000-000000000003', 'delivery', 'phone',           'Crisis line for after-hours placement [DEMO]'),
  ('fb000000-0000-0000-0003-000000000010', 'd1000000-0000-0000-0000-000000000003', 'cost', 'free',               NULL),
  ('fb000000-0000-0000-0003-000000000020', 'd1000000-0000-0000-0000-000000000003', 'access', 'walk_in',          'Walk-in during business hours [DEMO]'),
  ('fb000000-0000-0000-0003-000000000021', 'd1000000-0000-0000-0000-000000000003', 'access', 'no_id_required',   'Emergency placement does not require ID [DEMO]'),
  ('fb000000-0000-0000-0003-000000000022', 'd1000000-0000-0000-0000-000000000003', 'access', 'accepting_new_clients', NULL),
  ('fb000000-0000-0000-0003-000000000030', 'd1000000-0000-0000-0000-000000000003', 'culture', 'trauma_informed',  'Trauma-informed intake process [DEMO]'),
  ('fb000000-0000-0000-0003-000000000031', 'd1000000-0000-0000-0000-000000000003', 'culture', 'lgbtq_affirming',  'Affirming shelter placement for LGBTQ+ individuals [DEMO]'),
  ('fb000000-0000-0000-0003-000000000032', 'd1000000-0000-0000-0000-000000000003', 'culture', 'gender_specific_women', 'Women-only shelter beds available [DEMO]'),
  ('fb000000-0000-0000-0003-000000000040', 'd1000000-0000-0000-0000-000000000003', 'population', 'dv_survivor',   'Priority for domestic violence survivors [DEMO]'),
  ('fb000000-0000-0000-0003-000000000041', 'd1000000-0000-0000-0000-000000000003', 'population', 'veteran_family', 'SSVF-funded beds for veteran families [DEMO]'),
  ('fb000000-0000-0000-0003-000000000042', 'd1000000-0000-0000-0000-000000000003', 'population', 'chronically_homeless', 'Permanent supportive housing referral pathway [DEMO]'),
  ('fb000000-0000-0000-0003-000000000043', 'd1000000-0000-0000-0000-000000000003', 'population', 'reentry',        'Beds reserved for reentry population [DEMO]'),
  ('fb000000-0000-0000-0003-000000000044', 'd1000000-0000-0000-0000-000000000003', 'population', 'unaccompanied_minor', 'Runaway and homeless youth beds available [DEMO]'),
  ('fb000000-0000-0000-0003-000000000050', 'd1000000-0000-0000-0000-000000000003', 'situation', 'no_fixed_address', NULL),
  ('fb000000-0000-0000-0003-000000000051', 'd1000000-0000-0000-0000-000000000003', 'situation', 'fleeing_violence', 'Confidential location for safety [DEMO]'),
  ('fb000000-0000-0000-0003-000000000052', 'd1000000-0000-0000-0000-000000000003', 'situation', 'recently_incarcerated', NULL),
  ('fb000000-0000-0000-0003-000000000053', 'd1000000-0000-0000-0000-000000000003', 'situation', 'no_documents',    NULL)
ON CONFLICT (service_id, taxonomy, tag) DO NOTHING;

-- ---- Service d1..004: Rental Assistance (Housing Services) ----
INSERT INTO service_attributes (id, service_id, taxonomy, tag, details) VALUES
  ('fb000000-0000-0000-0004-000000000001', 'd1000000-0000-0000-0000-000000000004', 'delivery', 'in_person',       NULL),
  ('fb000000-0000-0000-0004-000000000002', 'd1000000-0000-0000-0000-000000000004', 'delivery', 'virtual',         'Online application portal available [DEMO]'),
  ('fb000000-0000-0000-0004-000000000010', 'd1000000-0000-0000-0000-000000000004', 'cost', 'free',               'No cost to apply or receive assistance [DEMO]'),
  ('fb000000-0000-0000-0004-000000000020', 'd1000000-0000-0000-0000-000000000004', 'access', 'by_application',    'Requires completed application and income verification [DEMO]'),
  ('fb000000-0000-0000-0004-000000000021', 'd1000000-0000-0000-0000-000000000004', 'access', 'waitlist_open',     'Current wait time approximately 3 months [DEMO]'),
  ('fb000000-0000-0000-0004-000000000030', 'd1000000-0000-0000-0000-000000000004', 'culture', 'family_centered',  'Whole-family stabilization approach [DEMO]'),
  ('fb000000-0000-0000-0004-000000000040', 'd1000000-0000-0000-0000-000000000004', 'population', 'single_parent', 'Single parents with children prioritized [DEMO]'),
  ('fb000000-0000-0000-0004-000000000041', 'd1000000-0000-0000-0000-000000000004', 'population', 'caregiver',     NULL),
  ('fb000000-0000-0000-0004-000000000050', 'd1000000-0000-0000-0000-000000000004', 'situation', 'legal_crisis',   'Can assist with eviction proceedings [DEMO]'),
  ('fb000000-0000-0000-0004-000000000051', 'd1000000-0000-0000-0000-000000000004', 'situation', 'job_loss',       'Recently unemployed individuals qualify [DEMO]')
ON CONFLICT (service_id, taxonomy, tag) DO NOTHING;

-- ---- Service d1..005: Individual Counseling (Wellness Center) ----
INSERT INTO service_attributes (id, service_id, taxonomy, tag, details) VALUES
  ('fb000000-0000-0000-0005-000000000001', 'd1000000-0000-0000-0000-000000000005', 'delivery', 'in_person',       NULL),
  ('fb000000-0000-0000-0005-000000000002', 'd1000000-0000-0000-0000-000000000005', 'delivery', 'virtual',         'Telehealth sessions via secure video [DEMO]'),
  ('fb000000-0000-0000-0005-000000000003', 'd1000000-0000-0000-0000-000000000005', 'delivery', 'phone',           'Phone sessions available for those without internet [DEMO]'),
  ('fb000000-0000-0000-0005-000000000010', 'd1000000-0000-0000-0000-000000000005', 'cost', 'sliding_scale',      'Based on household income [DEMO]'),
  ('fb000000-0000-0000-0005-000000000011', 'd1000000-0000-0000-0000-000000000005', 'cost', 'medicaid',           'Accepts Medicaid [DEMO]'),
  ('fb000000-0000-0000-0005-000000000012', 'd1000000-0000-0000-0000-000000000005', 'cost', 'no_insurance_required', 'Uninsured clients welcome at sliding scale [DEMO]'),
  ('fb000000-0000-0000-0005-000000000020', 'd1000000-0000-0000-0000-000000000005', 'access', 'appointment_required', 'Initial intake by appointment [DEMO]'),
  ('fb000000-0000-0000-0005-000000000021', 'd1000000-0000-0000-0000-000000000005', 'access', 'accepting_new_clients', NULL),
  ('fb000000-0000-0000-0005-000000000022', 'd1000000-0000-0000-0000-000000000005', 'access', 'no_referral_needed', 'Self-referral welcome [DEMO]'),
  ('fb000000-0000-0000-0005-000000000030', 'd1000000-0000-0000-0000-000000000005', 'culture', 'trauma_informed',  NULL),
  ('fb000000-0000-0000-0005-000000000031', 'd1000000-0000-0000-0000-000000000005', 'culture', 'lgbtq_affirming',  NULL),
  ('fb000000-0000-0000-0005-000000000032', 'd1000000-0000-0000-0000-000000000005', 'culture', 'peer_support',     'Peer support groups on weekends [DEMO]'),
  ('fb000000-0000-0000-0005-000000000033', 'd1000000-0000-0000-0000-000000000005', 'culture', 'harm_reduction',   NULL),
  ('fb000000-0000-0000-0005-000000000040', 'd1000000-0000-0000-0000-000000000005', 'population', 'dv_survivor',   NULL),
  ('fb000000-0000-0000-0005-000000000041', 'd1000000-0000-0000-0000-000000000005', 'population', 'refugee',        'Refugee-specific counseling pathway [DEMO]'),
  ('fb000000-0000-0000-0005-000000000042', 'd1000000-0000-0000-0000-000000000005', 'population', 'foster_youth',   NULL),
  ('fb000000-0000-0000-0005-000000000043', 'd1000000-0000-0000-0000-000000000005', 'population', 'trafficking_survivor', NULL),
  ('fb000000-0000-0000-0005-000000000050', 'd1000000-0000-0000-0000-000000000005', 'situation', 'substance_use_active', 'Active use is not a barrier to care [DEMO]'),
  ('fb000000-0000-0000-0005-000000000051', 'd1000000-0000-0000-0000-000000000005', 'situation', 'mental_health_crisis', 'Same-day crisis appointments available [DEMO]'),
  ('fb000000-0000-0000-0005-000000000052', 'd1000000-0000-0000-0000-000000000005', 'situation', 'digital_barrier', 'Phone sessions for clients without internet [DEMO]'),
  ('fb000000-0000-0000-0005-000000000053', 'd1000000-0000-0000-0000-000000000005', 'situation', 'transportation_barrier', 'Telehealth removes transportation requirement [DEMO]')
ON CONFLICT (service_id, taxonomy, tag) DO NOTHING;

-- ============================================================
-- DEMO SERVICE ADAPTATIONS (migration 0013)
-- ============================================================
-- Service-level disability/health adaptations (distinct from location accessibility)

INSERT INTO service_adaptations (id, service_id, adaptation_type, adaptation_tag, details) VALUES
  -- Food Bank: adapted for various populations
  ('fc000000-0000-0000-0001-000000000001', 'd1000000-0000-0000-0000-000000000001', 'age_group', 'infant',        'Baby formula and baby food available [DEMO]'),
  ('fc000000-0000-0000-0001-000000000002', 'd1000000-0000-0000-0000-000000000001', 'age_group', 'senior',        'Senior-specific nutrition boxes [DEMO]'),
  ('fc000000-0000-0000-0001-000000000003', 'd1000000-0000-0000-0000-000000000001', 'health_condition', 'diabetes', 'Diabetic-friendly food options [DEMO]'),

  -- Weekly Produce: age adaptations
  ('fc000000-0000-0000-0002-000000000001', 'd1000000-0000-0000-0000-000000000002', 'age_group', 'school_age',    'Kid-friendly produce packs [DEMO]'),
  ('fc000000-0000-0000-0002-000000000002', 'd1000000-0000-0000-0000-000000000002', 'health_condition', 'pregnancy_complications', 'High-nutrition options for high-risk pregnancy [DEMO]'),

  -- Emergency Shelter: disability adaptations
  ('fc000000-0000-0000-0003-000000000001', 'd1000000-0000-0000-0000-000000000003', 'disability', 'mobility_impaired', 'ADA-compliant shelter beds available [DEMO]'),
  ('fc000000-0000-0000-0003-000000000002', 'd1000000-0000-0000-0000-000000000003', 'disability', 'mental_health', 'Mental health support integrated [DEMO]'),
  ('fc000000-0000-0000-0003-000000000003', 'd1000000-0000-0000-0000-000000000003', 'health_condition', 'substance_use', 'Harm reduction approach, active use not disqualifying [DEMO]'),
  ('fc000000-0000-0000-0003-000000000004', 'd1000000-0000-0000-0000-000000000003', 'age_group', 'young_adult',   'TAY-specific beds for 18-24 year olds [DEMO]'),

  -- Rental Assistance: age and disability
  ('fc000000-0000-0000-0004-000000000001', 'd1000000-0000-0000-0000-000000000004', 'learning', 'low_literacy',   'Staff assist with paperwork completion [DEMO]'),
  ('fc000000-0000-0000-0004-000000000002', 'd1000000-0000-0000-0000-000000000004', 'learning', 'esl',            'ESL-friendly application process [DEMO]'),

  -- Counseling: extensive adaptations
  ('fc000000-0000-0000-0005-000000000001', 'd1000000-0000-0000-0000-000000000005', 'disability', 'deaf',         'ASL interpreter available [DEMO]'),
  ('fc000000-0000-0000-0005-000000000002', 'd1000000-0000-0000-0000-000000000005', 'disability', 'blind',        'Audio materials and screen reader compatible [DEMO]'),
  ('fc000000-0000-0000-0005-000000000003', 'd1000000-0000-0000-0000-000000000005', 'disability', 'autism',       'Autism-specialized therapists on staff [DEMO]'),
  ('fc000000-0000-0000-0005-000000000004', 'd1000000-0000-0000-0000-000000000005', 'disability', 'cognitive',    'Cognitive disability accommodations available [DEMO]'),
  ('fc000000-0000-0000-0005-000000000005', 'd1000000-0000-0000-0000-000000000005', 'health_condition', 'hiv_aids', 'HIV+ case management specialization [DEMO]'),
  ('fc000000-0000-0000-0005-000000000006', 'd1000000-0000-0000-0000-000000000005', 'health_condition', 'eating_disorder', 'Eating disorder specialists [DEMO]'),
  ('fc000000-0000-0000-0005-000000000007', 'd1000000-0000-0000-0000-000000000005', 'health_condition', 'chronic_pain', 'Chronic pain counseling track [DEMO]'),
  ('fc000000-0000-0000-0005-000000000008', 'd1000000-0000-0000-0000-000000000005', 'age_group', 'teen',          'Teen-specific counselors [DEMO]'),
  ('fc000000-0000-0000-0005-000000000009', 'd1000000-0000-0000-0000-000000000005', 'age_group', 'elderly',       '75+ geriatric counseling specialization [DEMO]')
ON CONFLICT (service_id, adaptation_type, adaptation_tag) DO NOTHING;

-- ============================================================
-- DEMO DIETARY OPTIONS (migration 0013)
-- ============================================================
-- Dietary restrictions accommodated by food services

INSERT INTO dietary_options (id, service_id, dietary_type, availability, details) VALUES
  -- Emergency Food Boxes
  ('fd000000-0000-0000-0001-000000000001', 'd1000000-0000-0000-0000-000000000001', 'halal',              'by_request',  'Halal boxes prepared upon advance request [DEMO]'),
  ('fd000000-0000-0000-0001-000000000002', 'd1000000-0000-0000-0000-000000000001', 'kosher',             'limited',     'Kosher items when donated [DEMO]'),
  ('fd000000-0000-0000-0001-000000000003', 'd1000000-0000-0000-0000-000000000001', 'vegetarian',         'always',      NULL),
  ('fd000000-0000-0000-0001-000000000004', 'd1000000-0000-0000-0000-000000000001', 'gluten_free',        'by_request',  'Gluten-free box available with 48hr notice [DEMO]'),
  ('fd000000-0000-0000-0001-000000000005', 'd1000000-0000-0000-0000-000000000001', 'diabetic_friendly',  'always',      'Low-sugar options always available [DEMO]'),
  ('fd000000-0000-0000-0001-000000000006', 'd1000000-0000-0000-0000-000000000001', 'baby_food',          'always',      'Formula and baby food in stock [DEMO]'),
  ('fd000000-0000-0000-0001-000000000007', 'd1000000-0000-0000-0000-000000000001', 'pet_food',           'always',      'Pet food for cats and dogs [DEMO]'),

  -- Weekly Produce Distribution
  ('fd000000-0000-0000-0002-000000000001', 'd1000000-0000-0000-0000-000000000002', 'vegan',              'always',      'All produce is plant-based [DEMO]'),
  ('fd000000-0000-0000-0002-000000000002', 'd1000000-0000-0000-0000-000000000002', 'organic',            'seasonal',    'Organic produce when available from farms [DEMO]'),
  ('fd000000-0000-0000-0002-000000000003', 'd1000000-0000-0000-0000-000000000002', 'fresh_produce',      'always',      NULL),
  ('fd000000-0000-0000-0002-000000000004', 'd1000000-0000-0000-0000-000000000002', 'culturally_appropriate', 'always',  'Culturally diverse produce selections [DEMO]')
ON CONFLICT (service_id, dietary_type) DO NOTHING;

-- ============================================================
-- UPDATE DEMO SERVICES: wait times and capacity (migration 0013)
-- ============================================================
UPDATE services SET
  estimated_wait_days = 0,
  capacity_status = 'available'
WHERE id = 'd1000000-0000-0000-0000-000000000001'; -- Emergency Food Boxes: immediate

UPDATE services SET
  estimated_wait_days = 0,
  capacity_status = 'available'
WHERE id = 'd1000000-0000-0000-0000-000000000002'; -- Weekly Produce: immediate

UPDATE services SET
  estimated_wait_days = 1,
  capacity_status = 'limited'
WHERE id = 'd1000000-0000-0000-0000-000000000003'; -- Emergency Shelter: next-day, limited beds

UPDATE services SET
  estimated_wait_days = 90,
  capacity_status = 'waitlist'
WHERE id = 'd1000000-0000-0000-0000-000000000004'; -- Rental Assistance: 3-month waitlist

UPDATE services SET
  estimated_wait_days = 7,
  capacity_status = 'available'
WHERE id = 'd1000000-0000-0000-0000-000000000005'; -- Counseling: 1-week wait, taking clients

-- ============================================================
-- UPDATE DEMO LOCATIONS: transit and parking (migration 0013)
-- ============================================================
UPDATE locations SET
  transit_access = ARRAY['bus_stop_nearby', 'bike_friendly', 'ada_transit'],
  parking_available = 'yes'
WHERE id = 'c1000000-0000-0000-0000-000000000001'; -- Food Bank location

UPDATE locations SET
  transit_access = ARRAY['bus_stop_nearby', 'subway_nearby', 'walkable'],
  parking_available = 'street_only'
WHERE id = 'c1000000-0000-0000-0000-000000000002'; -- Housing Services location

UPDATE locations SET
  transit_access = ARRAY['bus_stop_nearby', 'paratransit_accessible', 'ride_share_accessible'],
  parking_available = 'paid'
WHERE id = 'c1000000-0000-0000-0000-000000000003'; -- Wellness Center location

-- ============================================================
-- UPDATE DEMO ELIGIBILITY: household size (migration 0013)
-- ============================================================
-- Add household size limits to existing eligibility records
UPDATE eligibility SET
  household_size_min = 1,
  household_size_max = NULL  -- No max for food bank
WHERE id = 'f4000000-0000-0000-0000-000000000001';

UPDATE eligibility SET
  household_size_min = 1,
  household_size_max = 10   -- Shelter can handle up to 10 in family
WHERE id = 'f4000000-0000-0000-0000-000000000002';

UPDATE eligibility SET
  household_size_min = 2,   -- Requires dependent (family)
  household_size_max = 8    -- Max family size for rental assistance
WHERE id = 'f4000000-0000-0000-0000-000000000004';
