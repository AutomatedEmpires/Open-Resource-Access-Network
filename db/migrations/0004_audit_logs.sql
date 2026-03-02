-- 0004_audit_logs.sql
-- Minimal audit log table (write-side only; reads gated by app RBAC).
-- Avoid PII: store pseudonymous IDs; do not store raw IP.

CREATE TABLE IF NOT EXISTS audit_logs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_user_id   TEXT,
  actor_role      TEXT,
  action          TEXT NOT NULL,
  resource_type   TEXT NOT NULL,
  resource_id     UUID,
  before          JSONB,
  after           JSONB,
  request_id      TEXT,
  ip_digest       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id);
