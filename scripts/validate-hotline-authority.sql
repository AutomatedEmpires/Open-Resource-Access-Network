-- Read-only production check for migration 0065.
-- Run with a role permitted to execute oran_internal maintenance functions.
BEGIN TRANSACTION READ ONLY;

SELECT oran_internal.assert_verified_hotline_authority('applied');

ROLLBACK;
