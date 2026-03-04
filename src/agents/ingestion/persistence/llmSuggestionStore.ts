/**
 * Drizzle ORM implementation of LlmSuggestionStore.
 *
 * Maps LlmSuggestion domain objects to the llm_suggestions table.
 */
import { eq, and, gte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { llmSuggestions } from '@/db/schema';
import type { LlmSuggestion, SuggestionField, SuggestionStatus } from '../llmSuggestions';
import type { LlmSuggestionStore, LlmSuggestionFilters } from '../stores';

/**
 * Convert a DB row to an LlmSuggestion domain object.
 */
function rowToSuggestion(
  row: typeof llmSuggestions.$inferSelect
): LlmSuggestion {
  return {
    id: row.id,
    candidateId: row.candidateId,
    fieldName: row.field as SuggestionField,
    suggestedValue: row.suggestedValue,
    llmConfidence: row.confidence,
    suggestionStatus: row.status as SuggestionStatus,
    acceptedValue: row.originalValue ?? undefined,
    reviewedByUserId: row.reviewedBy ?? undefined,
    reviewedAt: row.reviewedAt?.toISOString(),
    reviewNotes: row.reasoning ?? undefined,
    sourceEvidenceRefs: row.evidenceId ? [row.evidenceId] : [],
    llmModel: 'unknown',
    llmProvider: 'azure',
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
        field: suggestion.fieldName,
        suggestedValue: suggestion.suggestedValue,
        originalValue: suggestion.acceptedValue,
        confidence: suggestion.llmConfidence,
        reasoning: suggestion.reviewNotes,
        status: suggestion.suggestionStatus,
        evidenceId: suggestion.sourceEvidenceRefs?.[0],
      });
    },

    async bulkCreate(suggestions: LlmSuggestion[]): Promise<void> {
      if (suggestions.length === 0) return;

      const rows = suggestions.map((s) => ({
        candidateId: s.candidateId,
        suggestionId: s.id ?? crypto.randomUUID(),
        field: s.fieldName,
        suggestedValue: s.suggestedValue,
        originalValue: s.acceptedValue,
        confidence: s.llmConfidence,
        reasoning: s.reviewNotes,
        status: s.suggestionStatus,
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
      suggestionId: string,
      status: SuggestionStatus,
      acceptedValue?: string,
      userId?: string,
      notes?: string
    ): Promise<void> {
      const updates: Record<string, unknown> = {
        status,
        reviewedAt: new Date(),
      };

      if (acceptedValue !== undefined) {
        updates.originalValue = acceptedValue;
      }
      if (userId) {
        updates.reviewedBy = userId;
      }
      if (notes) {
        updates.reasoning = notes;
      }

      await db
        .update(llmSuggestions)
        .set(updates)
        .where(eq(llmSuggestions.id, suggestionId));
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
        conditions.push(eq(llmSuggestions.field, filters.fieldName));
      }
      if (filters.suggestionStatus) {
        conditions.push(eq(llmSuggestions.status, filters.suggestionStatus));
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

      return rows.map(rowToSuggestion);
    },

    async listForCandidate(candidateId: string): Promise<LlmSuggestion[]> {
      const rows = await db
        .select()
        .from(llmSuggestions)
        .where(eq(llmSuggestions.candidateId, candidateId));
      return rows.map(rowToSuggestion);
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
      return rows.map(rowToSuggestion);
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
        map.set(row.field as SuggestionField, value);
      }
      return map;
    },
  };
}
