import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0070_candidate_revision_lineage.sql'),
  'utf8',
);

const validator = readFileSync(
  resolve(process.cwd(), 'scripts/validate-backend-runtime.sql'),
  'utf8',
);

describe('0070 candidate revision lineage migration', () => {
  it('adds queryable immutable parent lineage and a monotonic revision', () => {
    expect(migration).toContain('revision_of_candidate_id text');
    expect(migration).toContain('revision_number integer NOT NULL DEFAULT 1');
    expect(migration).toContain('lineage_root_candidate_id text');
    expect(migration).toContain('extracted_candidates_revision_parent_fk');
    expect(migration).toContain('REFERENCES public.extracted_candidates(candidate_id)');
    expect(migration).toContain('ON UPDATE RESTRICT');
    expect(migration).toContain('ON DELETE RESTRICT');
    expect(migration).toContain('revision_of_candidate_id IS DISTINCT FROM candidate_id');
    expect(migration).toContain('revision_number > 1');
    expect(migration).toContain('extracted_candidates_lineage_root_fk');
    expect(migration).toContain('idx_extracted_candidates_lineage_revision');
    expect(migration).toContain('(lineage_root_candidate_id, revision_number)');
    expect(migration).toContain('Candidate revision root must equal its parent root');
    expect(migration).toContain('Candidate revision number must equal parent revision plus one');
    expect(migration).toContain('Candidate lineage root is not a valid root row');
    expect(migration).toContain('Candidate lineage identity is immutable after insert');
    expect(migration).toContain('Reviewed candidate content is immutable; append a child revision');
    expect(migration).toContain("OR NEW.review_status IN (");
    expect(migration).toContain('New candidate revisions must enter review as pending');
    expect(migration).toContain('decision_reviewer_user_id text');
    expect(migration).toContain('candidate_admin_assignments_decision_reviewer_check');
    expect(migration).toContain('NEW.decision_reviewer_user_id := authorized_reviewer_user_id');
    expect(migration).toContain('ON DELETE RESTRICT');
    expect(migration).toContain('idx_candidate_completed_decision_reviewer');
  });

  it('protects completed approvals and exposes only bounded reviewer routing', () => {
    expect(migration).toContain('idx_extracted_candidates_revision_parent');
    expect(migration).toContain('Completed candidate approval evidence is immutable');
    expect(migration).toContain("TG_OP = 'INSERT' AND NEW.status = 'completed'");
    expect(migration).toContain('Completed candidate approvals must be reached from a claimed assignment');
    expect(migration).toContain("OLD.status <> 'claimed'");
    expect(migration).toContain('Candidate approval completion requires an active authorized reviewer');
    expect(migration).toContain('assign_candidate_reviewers');
    expect(migration).toContain('FOR UPDATE OF reviewer SKIP LOCKED');
    expect(migration).toContain('reviewer.pending_count < reviewer.max_pending');
    expect(migration).toContain('reviewer.in_review_count < reviewer.max_in_review');
    expect(migration).toContain('REVOKE ALL ON FUNCTION oran_internal.assign_candidate_reviewers');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION oran_internal.assign_candidate_reviewers');
    expect(validator).toContain("'oran_internal.assign_candidate_reviewers(text,integer)'");
    expect(migration).toContain('escalate_candidate_for_review');
    expect(migration).toContain("AND review_status = 'pending'");
    expect(migration).toContain("SET review_status = 'escalated'");
    expect(migration).toContain('Candidate % is not eligible for escalation');
    expect(validator).toContain("'oran_internal.escalate_candidate_for_review(text)'");
    expect(validator).toContain("attname = 'decision_reviewer_user_id'");
    expect(validator).toContain("confdeltype = 'r'");
    expect(validator).toContain('candidate revision-lineage schema is missing');
  });

  it('keeps PostgreSQL special expressions unqualified', () => {
    expect(migration).not.toMatch(
      /pg_catalog\.(?:coalesce|least|greatest|nullif)\s*\(/i,
    );
  });
});
