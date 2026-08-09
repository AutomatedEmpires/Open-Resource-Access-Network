/**
 * Drizzle ORM implementation of LlmSuggestionStore.
 *
 * Maps LlmSuggestion domain objects to the llm_suggestions table.
 */
import { eq, and, gte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { llmSuggestions } from '@/db/schema';
import type { LlmSuggestion, SuggestionField, SuggestionStatus } from '../llmSuggestions';
import type { LlmSuggestionStore, LlmSuggestionFilters } from '../stores';

type DatabaseSuggestionField =
  | 'organization_name'
  | 'service_name'
  | 'description'
  | 'website_url'
  | 'phone'
  | 'address'
  | 'eligibility'
  | 'schedule'
  | 'category'
  | 'tags';

const DOMAIN_TO_DATABASE_FIELD: Partial<Record<SuggestionField, DatabaseSuggestionField>> = {
  name: 'service_name',
  description: 'description',
  phone: 'phone',
  website: 'website_url',
};

const DATABASE_TO_DOMAIN_FIELD = new Map<DatabaseSuggestionField, SuggestionField>(
  Object.entries(DOMAIN_TO_DATABASE_FIELD).map(([domain, database]) => (
    [database as DatabaseSuggestionField, domain as SuggestionField]
  )),
);

export function toDatabaseSuggestionField(field: SuggestionField): DatabaseSuggestionField {
  const databaseField = DOMAIN_TO_DATABASE_FIELD[field];
  if (!databaseField) {
    throw new Error(`Suggestion field ${field} is not supported by the persistence contract`);
  }
  return databaseField;
}

export function fromDatabaseSuggestionField(field: string): SuggestionField | null {
  return DATABASE_TO_DOMAIN_FIELD.get(field as DatabaseSuggestionField) ?? null;
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

function toDatabaseStatus(status: SuggestionStatus): string {
  return status === 'modified' ? 'accepted' : status;
}

function fromDatabaseStatus(row: typeof llmSuggestions.$inferSelect): SuggestionStatus {
  if (row.status === 'accepted') {
    return row.originalValue !== null && row.originalValue !== row.suggestedValue
      ? 'modified'
      : 'accepted';
  }
  // Superseded is a non-accepted terminal result in the persistence schema.
  if (row.status === 'superseded') return 'rejected';
  return row.status as SuggestionStatus;
}

/**
 * Convert a DB row to an LlmSuggestion domain object.
 */
function rowToSuggestion(
  row: typeof llmSuggestions.$inferSelect
): LlmSuggestion | null {
  const fieldName = fromDatabaseSuggestionField(row.field);
  if (!fieldName) return null;
  return {
    id: row.id,
    candidateId: row.candidateId,
    fieldName,
    suggestedValue: row.suggestedValue,
    llmConfidence: row.confidence,
    suggestionStatus: fromDatabaseStatus(row),
    acceptedValue: row.originalValue ?? undefined,
    reviewedByUserId: row.reviewedBy ?? undefined,
    reviewedAt: row.reviewedAt?.toISOString(),
    reviewNotes: row.reasoning ?? undefined,
    sourceEvidenceRefs: row.evidenceId ? [row.evidenceId] : [],
    llmModel: 'unknown',
    llmProvider: 'unknown',
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Creates an LlmSuggestionStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleLlmSuggestionStore(
  db: NodePgDatabase<Record<string, unknown>>
): LlmSuggestionStore {
  return {
    async create(suggestion: LlmSuggestion): Promise<void> {
      await db.insert(llmSuggestions).values({
        candidateId: suggestion.candidateId,
        suggestionId: suggestion.id ?? crypto.randomUUID(),
        field: toDatabaseSuggestionField(suggestion.fieldName),
        suggestedValue: suggestion.suggestedValue,
        originalValue: suggestion.acceptedValue,
        confidence: suggestion.llmConfidence,
        reasoning: suggestion.reviewNotes,
        status: toDatabaseStatus(suggestion.suggestionStatus),
        evidenceId: suggestion.sourceEvidenceRefs?.[0],
      });
    },

    async bulkCreate(suggestions: LlmSuggestion[]): Promise<void> {
      if (suggestions.length === 0) return;

      const rows = suggestions.map((s) => ({
        candidateId: s.candidateId,
        suggestionId: s.id ?? crypto.randomUUID(),
        field: toDatabaseSuggestionField(s.fieldName),
        suggestedValue: s.suggestedValue,
        originalValue: s.acceptedValue,
        confidence: s.llmConfidence,
        reasoning: s.reviewNotes,
        status: toDatabaseStatus(s.suggestionStatus),
        evidenceId: s.sourceEvidenceRefs?.[0],
      }));

      await db.insert(llmSuggestions).values(rows);
    },

    async getById(suggestionId: string): Promise<LlmSuggestion | null> {
      const rows = await db
        .select()
        .from(llmSuggestions)
        .where(eq(llmSuggestions.id, suggestionId))
        .limit(1);
      return rows.length > 0 ? rowToSuggestion(rows[0]) : null;
    },

    async updateDecision(
      candidateId: string,
      suggestionId: string,
      status: SuggestionStatus,
      acceptedValue?: string,
      userId?: string,
      notes?: string
    ): Promise<'updated' | 'conflict'> {
      const result = await db.execute(sql`
        WITH locked_candidate AS MATERIALIZED (
          SELECT candidate_id
          FROM public.extracted_candidates
          WHERE candidate_id = ${candidateId}
            AND review_status IN ('pending', 'in_review', 'escalated')
            AND EXISTS (
              SELECT 1
              FROM public.candidate_admin_assignments actor_assignment
              JOIN public.admin_review_profiles actor_reviewer
                ON actor_reviewer.id = actor_assignment.admin_profile_id
              JOIN public.user_profiles actor_account
                ON actor_account.user_id = actor_reviewer.user_id
              WHERE actor_assignment.candidate_id = extracted_candidates.candidate_id
                AND actor_assignment.status = 'claimed'
                AND (actor_assignment.expires_at IS NULL OR actor_assignment.expires_at > NOW())
                AND actor_reviewer.user_id = ${userId ?? null}
                AND actor_reviewer.is_active IS TRUE
                AND COALESCE(actor_account.account_status, 'active') = 'active'
                AND actor_account.role = 'community_admin'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM public.candidate_admin_assignments completed_review
              WHERE completed_review.candidate_id = extracted_candidates.candidate_id
                AND completed_review.status = 'completed'
            )
          FOR UPDATE
        ), updated_decision AS (
          UPDATE public.llm_suggestions suggestion
          SET status = ${toDatabaseStatus(status)},
              original_value = ${status === 'modified' ? acceptedValue ?? null : null},
              reviewed_by = ${userId ?? null},
              reviewed_at = NOW(),
              reasoning = COALESCE(${notes ?? null}, reasoning)
          FROM locked_candidate
          WHERE suggestion.id = ${suggestionId}
            AND suggestion.candidate_id = locked_candidate.candidate_id
            AND suggestion.status = 'pending'
          RETURNING suggestion.id, suggestion.candidate_id
        ), audit_event AS (
          INSERT INTO public.ingestion_audit_events
            (candidate_id, event_type, actor_type, actor_id, details)
          SELECT updated_decision.candidate_id,
                 'field_edited',
                 'admin',
                 ${userId ?? null},
                 ${JSON.stringify({
                   suggestionId,
                   decisionStatus: status,
                   modified: status === 'modified',
                 })}::jsonb
          FROM updated_decision
          RETURNING candidate_id
        )
        SELECT updated_decision.id
        FROM updated_decision
        JOIN audit_event USING (candidate_id)
      `);
      return resultRows<{ id: string }>(result)[0] ? 'updated' : 'conflict';
    },

    async list(
      filters: LlmSuggestionFilters,
      limit?: number,
      offset?: number
    ): Promise<LlmSuggestion[]> {
      const conditions = [];

      if (filters.candidateId) {
        conditions.push(eq(llmSuggestions.candidateId, filters.candidateId));
      }
      if (filters.fieldName) {
        conditions.push(eq(llmSuggestions.field, toDatabaseSuggestionField(filters.fieldName)));
      }
      if (filters.suggestionStatus) {
        conditions.push(eq(llmSuggestions.status, toDatabaseStatus(filters.suggestionStatus)));
      }
      if (filters.minConfidence !== undefined) {
        conditions.push(gte(llmSuggestions.confidence, filters.minConfidence));
      }
      if (filters.reviewedByUserId) {
        conditions.push(
          eq(llmSuggestions.reviewedBy, filters.reviewedByUserId)
        );
      }

      const rows = await db
        .select()
        .from(llmSuggestions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(limit ?? 50)
        .offset(offset ?? 0);

      const suggestions = rows.flatMap((row) => {
        const suggestion = rowToSuggestion(row);
        return suggestion ? [suggestion] : [];
      });
      return filters.suggestionStatus
        ? suggestions.filter((suggestion) => suggestion.suggestionStatus === filters.suggestionStatus)
        : suggestions;
    },

    async listForCandidate(candidateId: string): Promise<LlmSuggestion[]> {
      const rows = await db
        .select()
        .from(llmSuggestions)
        .where(eq(llmSuggestions.candidateId, candidateId));
      return rows.flatMap((row) => {
        const suggestion = rowToSuggestion(row);
        return suggestion ? [suggestion] : [];
      });
    },

    async listPendingForCandidate(
      candidateId: string
    ): Promise<LlmSuggestion[]> {
      const rows = await db
        .select()
        .from(llmSuggestions)
        .where(
          and(
            eq(llmSuggestions.candidateId, candidateId),
            eq(llmSuggestions.status, 'pending')
          )
        );
      return rows.flatMap((row) => {
        const suggestion = rowToSuggestion(row);
        return suggestion ? [suggestion] : [];
      });
    },

    async getAcceptedValues(
      candidateId: string
    ): Promise<Map<SuggestionField, string>> {
      const rows = await db
        .select()
        .from(llmSuggestions)
        .where(
          and(
            eq(llmSuggestions.candidateId, candidateId),
            eq(llmSuggestions.status, 'accepted')
          )
        );

      const map = new Map<SuggestionField, string>();
      for (const row of rows) {
        // Use the original suggestedValue when accepted as-is
        const value = row.originalValue ?? row.suggestedValue;
        const field = fromDatabaseSuggestionField(row.field);
        if (field) map.set(field, value);
      }
      return map;
    },
  };
}
