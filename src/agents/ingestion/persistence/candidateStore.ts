/**
 * Drizzle ORM implementation of CandidateStore.
 *
 * Handles persistence of extracted candidates awaiting review.
 */
import { eq, desc, and, lt, isNull, or } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import type { ExtractedCandidate, ReviewStatus } from '../contracts';
import type { CandidateStore } from '../stores';
import {
  extractedCandidates,
  ingestionAuditEvents,
  type NewExtractedCandidateRow,
  type ExtractedCandidateRow,
} from '../../../db/schema';

type DbSchema = typeof import('../../../db/schema');

/**
 * Maps DB jurisdiction kind to contract kind.
 */
function mapJurisdictionKind(
  dbKind: string | null
): 'local' | 'regional' | 'statewide' | 'national' | 'virtual' {
  switch (dbKind) {
    case 'county':
      return 'regional';
    case 'municipal':
      return 'local';
    case 'state':
      return 'statewide';
    case 'federal':
      return 'national';
    default:
      return 'local';
  }
}

/**
 * Maps contract jurisdiction kind to DB kind.
 */
function mapJurisdictionKindToDb(
  contractKind: string | undefined
): string {
  switch (contractKind) {
    case 'regional':
      return 'county';
    case 'local':
      return 'municipal';
    case 'statewide':
      return 'state';
    case 'national':
      return 'federal';
    case 'virtual':
      return 'municipal'; // virtual services default to municipal
    default:
      return 'municipal';
  }
}

/**
 * Maps a database row to an ExtractedCandidate domain object.
 */
function rowToCandidate(row: ExtractedCandidateRow): ExtractedCandidate {
  return {
    extractionId: row.extractionId,
    candidateId: row.candidateId,
    extractKeySha256: row.extractKeySha256 as `${string}`,
    extractedAt: row.extractedAt.toISOString(),
    review: {
      status: row.reviewStatus as ReviewStatus,
      jurisdiction: row.jurisdictionState
        ? {
            country: 'US',
            stateProvince: row.jurisdictionState,
            countyOrRegion: row.jurisdictionCounty ?? undefined,
            city: row.jurisdictionCity ?? undefined,
            kind: mapJurisdictionKind(row.jurisdictionKind),
          }
        : undefined,
      timers: {
        reviewBy: row.reviewBy?.toISOString(),
        lastVerifiedAt: row.lastVerifiedAt?.toISOString(),
        reverifyAt: row.reverifyAt?.toISOString(),
      },
      assignedToRole: row.assignedToRole as 'community_admin' | 'oran_admin' | undefined,
      assignedToKey: row.assignedToUserId ?? undefined,
      tags: [], // Tags are stored separately
      checklist: row.verificationChecklist as ExtractedCandidate['review']['checklist'],
    },
    fields: {
      organizationName: row.organizationName,
      serviceName: row.serviceName,
      description: row.description ?? '',
      websiteUrl: row.websiteUrl ?? undefined,
      phone: row.phone ?? undefined,
      phones: (row.phones as ExtractedCandidate['fields']['phones']) ?? [],
      address: row.addressLine1
        ? {
            line1: row.addressLine1,
            line2: row.addressLine2 ?? undefined,
            city: row.addressCity ?? '',
            region: row.addressRegion ?? '',
            postalCode: row.addressPostalCode ?? '',
            country: row.addressCountry ?? 'US',
          }
        : undefined,
      isRemoteService: row.isRemoteService ?? false,
    },
    investigation: row.investigationPack as ExtractedCandidate['investigation'],
    provenance: row.provenanceRecords as ExtractedCandidate['provenance'],
  };
}

/**
 * Creates a CandidateStore backed by PostgreSQL via Drizzle ORM.
 */
