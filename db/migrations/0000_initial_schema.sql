-- ORAN Initial Schema Migration
-- 0000_initial_schema.sql
-- Run once on a fresh database.

-- Enable PostGIS extension (required for geometry types)
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- ORGANIZATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  description     TEXT,
  url             TEXT,
  email           TEXT,
  tax_status      TEXT,
  tax_id          TEXT,
  year_incorporated INT,
  legal_status    TEXT,
  logo_url        TEXT,
  uri             TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_name ON organizations USING gin(to_tsvector('english', name));

-- ============================================================
-- LOCATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS locations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT,
  alternate_name  TEXT,
  description     TEXT,
  transportation  TEXT,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,
  geom            GEOMETRY(Point, 4326),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_locations_organization ON locations(organization_id);
CREATE INDEX idx_locations_geom ON locations USING gist(geom);

-- Trigger to keep geom in sync with lat/lon
CREATE OR REPLACE FUNCTION sync_location_geom()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_location_geom
  BEFORE INSERT OR UPDATE ON locations
  FOR EACH ROW EXECUTE FUNCTION sync_location_geom();

-- ============================================================
-- SERVICES
-- ============================================================
CREATE TABLE IF NOT EXISTS services (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  program_id              UUID,
  name                    TEXT NOT NULL,
  alternate_name          TEXT,
  description             TEXT,
  url                     TEXT,
  email                   TEXT,
  status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'defunct')),
  interpretation_services TEXT,
  application_process     TEXT,
  wait_time               TEXT,
  fees                    TEXT,
  accreditations          TEXT,
  licenses                TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_services_organization ON services(organization_id);
CREATE INDEX idx_services_status ON services(status);
CREATE INDEX idx_services_name ON services USING gin(to_tsvector('english', name));
CREATE INDEX idx_services_description ON services USING gin(to_tsvector('english', coalesce(description, '')));

-- ============================================================
-- SERVICE AT LOCATION
-- ============================================================
CREATE TABLE IF NOT EXISTS service_at_location (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id  UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id, location_id)
);

CREATE INDEX idx_sal_service ON service_at_location(service_id);
CREATE INDEX idx_sal_location ON service_at_location(location_id);

-- ============================================================
-- PHONES
-- ============================================================
CREATE TABLE IF NOT EXISTS phones (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id     UUID REFERENCES locations(id) ON DELETE CASCADE,
  service_id      UUID REFERENCES services(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  number          TEXT NOT NULL,
  extension       TEXT,
  type            TEXT DEFAULT 'voice' CHECK (type IN ('voice', 'fax', 'tty', 'hotline', 'sms')),
  language        TEXT,
  description     TEXT
);

CREATE INDEX idx_phones_service ON phones(service_id);
CREATE INDEX idx_phones_location ON phones(location_id);
CREATE INDEX idx_phones_organization ON phones(organization_id);

-- ============================================================
-- ADDRESSES
-- ============================================================
CREATE TABLE IF NOT EXISTS addresses (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  location_id     UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  attention       TEXT,
  address_1       TEXT,
  address_2       TEXT,
  city            TEXT,
  region          TEXT,
  state_province  TEXT,
  postal_code     TEXT,
  country         TEXT DEFAULT 'US'
);

CREATE INDEX idx_addresses_location ON addresses(location_id);
CREATE INDEX idx_addresses_city ON addresses(city);
CREATE INDEX idx_addresses_postal ON addresses(postal_code);

-- ============================================================
-- SCHEDULES
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id  UUID REFERENCES services(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  valid_from  DATE,
  valid_to    DATE,
  dtstart     TEXT,
  until       TEXT,
  wkst        TEXT,
  days        TEXT[],
  opens_at    TIME,
  closes_at   TIME,
  description TEXT
);

CREATE INDEX idx_schedules_service ON schedules(service_id);
CREATE INDEX idx_schedules_location ON schedules(location_id);

-- ============================================================
-- TAXONOMY TERMS
-- ============================================================
CREATE TABLE IF NOT EXISTS taxonomy_terms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  term        TEXT NOT NULL,
  description TEXT,
  parent_id   UUID REFERENCES taxonomy_terms(id),
  taxonomy    TEXT DEFAULT 'custom',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_taxonomy_parent ON taxonomy_terms(parent_id);
CREATE INDEX idx_taxonomy_term ON taxonomy_terms USING gin(to_tsvector('english', term));

-- ============================================================
-- SERVICE TAXONOMY (junction)
-- ============================================================
CREATE TABLE IF NOT EXISTS service_taxonomy (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id        UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  taxonomy_term_id  UUID NOT NULL REFERENCES taxonomy_terms(id) ON DELETE CASCADE,
  UNIQUE(service_id, taxonomy_term_id)
);

CREATE INDEX idx_service_taxonomy_service ON service_taxonomy(service_id);
CREATE INDEX idx_service_taxonomy_term ON service_taxonomy(taxonomy_term_id);

-- ============================================================
-- CONFIDENCE SCORES
-- ============================================================
CREATE TABLE IF NOT EXISTS confidence_scores (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id            UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  score                 NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  verification_confidence NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (verification_confidence >= 0 AND verification_confidence <= 100),
  eligibility_match     NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (eligibility_match >= 0 AND eligibility_match <= 100),
  constraint_fit        NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (constraint_fit >= 0 AND constraint_fit <= 100),
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id)
);

CREATE INDEX idx_confidence_service ON confidence_scores(service_id);
CREATE INDEX idx_confidence_score ON confidence_scores(score DESC);

-- ============================================================
-- VERIFICATION QUEUE
-- ============================================================
CREATE TABLE IF NOT EXISTS verification_queue (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (
                  status IN ('pending', 'in_review', 'verified', 'rejected', 'escalated')
                ),
  submitted_by  TEXT NOT NULL,
  assigned_to   TEXT,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vq_service ON verification_queue(service_id);
CREATE INDEX idx_vq_status ON verification_queue(status);
CREATE INDEX idx_vq_assigned ON verification_queue(assigned_to);

-- ============================================================
-- SEEKER FEEDBACK
-- ============================================================
CREATE TABLE IF NOT EXISTS seeker_feedback (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id       UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  session_id       UUID NOT NULL,
  rating           INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment          TEXT,
  contact_success  BOOLEAN,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_feedback_service ON seeker_feedback(service_id);
CREATE INDEX idx_feedback_session ON seeker_feedback(session_id);

-- ============================================================
-- CHAT SESSIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS chat_sessions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ,
  intent_summary   TEXT,
  service_ids_shown UUID[]
);

CREATE INDEX idx_chat_sessions_user ON chat_sessions(user_id);
CREATE INDEX idx_chat_sessions_started ON chat_sessions(started_at DESC);

-- ============================================================
-- FEATURE FLAGS
-- ============================================================
CREATE TABLE IF NOT EXISTS feature_flags (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT UNIQUE NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT false,
  rollout_pct INT NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Default feature flags
INSERT INTO feature_flags (name, enabled, rollout_pct) VALUES
  ('llm_summarize',  false, 0),
  ('map_enabled',    true,  100),
  ('feedback_form',  true,  100),
  ('host_claims',    true,  100)
ON CONFLICT (name) DO NOTHING;
