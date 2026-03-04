/**
 * Drizzle ORM implementation of AdminRoutingStore.
 *
 * Maps AdminRoutingRule domain objects to the admin_routing_rules table.
 */
import { eq, and, desc } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { adminRoutingRules } from '@/db/schema';
import type { AdminRoutingRule, AdminRoutingStore } from '../stores';

/**
 * Convert a DB row to an AdminRoutingRule domain object.
 */
function rowToRule(row: typeof adminRoutingRules.$inferSelect): AdminRoutingRule {
  return {
    id: row.id,
    jurisdictionCountry: row.jurisdictionCountry,
    jurisdictionState: row.jurisdictionState ?? undefined,
    jurisdictionCounty: row.jurisdictionCounty ?? undefined,
    assignedRole: row.assignedRole as AdminRoutingRule['assignedRole'],
    assignedUserId: row.assignedUserId ?? undefined,
    priority: row.priority,
    isActive: row.isActive,
  };
}

/**
 * Creates an AdminRoutingStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleAdminRoutingStore(
  db: NodePgDatabase<Record<string, unknown>>
): AdminRoutingStore {
  return {
    async findBestMatch(
      country: string,
      state?: string,
      county?: string
    ): Promise<AdminRoutingRule | null> {
      // Find the most specific matching rule:
      // 1. country + state + county (most specific)
      // 2. country + state
      // 3. country only (fallback)
      // Within each level, use priority (higher = first)
      const rows = await db
        .select()
        .from(adminRoutingRules)
        .where(
          and(
            eq(adminRoutingRules.isActive, true),
            eq(adminRoutingRules.jurisdictionCountry, country)
          )
        )
        .orderBy(desc(adminRoutingRules.priority));

      if (rows.length === 0) return null;

      // Score each rule by specificity
      let bestMatch: typeof adminRoutingRules.$inferSelect | null = null;
      let bestScore = -1;

      for (const row of rows) {
        let score = 0;

        // Country match is already guaranteed by the query
        // Check state match
        if (row.jurisdictionState && state) {
          if (row.jurisdictionState === state) {
            score += 2;
          } else {
            continue; // State specified but doesn't match, skip
          }
        } else if (row.jurisdictionState && !state) {
          continue; // Rule requires state but none provided
        }

        // Check county match
        if (row.jurisdictionCounty && county) {
          if (row.jurisdictionCounty === county) {
            score += 1;
          } else {
            continue; // County specified but doesn't match, skip
          }
        } else if (row.jurisdictionCounty && !county) {
          continue; // Rule requires county but none provided
        }

        // Tie-break with priority
        const finalScore = score * 1000 + row.priority;

        if (finalScore > bestScore) {
          bestScore = finalScore;
          bestMatch = row;
        }
      }

      return bestMatch ? rowToRule(bestMatch) : null;
    },

    async listActive(): Promise<AdminRoutingRule[]> {
      const rows = await db
        .select()
        .from(adminRoutingRules)
        .where(eq(adminRoutingRules.isActive, true))
        .orderBy(desc(adminRoutingRules.priority));
      return rows.map(rowToRule);
    },

    async upsert(rule: AdminRoutingRule): Promise<void> {
      if (rule.id) {
        await db
          .update(adminRoutingRules)
          .set({
            jurisdictionCountry: rule.jurisdictionCountry,
            jurisdictionState: rule.jurisdictionState,
            jurisdictionCounty: rule.jurisdictionCounty,
            assignedRole: rule.assignedRole,
            assignedUserId: rule.assignedUserId,
            priority: rule.priority,
            isActive: rule.isActive,
            updatedAt: new Date(),
          })
          .where(eq(adminRoutingRules.id, rule.id));
      } else {
        await db.insert(adminRoutingRules).values({
          jurisdictionCountry: rule.jurisdictionCountry,
          jurisdictionState: rule.jurisdictionState,
          jurisdictionCounty: rule.jurisdictionCounty,
          assignedRole: rule.assignedRole,
          assignedUserId: rule.assignedUserId,
          priority: rule.priority,
          isActive: rule.isActive,
        });
      }
    },
  };
}