export function createDrizzleCandidateStore(
  db: NodePgDatabase<DbSchema>
): CandidateStore {
  return {
    async create(candidate) {
      const row: NewExtractedCandidateRow = {
        candidateId: candidate.candidateId,
        extractionId: candidate.extractionId,
        extractKeySha256: candidate.extractKeySha256,
        extractedAt: new Date(candidate.extractedAt),
        organizationName: candidate.fields.organizationName,
        serviceName: candidate.fields.serviceName,
        description: candidate.fields.description,
        websiteUrl: candidate.fields.websiteUrl,
        phone: candidate.fields.phone,
        phones: candidate.fields.phones ?? [],
        addressLine1: candidate.fields.address?.line1,
        addressLine2: candidate.fields.address?.line2,
        addressCity: candidate.fields.address?.city,
        addressRegion: candidate.fields.address?.region,
        addressPostalCode: candidate.fields.address?.postalCode,
        addressCountry: candidate.fields.address?.country ?? 'US',
        isRemoteService: candidate.fields.isRemoteService ?? false,
        reviewStatus: candidate.review?.status ?? 'pending',
        assignedToRole: candidate.review?.assignedToRole,
        assignedToUserId: candidate.review?.assignedToKey,
        assignedAt:
          candidate.review?.assignedToRole || candidate.review?.assignedToKey
            ? new Date()
            : undefined,
        jurisdictionState: candidate.jurisdictionState,
        jurisdictionCounty: candidate.jurisdictionCounty,
        jurisdictionCity: candidate.jurisdictionCity,
        jurisdictionKind: candidate.jurisdictionKind,
        reviewBy: candidate.review?.timers?.reviewBy
          ? new Date(candidate.review.timers.reviewBy)
          : undefined,
        lastVerifiedAt: candidate.review?.timers?.lastVerifiedAt
          ? new Date(candidate.review.timers.lastVerifiedAt)
          : undefined,
        reverifyAt: candidate.review?.timers?.reverifyAt
          ? new Date(candidate.review.timers.reverifyAt)
          : undefined,
        verificationChecklist: candidate.review?.checklist ?? {},
        investigationPack: candidate.investigation ?? {},
        provenanceRecords: candidate.provenance ?? {},
        primaryEvidenceId: candidate.primaryEvidenceId,
        correlationId: candidate.correlationId,
        jobId: candidate.jobId ? (candidate.jobId as unknown as string) : undefined,
      };

      await db.insert(extractedCandidates).values(row);

      // Log audit event
      await db.insert(ingestionAuditEvents).values({
        candidateId: candidate.candidateId,
        eventType: 'created',
        actorType: 'system',
        details: { correlationId: candidate.correlationId },
      });
    },

    async getById(candidateId) {
      const rows = await db
        .select()
        .from(extractedCandidates)
        .where(eq(extractedCandidates.candidateId, candidateId))
        .limit(1);

      return rows.length > 0 ? rowToCandidate(rows[0]) : null;
    },

    async getByExtractKey(extractKey) {
      const rows = await db
        .select()
        .from(extractedCandidates)
        .where(eq(extractedCandidates.extractKeySha256, extractKey))
        .orderBy(desc(extractedCandidates.extractedAt))
        .limit(1);

      return rows.length > 0 ? rowToCandidate(rows[0]) : null;
    },

    async update(candidateId, updates) {
      const updateData: Partial<NewExtractedCandidateRow> = {};

      if (updates.fields) {
        if (updates.fields.organizationName) updateData.organizationName = updates.fields.organizationName;
        if (updates.fields.serviceName) updateData.serviceName = updates.fields.serviceName;
        if (updates.fields.description !== undefined) updateData.description = updates.fields.description;
        if (updates.fields.websiteUrl !== undefined) updateData.websiteUrl = updates.fields.websiteUrl;
        if (updates.fields.phone !== undefined) updateData.phone = updates.fields.phone;
        if (updates.fields.phones !== undefined) updateData.phones = updates.fields.phones;
        if (updates.fields.address) {
          updateData.addressLine1 = updates.fields.address.line1;
          updateData.addressLine2 = updates.fields.address.line2;
          updateData.addressCity = updates.fields.address.city;
          updateData.addressRegion = updates.fields.address.region;
          updateData.addressPostalCode = updates.fields.address.postalCode;
          updateData.addressCountry = updates.fields.address.country;
        }
        if (updates.fields.isRemoteService !== undefined) {
          updateData.isRemoteService = updates.fields.isRemoteService;
        }
      }

      if (updates.review) {
        if (updates.review.status) updateData.reviewStatus = updates.review.status;
        if (updates.review.assignedToRole !== undefined) updateData.assignedToRole = updates.review.assignedToRole;
        if (updates.review.assignedToKey !== undefined) updateData.assignedToUserId = updates.review.assignedToKey;
        if (updates.review.checklist) {
          updateData.verificationChecklist = updates.review.checklist;
        }
        if (updates.review.timers) {
          if (updates.review.timers.reviewBy) updateData.reviewBy = new Date(updates.review.timers.reviewBy);
          if (updates.review.timers.lastVerifiedAt) updateData.lastVerifiedAt = new Date(updates.review.timers.lastVerifiedAt);
          if (updates.review.timers.reverifyAt) updateData.reverifyAt = new Date(updates.review.timers.reverifyAt);
        }
        if (updates.review.jurisdiction) {
          updateData.jurisdictionState = updates.review.jurisdiction.stateProvince;
          updateData.jurisdictionCounty = updates.review.jurisdiction.countyOrRegion;
          updateData.jurisdictionCity = updates.review.jurisdiction.city;
          updateData.jurisdictionKind = mapJurisdictionKindToDb(updates.review.jurisdiction.kind);
        }
      }

      if (updates.investigation) {
        updateData.investigationPack = updates.investigation;
      }

      if (updates.provenance) {
        updateData.provenanceRecords = updates.provenance;
      }

      if (Object.keys(updateData).length > 0) {
        await db
          .update(extractedCandidates)
          .set(updateData)
          .where(eq(extractedCandidates.candidateId, candidateId));

        // Log audit event
        await db.insert(ingestionAuditEvents).values({
          candidateId,
          eventType: 'field_edited',
          actorType: 'system',
          details: { updatedFields: Object.keys(updateData) },
        });
      }
    },

    async updateReviewStatus(candidateId, status, byUserId) {
      await db
        .update(extractedCandidates)
        .set({ reviewStatus: status })
        .where(eq(extractedCandidates.candidateId, candidateId));

      await db.insert(ingestionAuditEvents).values({
        candidateId,
        eventType: 'status_changed',
        actorType: byUserId ? 'admin' : 'system',
        actorId: byUserId,
        details: { newStatus: status },
      });
    },

    async updateConfidenceScore(candidateId, score) {
      // Tier is auto-calculated by DB trigger
      await db
        .update(extractedCandidates)
        .set({ confidenceScore: Math.round(score) })
        .where(eq(extractedCandidates.candidateId, candidateId));

      await db.insert(ingestionAuditEvents).values({
        candidateId,
        eventType: 'score_updated',
        actorType: 'system',
        details: { newScore: score },
      });
    },

    async assign(candidateId, role, userId) {
      await db
        .update(extractedCandidates)
        .set({
          assignedToRole: role,
          assignedToUserId: userId,
          assignedAt: new Date(),
          reviewStatus: 'in_review',
        })
        .where(eq(extractedCandidates.candidateId, candidateId));

      await db.insert(ingestionAuditEvents).values({
        candidateId,
        eventType: 'assigned',
        actorType: 'system',
        details: { role, userId },
      });
    },

    async list(filters, limit = 50, offset = 0) {
      const conditions: ReturnType<typeof eq>[] = [];

      if (filters.reviewStatus) {
        conditions.push(eq(extractedCandidates.reviewStatus, filters.reviewStatus));
      }
      if (filters.confidenceTier) {
        conditions.push(eq(extractedCandidates.confidenceTier, filters.confidenceTier));
      }
      if (filters.jurisdictionState) {
        conditions.push(eq(extractedCandidates.jurisdictionState, filters.jurisdictionState));
      }
      if (filters.jurisdictionCounty) {
        conditions.push(eq(extractedCandidates.jurisdictionCounty, filters.jurisdictionCounty));
      }
      if (filters.assignedToUserId) {
        conditions.push(eq(extractedCandidates.assignedToUserId, filters.assignedToUserId));
      }
      if (filters.assignedToRole) {
        conditions.push(eq(extractedCandidates.assignedToRole, filters.assignedToRole));
      }
      if (filters.reviewByBefore) {
        conditions.push(lt(extractedCandidates.reviewBy, filters.reviewByBefore));
      }
      if (filters.reverifyAtBefore) {
        conditions.push(lt(extractedCandidates.reverifyAt, filters.reverifyAtBefore));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const rows = await db
        .select()
        .from(extractedCandidates)
        .where(whereClause)
        .orderBy(desc(extractedCandidates.createdAt))
        .limit(limit)
        .offset(offset);

      return rows.map(rowToCandidate);
    },

    async listDueForReview(limit = 50) {
      const now = new Date();
      const rows = await db
        .select()
        .from(extractedCandidates)
        .where(
          and(
            eq(extractedCandidates.reviewStatus, 'pending'),
            or(
              isNull(extractedCandidates.reviewBy),
              lt(extractedCandidates.reviewBy, now)
            )
          )
        )
        .orderBy(extractedCandidates.reviewBy)
        .limit(limit);

      return rows.map(rowToCandidate);
    },

    async listDueForReverify(limit = 50) {
      const now = new Date();
      const rows = await db
        .select()
        .from(extractedCandidates)
        .where(
          and(
            eq(extractedCandidates.reviewStatus, 'published'),
            lt(extractedCandidates.reverifyAt, now)
          )
        )
        .orderBy(extractedCandidates.reverifyAt)
        .limit(limit);

      return rows.map(rowToCandidate);
    },

    async markPublished(candidateId, serviceId, byUserId) {
      await db
        .update(extractedCandidates)
        .set({
          reviewStatus: 'published',
          publishedServiceId: serviceId,
          publishedAt: new Date(),
          publishedByUserId: byUserId,
        })
        .where(eq(extractedCandidates.candidateId, candidateId));

      await db.insert(ingestionAuditEvents).values({
        candidateId,
        eventType: 'published',
        actorType: 'admin',
        actorId: byUserId,
        details: { serviceId },
      });
    },
  };
}
