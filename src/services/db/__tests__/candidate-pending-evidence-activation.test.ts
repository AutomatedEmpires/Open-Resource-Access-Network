import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const activationMigration = readFileSync(
  resolve(process.cwd(), 'db/migrations/0078_candidate_revision_activation.sql'),
  'utf8',
);

const activationValidator = readFileSync(
  resolve(process.cwd(), 'scripts/validate-candidate-lineage-activation.sql'),
  'utf8',
);

const backendValidator = readFileSync(
  resolve(process.cwd(), 'scripts/validate-backend-runtime.sql'),
  'utf8',
);

describe('0078 pending candidate evidence activation', () => {
  it('reopens every legacy terminal tag decision without retaining suppression evidence', () => {
    const legacyReset = activationMigration.slice(
      activationMigration.indexOf(
        'CREATE TEMP TABLE candidate_reopened_human_evidence',
      ),
      activationMigration.indexOf(
        '-- Existing pending human decisions are the same publication blocker.',
      ),
    );

    expect(legacyReset).toContain(
      "confirmation.status IN ('approved', 'modified', 'rejected', 'skipped')",
    );
    expect(legacyReset).toContain(
      "WHERE status IN ('approved', 'modified', 'rejected', 'skipped')",
    );
    for (const clearedColumn of [
      'assigned_to_user_id = NULL',
      'assigned_at = NULL',
      'reviewed_by_user_id = NULL',
      'reviewed_at = NULL',
      'modified_tag_value = NULL',
      'review_notes = NULL',
    ]) {
      expect(legacyReset).toContain(clearedColumn);
    }
  });

  it('serializes suggestion mutation with approval and rejects unresolved approval evidence', () => {
    const suggestionGuard = activationMigration.slice(
      activationMigration.indexOf(
        'CREATE OR REPLACE FUNCTION oran_internal.protect_candidate_llm_suggestion_evidence',
      ),
      activationMigration.indexOf(
        'CREATE OR REPLACE FUNCTION oran_internal.protect_completed_candidate_approval',
      ),
    );
    expect(suggestionGuard).toContain('FROM public.extracted_candidates');
    expect(suggestionGuard).toContain('FOR UPDATE');
    expect(suggestionGuard).toContain("NEW.status = 'pending'");
    expect(suggestionGuard).toContain("completed_review.status = 'completed'");
    expect(suggestionGuard).toContain(
      'BEFORE INSERT OR UPDATE ON public.llm_suggestions',
    );
    expect(activationMigration).toContain(
      'Candidate approval completion requires all LLM suggestions to be resolved',
    );
    expect(activationMigration).not.toContain(
      "IF NEW.outcome = 'verified'\n         AND EXISTS (\n           SELECT 1\n           FROM public.llm_suggestions",
    );
    expect(activationMigration).toContain(
      'REVOKE ALL ON FUNCTION oran_internal.protect_candidate_llm_suggestion_evidence()',
    );
  });

  it('makes pending suggestions a durable readiness and activation blocker', () => {
    expect(activationMigration).toContain(
      "suggestion.status = 'pending';",
    );
    expect(activationMigration).toContain(
      "array_append(blocker_values, 'pending_llm_suggestion')",
    );
    expect(activationMigration).toContain(
      'AND pending_llm_suggestion_count = 0',
    );
    expect(activationValidator).toContain('pending_llm_suggestion');
    expect(activationValidator).toContain(
      'trg_protect_candidate_llm_suggestion_evidence',
    );
    expect(backendValidator).toContain(
      'trg_protect_candidate_llm_suggestion_evidence',
    );
  });
});
