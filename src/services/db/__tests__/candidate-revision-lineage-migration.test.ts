import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const expandMigration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0077_candidate_revision_lineage.sql'),
  'utf8',
);

const activationMigration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0078_candidate_revision_activation.sql'),
  'utf8',
);

const validator = readFileSync(
  resolve(process.cwd(), 'scripts/validate-backend-runtime.sql'),
  'utf8',
);

const migrationWorkflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/db-migrate.yml'),
  'utf8',
);

const productionReleaseScript = readFileSync(
  resolve(process.cwd(), 'scripts/db/release-supabase-production.sh'),
  'utf8',
);

const migrationVerifier = readFileSync(
  resolve(process.cwd(), 'scripts/db/verify-migrations.mjs'),
  'utf8',
);

const activationValidator = readFileSync(
  resolve(process.cwd(), 'scripts/validate-candidate-lineage-activation.sql'),
  'utf8',
);

describe('0077 candidate revision lineage expand migration', () => {
  it('lands nullable evidence and lineage fields without activating the workflow', () => {
    expect(expandMigration).toContain('revision_of_candidate_id text');
    expect(expandMigration).toContain('lineage_root_candidate_id text');
    expect(expandMigration).toContain('revision_number integer;');
    expect(expandMigration).toContain('decision_reviewer_profile_id uuid');
    expect(expandMigration).toContain(
      'candidate_admin_assignments_decision_reviewer_profile_fk',
    );
    expect(expandMigration).not.toContain('decision_reviewer_user_id');
    expect(expandMigration).not.toMatch(
      /ALTER COLUMN (?:lineage_root_candidate_id|revision_number) SET NOT NULL/,
    );
    expect(expandMigration).not.toContain('trg_protect_completed_candidate_approval');
    expect(expandMigration).not.toContain('trg_enforce_candidate_revision_lineage');
    expect(expandMigration).not.toContain('ALTER COLUMN min_admin_approvals SET DEFAULT 2');
    expect(expandMigration).not.toContain('approval.claimed');
    expect(expandMigration).not.toMatch(
      /GRANT EXECUTE ON FUNCTION oran_internal\.(?:assign|escalate|reroute)_candidate/,
    );
    expect(expandMigration).not.toContain(
      'GRANT EXECUTE ON FUNCTION oran_internal.list_undercovered_candidate_reviews',
    );
  });

  it('backfills roots and preserves legacy inserts that omit lineage fields', () => {
    expect(expandMigration).toContain(
      'lineage_root_candidate_id = COALESCE(lineage_root_candidate_id, candidate_id)',
    );
    expect(expandMigration).toContain(
      'revision_number = COALESCE(revision_number, 1)',
    );
    expect(expandMigration).toContain('prepare_candidate_revision_lineage');
    expect(expandMigration).toContain(
      'BEFORE INSERT ON public.extracted_candidates',
    );
    expect(expandMigration).toContain(
      'NEW.lineage_root_candidate_id := COALESCE(',
    );
    expect(expandMigration).toContain(
      'NEW.revision_number := COALESCE(NEW.revision_number, 1)',
    );
  });

  it('prepares bounded support functions but keeps them dark', () => {
    expect(expandMigration).toContain('assign_candidate_reviewers');
    expect(expandMigration).toContain('FOR UPDATE OF reviewer SKIP LOCKED');
    expect(expandMigration).toContain('escalate_candidate_for_review');
    expect(expandMigration).toContain(
      'FROM PUBLIC, oran_runtime, oran_backend_runtime',
    );
    expect(expandMigration).toContain('SELECT count(DISTINCT CASE');
    expect(expandMigration).toContain(
      "assignment.outcome = 'verified'",
    );
    expect(expandMigration).toContain(
      "existing_assignment.status IN ('pending', 'claimed', 'completed')",
    );
    expect(expandMigration).toContain(
      "candidate_admin_assignments.status IN (\n      'declined', 'expired', 'reassigned'",
    );
    expect(expandMigration).toContain('reviewer.coverage_counties');
    expect(expandMigration).toContain('reviewer.coverage_states');
    expect(expandMigration).toContain('reviewer.category_expertise');
    expect(expandMigration).toContain('WHEN routing.county_match THEN 0');
    expect(expandMigration).toContain('RETURN existing_count;');
    expect(expandMigration).toContain(
      "assignment.expires_at <= NOW()",
    );
    expect(expandMigration).toContain(
      "SET status = 'expired'",
    );
    expect(expandMigration).toContain(
      "SET status = 'reassigned'",
    );
    expect(expandMigration).toContain(
      "assignment.status = 'claimed'\n          OR reviewer.is_accepting_new IS TRUE",
    );
    expect(expandMigration).toContain(
      'assignment.expires_at IS NULL\n           OR assignment.expires_at > NOW()',
    );
    expect(expandMigration).toContain(
      'ORDER BY (reviewer.id = ANY(expired_reviewer_ids)) ASC',
    );
    expect(expandMigration).toContain(
      'CREATE OR REPLACE FUNCTION oran_internal.list_undercovered_candidate_reviews',
    );
    expect(expandMigration).toContain('RETURNS SETOF text');
    expect(expandMigration).toContain('p_batch_limit > 500');
    expect(expandMigration).toContain(
      'ORDER BY candidate.created_at ASC, candidate.candidate_id ASC',
    );
    expect(expandMigration).not.toMatch(
      /CREATE OR REPLACE FUNCTION oran_internal\.list_undercovered_candidate_reviews[\s\S]*?PERFORM oran_internal\.assign_candidate_reviewers/,
    );
    expect(expandMigration).toContain(
      'REVOKE ALL ON FUNCTION oran_internal.list_undercovered_candidate_reviews(integer, integer)',
    );
  });
});

