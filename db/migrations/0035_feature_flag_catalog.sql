-- 0035_feature_flag_catalog.sql
-- Expand feature flag catalog for enterprise operator control and descriptions.

ALTER TABLE feature_flags
  ADD COLUMN IF NOT EXISTS description TEXT;

INSERT INTO feature_flags (name, enabled, rollout_pct, description)
VALUES
  ('llm_summarize', false, 0, 'Enable LLM post-retrieval summarization using stored records only.'),
  ('map_enabled', true, 100, 'Expose the seeker map and geospatial discovery features.'),
  ('feedback_form', true, 100, 'Allow seeker feedback/report submission flows.'),
  ('host_claims', true, 100, 'Allow organizations to submit host claims.'),
  ('two_person_approval', false, 0, 'Require distinct reviewers for high-risk approval flows.'),
  ('sla_enforcement', false, 0, 'Enable workflow SLA enforcement side effects.'),
  ('auto_check_gate', false, 0, 'Allow automated gate checks to advance submissions.'),
  ('notifications_in_app', true, 100, 'Enable in-app notification surfaces and events.'),
  ('content_safety_crisis', true, 100, 'Run Azure AI Content Safety as a second-layer crisis gate after keyword checks.'),
  ('vector_search', false, 0, 'Enable pgvector-backed semantic search and re-ranking.'),
  ('llm_intent_enrich', false, 0, 'Enable LLM-based intent enrichment for ambiguous chat queries.'),
  ('multilingual_descriptions', false, 0, 'Enable translated service descriptions post-retrieval.'),
  ('tts_summaries', false, 0, 'Enable spoken service summaries via Azure Speech.'),
  ('llm_admin_assist', false, 0, 'Enable LLM-assisted admin review suggestions.'),
  ('llm_feedback_triage', false, 0, 'Enable LLM classification of submitted feedback comments.'),
  ('doc_intelligence_intake', false, 0, 'Enable Azure Document Intelligence for PDF intake parsing.'),
  ('telemetry_interactions', false, 0, 'Enable privacy-safe UI breadcrumb telemetry.')
ON CONFLICT (name) DO UPDATE
SET description = EXCLUDED.description;
