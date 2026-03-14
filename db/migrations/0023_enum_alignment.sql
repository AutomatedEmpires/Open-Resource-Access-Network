-- Migration 0023: Align DB risk_level constraint with app types
--
-- The platform_scopes.risk_level CHECK constraint used 'high' but
-- application types (ScopeRiskLevel) use 'elevated'. This migration
-- aligns the DB to match the application layer.
--
-- Ref: system_integrity_audit.md Issue #7

-- 1. Drop the old constraint before rewriting values.
ALTER TABLE platform_scopes
  DROP CONSTRAINT IF EXISTS platform_scopes_risk_level_check;

-- 2. Update any existing rows that may have 'high' to 'elevated'
UPDATE platform_scopes
SET risk_level = 'elevated'
WHERE risk_level = 'high';

-- 3. Add the aligned constraint
ALTER TABLE platform_scopes
  ADD CONSTRAINT platform_scopes_risk_level_check
    CHECK (risk_level IN ('low', 'standard', 'elevated', 'critical'));
