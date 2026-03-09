-- Migration: 0038 — Resolution & Clustering Layer (Phase 4)
--
-- Four tables supporting entity resolution decisions, candidate tracking,
-- and cluster management for deduplication across source systems.
-- See: hsds_211_integration_plan.md Phase 4.

-- 1. Entity Clusters — groups of canonical entities believed to be the same real-world entity.
CREATE TABLE IF NOT EXISTS entity_clusters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,                       -- 'organization', 'service', 'location'
  canonical_entity_id UUID NOT NULL,               -- the "winner" / primary canonical entity
  label TEXT,                                      -- human-readable cluster label
  status TEXT NOT NULL DEFAULT 'active',            -- 'active', 'merged', 'rejected'
  confidence INTEGER NOT NULL DEFAULT 0,            -- overall cluster confidence (0-100)
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_entity_clusters_confidence CHECK (confidence BETWEEN 0 AND 100),
  CONSTRAINT chk_entity_clusters_status CHECK (status IN ('active', 'merged', 'rejected'))
);

CREATE INDEX idx_entity_clusters_type ON entity_clusters (entity_type);
CREATE INDEX idx_entity_clusters_canonical ON entity_clusters (canonical_entity_id);
CREATE INDEX idx_entity_clusters_status ON entity_clusters (status);

-- 2. Entity Cluster Members — individual canonical entities within a cluster.
CREATE TABLE IF NOT EXISTS entity_cluster_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id UUID NOT NULL REFERENCES entity_clusters(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,                       -- redundant for query convenience
  entity_id UUID NOT NULL,                         -- canonical entity id
  role TEXT NOT NULL DEFAULT 'member',             -- 'primary', 'member'
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_entity_cluster_members_role CHECK (role IN ('primary', 'member'))
);

CREATE UNIQUE INDEX idx_entity_cluster_members_pair ON entity_cluster_members (cluster_id, entity_id);
CREATE INDEX idx_entity_cluster_members_entity ON entity_cluster_members (entity_type, entity_id);

-- 3. Resolution Candidates — proposed matches between a source record and an existing canonical entity.
CREATE TABLE IF NOT EXISTS resolution_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_record_id UUID REFERENCES source_records(id) ON DELETE SET NULL,
  candidate_entity_type TEXT NOT NULL,             -- 'organization', 'service', 'location'
  candidate_entity_id UUID NOT NULL,               -- canonical entity id
  match_strategy TEXT NOT NULL,                    -- 'identifier', 'url', 'name', 'geo', 'manual'
  match_key TEXT,                                  -- the matched value (e.g. URL, identifier)
  confidence INTEGER NOT NULL DEFAULT 0,
  auto_resolved BOOLEAN NOT NULL DEFAULT false,    -- true if auto-accepted
  status TEXT NOT NULL DEFAULT 'pending',          -- 'pending', 'accepted', 'rejected'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  CONSTRAINT chk_resolution_candidates_confidence CHECK (confidence BETWEEN 0 AND 100),
  CONSTRAINT chk_resolution_candidates_status CHECK (status IN ('pending', 'accepted', 'rejected'))
);

CREATE INDEX idx_resolution_candidates_source ON resolution_candidates (source_record_id);
CREATE INDEX idx_resolution_candidates_entity ON resolution_candidates (candidate_entity_type, candidate_entity_id);
CREATE INDEX idx_resolution_candidates_status ON resolution_candidates (status);
CREATE INDEX idx_resolution_candidates_strategy ON resolution_candidates (match_strategy);

-- 4. Resolution Decisions — audit log of all resolution actions taken.
CREATE TABLE IF NOT EXISTS resolution_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resolution_candidate_id UUID REFERENCES resolution_candidates(id) ON DELETE SET NULL,
  source_record_id UUID REFERENCES source_records(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,                         -- the canonical entity matched/created
  decision TEXT NOT NULL,                          -- 'match', 'create_new', 'merge', 'reject', 'defer'
  match_strategy TEXT,                             -- which strategy was used
  match_confidence INTEGER NOT NULL DEFAULT 0,
  rationale TEXT,                                  -- human or system explanation
  decided_by TEXT NOT NULL DEFAULT 'system',       -- 'system', admin user id
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_resolution_decisions_confidence CHECK (match_confidence BETWEEN 0 AND 100),
  CONSTRAINT chk_resolution_decisions_decision CHECK (
    decision IN ('match', 'create_new', 'merge', 'reject', 'defer')
  )
);

CREATE INDEX idx_resolution_decisions_source ON resolution_decisions (source_record_id);
CREATE INDEX idx_resolution_decisions_entity ON resolution_decisions (entity_type, entity_id);
CREATE INDEX idx_resolution_decisions_decision ON resolution_decisions (decision);
CREATE INDEX idx_resolution_decisions_candidate ON resolution_decisions (resolution_candidate_id);

-- updated_at triggers for tables that need them
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_entity_clusters_updated_at') THEN
    CREATE TRIGGER trg_entity_clusters_updated_at
      BEFORE UPDATE ON entity_clusters
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
