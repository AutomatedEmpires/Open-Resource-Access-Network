-- 0011_contacts_saved_services_evidence.sql
-- Platform interaction tables:
--   contacts              — Named contacts at organizations/services/locations (HSDS standard)
--   saved_services        — Server-side bookmarks for authenticated seekers
--   verification_evidence — Document proof attached to verification queue entries
--
-- Idempotent: safe to run multiple times.

-- ============================================================
-- CONTACTS
-- ============================================================
-- Named contacts at organizations, services, or locations (HSDS standard entity).
-- Extends the phones table with name/title/department context.
-- No PII concern: these are published public-facing contact persons, not seekers.
CREATE TABLE IF NOT EXISTS contacts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id    UUID REFERENCES organizations(id) ON DELETE CASCADE,
  service_id         UUID REFERENCES services(id) ON DELETE CASCADE,
  location_id        UUID REFERENCES locations(id) ON DELETE CASCADE,
  name               TEXT,                   -- Contact person name (public staff, not seeker PII)
  title              TEXT,                   -- Job title
  department         TEXT,                   -- Department name
  email              TEXT,                   -- Public contact email
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  -- At least one parent must be set
  CONSTRAINT contacts_parent_check CHECK (
    organization_id IS NOT NULL OR service_id IS NOT NULL OR location_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_contacts_organization
  ON contacts(organization_id);

CREATE INDEX IF NOT EXISTS idx_contacts_service
  ON contacts(service_id);

CREATE INDEX IF NOT EXISTS idx_contacts_location
  ON contacts(location_id);

-- updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_set_updated_at_contacts'
  ) THEN
    CREATE TRIGGER trg_set_updated_at_contacts
      BEFORE UPDATE ON contacts
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ============================================================
-- SAVED SERVICES
-- ============================================================
-- Server-side bookmarks for authenticated seekers.
-- Complements the existing localStorage-based /saved page by persisting
-- saves across devices when the user is signed in.
-- Privacy: only stores the (pseudonymous) user_id + service_id + optional note.
CREATE TABLE IF NOT EXISTS saved_services (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            TEXT NOT NULL,           -- Microsoft Entra Object ID (pseudonymous)
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  notes              TEXT,                    -- Personal note (optional, encrypted at rest in production)
  saved_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_saved_services_user
  ON saved_services(user_id);

CREATE INDEX IF NOT EXISTS idx_saved_services_service
  ON saved_services(service_id);

-- ============================================================
-- VERIFICATION EVIDENCE
-- ============================================================
-- Document proof attached to verification queue entries.
-- The scoring model awards +20 for "document proof uploaded."
-- Stores metadata only; actual files live in Azure Blob Storage.
-- No PII: evidence is about the service, not the seeker.
CREATE TABLE IF NOT EXISTS verification_evidence (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  queue_entry_id       UUID NOT NULL REFERENCES verification_queue(id) ON DELETE CASCADE,
  evidence_type        TEXT NOT NULL
                       CHECK (evidence_type IN (
                         'website_screenshot', 'phone_confirmation', 'in_person_visit',
                         'official_document', 'photo', 'correspondence', 'other'
                       )),
  description          TEXT,                  -- What the evidence shows
  file_url             TEXT,                  -- Azure Blob Storage URL
  file_name            TEXT,                  -- Original filename
  file_size_bytes      INT,                   -- File size for display
  submitted_by_user_id TEXT NOT NULL,          -- Entra Object ID
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_queue_entry
  ON verification_evidence(queue_entry_id);

CREATE INDEX IF NOT EXISTS idx_evidence_type
  ON verification_evidence(evidence_type);