describe('0078 candidate revision lineage activation migration', () => {
  it('validates lineage before making identity non-null and immutable', () => {
    expect(activationMigration).toContain(
      'VALIDATE CONSTRAINT extracted_candidates_revision_parent_fk',
    );
    expect(activationMigration).toContain(
      'VALIDATE CONSTRAINT extracted_candidates_lineage_root_fk',
    );
    expect(activationMigration).toContain(
      'VALIDATE CONSTRAINT extracted_candidates_revision_number_check',
    );
    expect(activationMigration).toContain(
      'candidate lineage activation refused: child parent/root/revision drift exists',
    );
    expect(activationMigration).toContain(
      'candidate lineage activation refused: a referenced root is not self-rooted revision 1',
    );
    expect(activationMigration).toContain(
      'candidate lineage activation refused: at least two active authorized community reviewers with capacity are required',
    );
    expect(activationMigration).toContain('index_row.indisunique');
    expect(activationMigration).toContain('index_row.indisvalid');
    expect(activationMigration).toContain(
      "ARRAY['lineage_root_candidate_id', 'revision_number']::text[]",
    );
    expect(activationMigration).toContain(
      'candidate lineage activation refused: unique lineage revision index is missing or invalid',
    );
    expect(activationMigration).toContain(
      'PERFORM oran_internal.assign_candidate_reviewers(',
    );
    expect(activationMigration).toContain(
      'candidate lineage activation refused: one or more open candidates lack two independent community reviewer identities',
    );
    expect(activationMigration).toContain(
      "WHEN candidate.review_status = 'verified' THEN 'rejected'",
    );
    expect(activationMigration).toContain(
      "AND assignment.outcome = 'escalated'",
    );
    expect(activationMigration).toContain(
      'ALTER COLUMN lineage_root_candidate_id SET NOT NULL',
    );
    expect(activationMigration).toContain(
      'ALTER COLUMN revision_number SET NOT NULL',
    );
    expect(activationMigration).toContain(
      'Candidate lineage identity is immutable after insert',
    );
    expect(activationMigration).toContain(
      'Reviewed candidate content is immutable; append a child revision',
    );
    expect(activationMigration).toContain(
      'NEW.confidence_score IS DISTINCT FROM OLD.confidence_score',
    );
    expect(activationMigration).toContain(
      'NEW.verification_checklist IS DISTINCT FROM OLD.verification_checklist',
    );
    expect(activationMigration).toContain(
      'NEW.investigation_pack IS DISTINCT FROM OLD.investigation_pack',
    );
    expect(activationMigration).toContain(
      'Candidate revision number must equal parent revision plus one',
    );
    expect(activationMigration).toContain('trg_enforce_candidate_revision_lineage');
    expect(activationMigration).toContain(
      'DROP TRIGGER IF EXISTS trg_prepare_candidate_revision_lineage',
    );
  });

  it('reopens legacy completions, then binds and freezes authorized decisions', () => {
    expect(activationMigration).toContain(
      'candidate_admin_assignments_decision_reviewer_check',
    );
    expect(activationMigration).toContain(
      'NEW.decision_reviewer_profile_id := authorized_reviewer_profile_id',
    );
    expect(activationMigration).toContain(
      'decision_reviewer_profile_id = admin_profile_id',
    );
    expect(activationMigration).toContain(
      'Never infer immutable authority from that assignment',
    );
    expect(activationMigration).toContain(
      "WHERE assignment.status = 'completed';",
    );
    expect(activationMigration).not.toContain(
      'SET decision_reviewer_profile_id = reviewer.id',
    );
    expect(activationMigration).not.toContain('decision_reviewer_user_id');
    expect(activationMigration).toContain(
      'Completed candidate approval evidence is immutable',
    );
    expect(activationMigration).toContain(
      'Completed candidate approvals must be reached from a claimed assignment',
    );
    expect(activationMigration).toContain(
      'Candidate approval completion requires an active authorized community reviewer',
    );
    expect(activationMigration).toContain("account.role = 'community_admin'");
    expect(activationMigration).toContain(
      'oversight-only assignment occupies a reviewer slot',
    );
    expect(activationMigration).toContain(
      'pending human evidence coexists with completed approval evidence',
    );
    expect(activationMigration).toContain(
      "AND outcome IN ('verified', 'rejected', 'escalated')",
    );
    expect(activationMigration).toContain(
      'AND claimed_at IS NOT NULL',
    );
    expect(activationMigration).toContain(
      "WHERE status IN ('approved', 'modified')",
    );
    expect(activationMigration).toContain("WHERE status = 'accepted'");
    const legacyHumanEvidenceReset = activationMigration.slice(
      activationMigration.indexOf(
        'CREATE TEMP TABLE candidate_reopened_human_evidence',
      ),
      activationMigration.indexOf(
        '-- Existing pending human decisions are the same publication blocker.',
      ),
    );
    expect(legacyHumanEvidenceReset).toContain(
      "WHERE confirmation.status IN ('approved', 'modified')",
    );
    expect(legacyHumanEvidenceReset).toContain(
      "WHERE suggestion.status = 'accepted'",
    );
    expect(legacyHumanEvidenceReset).not.toContain(
      'confirmation.reviewed_by_user_id IS NULL',
    );
    expect(legacyHumanEvidenceReset).not.toContain(
      'suggestion.reviewed_by IS NULL',
    );
    expect(legacyHumanEvidenceReset).toContain('assigned_to_user_id = NULL');
    expect(legacyHumanEvidenceReset).toContain('reviewed_by_user_id = NULL');
    expect(legacyHumanEvidenceReset).toContain('reviewed_by = NULL');
    expect(activationMigration).toContain('original_value = NULL');
    expect(activationMigration).toContain('ON DELETE RESTRICT');
    expect(activationMigration).toContain('trg_protect_completed_candidate_approval');
  });

  it('activates the two-person gate, audit vocabulary, and bounded runtime ACL', () => {
    expect(activationMigration).toContain(
      'ALTER COLUMN min_admin_approvals SET DEFAULT 2',
    );
    expect(activationMigration).toContain('approval.claimed');
    expect(activationMigration).toContain('approval.decided');
    expect(activationMigration).toContain(
      'GRANT EXECUTE ON FUNCTION oran_internal.assign_candidate_reviewers(text, integer)',
    );
    expect(activationMigration).toContain(
      'GRANT EXECUTE ON FUNCTION oran_internal.list_undercovered_candidate_reviews(integer, integer)',
    );
    expect(activationMigration).toContain(
      'GRANT EXECUTE ON FUNCTION oran_internal.escalate_candidate_for_review(text)',
    );
    expect(activationMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.evaluate_candidate_readiness',
    );
    expect(activationMigration).toContain(
      'count(DISTINCT CASE',
    );
    expect(activationMigration).toContain(
      "WHEN assignment.outcome = 'rejected'",
    );
    expect(activationMigration).toContain(
      'AND escalation_count = 0 THEN',
    );
    expect(activationMigration).toContain("tag.tag_type = 'category'");
    expect(activationMigration).toContain("tag.tag_type = 'geographic'");
    expect(activationMigration).not.toContain(
      "AND tag.tag_type = 'service_type'",
    );
    for (const blocker of [
      'missing_required_fields',
      'missing_required_tags',
      'quarantine_source',
      'critical_verification_failure',
      'domain_allowlist_failed',
      'candidate_escalated',
    ]) {
      expect(activationMigration).toContain(blocker);
      expect(activationValidator).toContain(blocker);
    }
    expect(activationMigration).toContain(
      "rejected_confirmation.status IN ('rejected', 'skipped')",
    );
    expect(activationMigration).toContain(
      'GRANT EXECUTE ON FUNCTION public.evaluate_candidate_readiness(text)',
    );
    expect(validator).toContain(
      "'oran_internal.assign_candidate_reviewers(text,integer)'",
    );
    expect(validator).toContain(
      "'oran_internal.list_undercovered_candidate_reviews(integer,integer)'",
    );
    expect(validator).toContain(
      "'oran_internal.escalate_candidate_for_review(text)'",
    );
    expect(validator).toContain(
      "'public.evaluate_candidate_readiness(text)'",
    );
    expect(validator).toContain('candidate revision-lineage triggers are not activated');
    expect(validator).toContain('candidate dual-approval workflow is not activated');
    expect(validator).toContain("tgenabled IN ('O', 'A')");
    expect(validator).not.toContain("tgenabled <> 'D'");
  });

  it('keeps PostgreSQL special expressions unqualified', () => {
    expect(`${expandMigration}\n${activationMigration}`).not.toMatch(
      /pg_catalog\.(?:coalesce|least|greatest|nullif)\s*\(/i,
    );
  });
});

describe('candidate revision deployment boundary', () => {
  it('permits production migration writes only from the exact remote main SHA', () => {
    expect(migrationWorkflow).toContain(
      'if [ "$GITHUB_REF" != "refs/heads/main" ]',
    );
    expect(migrationWorkflow).toContain(
      'git fetch --no-tags origin refs/heads/main:refs/remotes/origin/main',
    );
    expect(migrationWorkflow).toContain(
      'remote_main_sha="$(git rev-parse refs/remotes/origin/main)"',
    );
    expect(migrationWorkflow).toContain(
      'if [ "$checkout_sha" != "$remote_main_sha" ]',
    );
  });

  it('keeps 0078 behind an explicit exact-deployment and health proof', () => {
    expect(migrationWorkflow).toContain('activate_candidate_lineage:');
    expect(migrationWorkflow).toContain('lineage_app_sha:');
    expect(migrationWorkflow).toContain('deployments: read');
    expect(migrationWorkflow).toContain(
      'if [ "$LINEAGE_APP_SHA" != "$checkout_sha" ]',
    );
    expect(migrationWorkflow).toContain(
      'https://api.github.com/repos/$REPOSITORY/deployments',
    );
    expect(migrationWorkflow).toContain('[ "$latest_state" != "success" ]');
    const deploymentStatusSelection = migrationWorkflow.slice(
      migrationWorkflow.indexOf('latest_status="$(printf'),
      migrationWorkflow.indexOf('if [ -z "$latest_status" ]'),
    );
    expect(deploymentStatusSelection).toContain('sort_by(.created_at)');
    expect(deploymentStatusSelection).toContain('| .[0]');
    expect(migrationWorkflow).toContain('[ "$latest_creator" != "vercel[bot]" ]');
    expect(migrationWorkflow).toContain(
      'oran-[A-Za-z0-9-]+-jackson-coles-projects-dd76106c\\.vercel\\.app',
    );
    expect(migrationWorkflow).toContain('"${health_base_url%/}/api/health"');
    expect(migrationWorkflow).toContain('.status == "healthy"');
    expect(migrationWorkflow).toContain('.database == "connected"');
    expect(migrationWorkflow).toContain('SUPABASE_TARGET_SHA256');
    expect(migrationWorkflow).toContain('.databaseTarget == $database_target');
    expect(migrationWorkflow).toContain(
      "printf 'LINEAGE_HEALTH_URL=%s\\n' \"$health_base_url\" >> \"$GITHUB_ENV\"",
    );
  });

  it('applies at most 0077 during a normal migration run', () => {
    const activationBoundary = migrationWorkflow.slice(
      migrationWorkflow.indexOf(
        'if [ "$filename" = "0078_candidate_revision_activation.sql" ]',
      ),
      migrationWorkflow.indexOf('echo "Applying migration: $filename"'),
    );
    expect(activationBoundary).toContain(
      '[ "$ACTIVATE_CANDIDATE_LINEAGE" != "true" ]',
    );
    expect(activationBoundary).toContain('break');
    expect(migrationWorkflow).toContain(
      "filename = '0078_candidate_revision_activation.sql'",
    );
    expect(migrationWorkflow).toContain(
      "sed -n '1,/^0077_candidate_revision_lineage.sql$/p'",
    );
  });

  it('requires 0077 to be committed by an earlier run before activation writes', () => {
    const activationPrecondition =
      'if [ "$ACTIVATE_CANDIDATE_LINEAGE" = "true" ]; then';
    expect(migrationWorkflow).toContain(activationPrecondition);
    expect(migrationWorkflow).toContain(
      "filename = '0077_candidate_revision_lineage.sql'",
    );
    expect(migrationWorkflow).toContain(
      '0078 activation requires 0077 to have completed in a prior non-activation run.',
    );
    expect(migrationWorkflow).toContain(
      '0078 is already recorded; activation is a one-time contract transition.',
    );
    expect(migrationWorkflow.indexOf(activationPrecondition)).toBeLessThan(
      migrationWorkflow.indexOf('while IFS= read -r file; do'),
    );
  });

  it('provides no ungated activation path in the production release helper', () => {
    expect(productionReleaseScript).toContain(
      'if [[ "$filename" == "0078_candidate_revision_activation.sql"',
    );
    expect(productionReleaseScript).toContain(
      '0078 activation is accepted only through the gated db-migrate workflow',
    );
    expect(productionReleaseScript).toContain(
      '76|0077_candidate_revision_lineage.sql|t|0|t|f|f',
    );
    expect(productionReleaseScript).toContain(
      '77|0078_candidate_revision_activation.sql|t|0|t|f|f',
    );
    expect(productionReleaseScript).not.toContain('ACTIVATE_CANDIDATE_LINEAGE');
  });

  it('proves the activated catalog and repeats health after the mutation', () => {
    expect(activationValidator).toContain('BEGIN TRANSACTION READ ONLY;');
    expect(activationValidator).toContain(
      "filename = '0078_candidate_revision_activation.sql'",
    );
    expect(activationValidator).toContain(
      'candidate-lineage semantic drift exists after activation',
    );
    expect(activationValidator).toContain(
      'candidate-lineage unique revision index is incomplete',
    );
    expect(activationValidator).toContain(
      'fewer than two active authorized community reviewer identities remain',
    );
    expect(activationValidator).toContain(
      'an open candidate lacks two independent community reviewer identities',
    );
    expect(activationValidator).toContain(
      'bounded candidate undercoverage selector is incomplete',
    );
    expect(activationValidator).toContain(
      "'oran_internal.list_undercovered_candidate_reviews(integer,integer)'",
    );
    expect(activationValidator).toContain(
      'assignment.expires_at > NOW()',
    );
    expect(activationValidator).toContain(
      'candidate human decision evidence lacks community reviewer authority',
    );
    expect(activationValidator).toContain(
      'erasure.text_tombstone = confirmation.reviewed_by_user_id',
    );
    expect(activationValidator).toContain(
      'erasure.text_tombstone = suggestion.reviewed_by',
    );
    expect(activationValidator).toContain(
      'identity-bound candidate readiness function is incomplete',
    );
    expect(activationValidator).toContain("tgenabled IN ('O', 'A')");
    expect(activationValidator).not.toContain("tgenabled <> 'D'");
    expect(migrationVerifier).toContain('ENABLE REPLICA TRIGGER');
    expect(migrationVerifier).toContain(
      'replica-only state did not fail the activation validator',
    );
    expect(migrationVerifier).toContain(
      'oran_internal.queue_account_erasure',
    );
    expect(migrationVerifier).toContain(
      'reviewer account-erasure approval privacy proof passed',
    );
    expect(activationValidator).toContain(
      "'oran_backend_runtime', workflow_function, 'EXECUTE'",
    );
    expect(activationValidator).toContain('ROLLBACK;');
    expect(migrationWorkflow).toContain(
      '-f scripts/validate-candidate-lineage-activation.sql',
    );
    const postActivationStep = migrationWorkflow.slice(
      migrationWorkflow.indexOf(
        'name: Prove activated catalog and repeat exact deployment health',
      ),
    );
    expect(postActivationStep).toContain(
      '"${LINEAGE_HEALTH_URL%/}/api/health"',
    );
    expect(postActivationStep).toContain(
      'The exact deployment became unhealthy or changed database target after 0078 activation.',
    );
    expect(postActivationStep).toContain('.databaseTarget == $database_target');
  });
});
