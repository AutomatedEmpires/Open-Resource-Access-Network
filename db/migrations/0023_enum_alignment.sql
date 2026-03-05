-- Migration 0023: Align DB risk_level constraint with app types
--
-- The platform_scopes.risk_level CHECK constraint used 'high' but
-- application types (ScopeRiskLevel) use 'elevated'. This migration
-- aligns the DB to match the application layer.
--
-- Ref: system_integrity_audit.md Issue #7

-- 1. Update any existing rows that may have 'high' to 'elevated'
UPDATE platform_scopes
SET risk_level = 'elevated'
WHERE risk_level = 'high';

-- 2. Drop the old constraint and add the aligned one
ALTER TABLE platform_scopes
  DROP CONSTRAINT IF EXISTS platform_scopes_risk_level_check;

ALTER TABLE platform_scopes
  ADD CONSTRAINT platform_scopes_risk_level_check
    CHECK (risk_level IN ('low', 'standard', 'elevated', 'critical'));
