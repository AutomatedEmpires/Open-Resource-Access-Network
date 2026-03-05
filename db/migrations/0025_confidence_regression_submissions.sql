-- Migration 0025: Confidence regression alerts (universal submissions)
--
-- Adds a new universal submissions type: 'confidence_regression'.
-- This is used for system- or pipeline-generated work items when a previously
-- verified service appears to need re-review.

-- Extend the submissions.submission_type CHECK constraint.
ALTER TABLE submissions
  DROP CONSTRAINT IF EXISTS submissions_submission_type_check;

ALTER TABLE submissions
  ADD CONSTRAINT submissions_submission_type_check
    CHECK (submission_type IN (
      'service_verification',
      'confidence_regression',
      'org_claim',
      'data_correction',
      'new_service',
      'removal_request',
      'community_report',
      'appeal'
    ));
