/**
 * Drizzle ORM implementation of CandidateStore.
 *
 * Handles persistence of extracted candidates awaiting review.
 */
import { eq, desc, and, lt, isNull, or, sql } from 'drizzle-orm';
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

type CandidateRowWithLineage = ExtractedCandidateRow & {
  revisionOfCandidateId?: string | null;
  lineageRootCandidateId?: string | null;
  revisionNumber?: number | null;
};

interface CandidateLineageIdentityRow {
  candidate_id: string;
  extract_key_sha256: string;
  revision_of_candidate_id: string | null;
  lineage_root_candidate_id: string;
  revision_number: number;
  matched_exact_extract_key?: boolean;
  matched_canonical_url?: boolean;
  matched_address?: boolean;
  matched_name?: boolean;
}

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

async function hasCandidateLineageColumns(db: NodePgDatabase<DbSchema>): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT count(*) = 3 AS available
      FROM pg_catalog.pg_attribute
      WHERE attrelid = pg_catalog.to_regclass('public.extracted_candidates')
        AND attname = ANY(ARRAY[
          'revision_of_candidate_id',
          'lineage_root_candidate_id',
          'revision_number'
        ]::name[])
        AND NOT attisdropped
    `);
    return Boolean(resultRows<{ available: boolean }>(result)[0]?.available);
  } catch {
    return false;
  }
}

async function canExecuteDatabaseFunction(
  db: NodePgDatabase<DbSchema>,
  signature: string,
): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT CASE
        WHEN pg_catalog.to_regprocedure(${signature}) IS NULL THEN false
        ELSE pg_catalog.has_function_privilege(
          current_user,
          pg_catalog.to_regprocedure(${signature}),
          'EXECUTE'
        )
      END AS available
    `);
    return Boolean(resultRows<{ available: boolean }>(result)[0]?.available);
  } catch {
    return false;
  }
}

async function insertCandidateWithLineage(
  db: NodePgDatabase<DbSchema>,
  row: NewExtractedCandidateRow,
  lineage: {
    revisionOfCandidateId?: string;
    lineageRootCandidateId: string;
    revisionNumber: number;
  },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO public.extracted_candidates (
      candidate_id, extraction_id, extract_key_sha256, extracted_at,
      revision_of_candidate_id, lineage_root_candidate_id, revision_number,
      organization_name, service_name, description, website_url, phone, phones,
      address_line1, address_line2, address_city, address_region,
      address_postal_code, address_country, is_remote_service,
      review_status, assigned_to_role, assigned_to_user_id, assigned_at,
      jurisdiction_state, jurisdiction_county, jurisdiction_city, jurisdiction_kind,
      review_by, last_verified_at, reverify_at, verification_checklist,
      investigation_pack, primary_evidence_id, provenance_records,
      job_id, correlation_id
    ) VALUES (
      ${row.candidateId}, ${row.extractionId}, ${row.extractKeySha256}, ${row.extractedAt},
      ${lineage.revisionOfCandidateId ?? null}, ${lineage.lineageRootCandidateId}, ${lineage.revisionNumber},
      ${row.organizationName}, ${row.serviceName}, ${row.description ?? null},
      ${row.websiteUrl ?? null}, ${row.phone ?? null}, ${JSON.stringify(row.phones ?? [])}::jsonb,
      ${row.addressLine1 ?? null}, ${row.addressLine2 ?? null}, ${row.addressCity ?? null},
      ${row.addressRegion ?? null}, ${row.addressPostalCode ?? null},
      ${row.addressCountry ?? 'US'}, ${row.isRemoteService ?? false},
      ${row.reviewStatus ?? 'pending'}, ${row.assignedToRole ?? null},
      ${row.assignedToUserId ?? null}, ${row.assignedAt ?? null},
      ${row.jurisdictionState ?? null}, ${row.jurisdictionCounty ?? null},
      ${row.jurisdictionCity ?? null}, ${row.jurisdictionKind ?? null},
      ${row.reviewBy ?? null}, ${row.lastVerifiedAt ?? null}, ${row.reverifyAt ?? null},
      ${JSON.stringify(row.verificationChecklist ?? {})}::jsonb,
      ${JSON.stringify(row.investigationPack ?? {})}::jsonb,
      ${row.primaryEvidenceId ?? null}, ${JSON.stringify(row.provenanceRecords ?? {})}::jsonb,
      ${row.jobId ?? null}, ${row.correlationId}
    )
  `);
}

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
function rowToCandidate(row: CandidateRowWithLineage): ExtractedCandidate {
  return {
    extractionId: row.extractionId,
    candidateId: row.candidateId,
    extractKeySha256: row.extractKeySha256 as `${string}`,
    extractedAt: row.extractedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    revisionOfCandidateId: row.revisionOfCandidateId ?? undefined,
    lineageRootCandidateId: row.lineageRootCandidateId ?? undefined,
    revisionNumber: row.revisionNumber ?? undefined,
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

      if (await hasCandidateLineageColumns(db)) {
        await insertCandidateWithLineage(db, row, {
          revisionOfCandidateId: candidate.revisionOfCandidateId,
          lineageRootCandidateId: candidate.lineageRootCandidateId ?? candidate.candidateId,
          revisionNumber: candidate.revisionNumber ?? 1,
        });
      } else {
        if (candidate.revisionOfCandidateId) {
          throw new Error('Candidate revision lineage is not provisioned yet');
        }
        await db.insert(extractedCandidates).values(row);
      }

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
        .orderBy(
          desc(extractedCandidates.extractedAt),
          desc(extractedCandidates.createdAt),
          desc(extractedCandidates.candidateId),
        )
        .limit(1);

      return rows.length > 0 ? rowToCandidate(rows[0]) : null;
    },

    async findByNormalizedName(orgName, serviceName) {
      const normalizedOrgName = orgName.trim().toLowerCase();
      const normalizedServiceName = serviceName.trim().toLowerCase();

      if (!normalizedOrgName || !normalizedServiceName) {
        return null;
      }

      const rows = await db
        .select()
        .from(extractedCandidates)
        .where(
          and(
            sql`lower(trim(${extractedCandidates.organizationName})) = ${normalizedOrgName}`,
            sql`lower(trim(${extractedCandidates.serviceName})) = ${normalizedServiceName}`,
          ),
        )
        .orderBy(
          desc(extractedCandidates.extractedAt),
          desc(extractedCandidates.createdAt),
          desc(extractedCandidates.candidateId),
        )
        .limit(1);

      return rows.length > 0 ? rowToCandidate(rows[0]) : null;
    },

    async lockMaterializationTarget(input) {
      const normalizedOrgName = input.orgName.trim().toLowerCase();
      const normalizedServiceName = input.serviceName.trim().toLowerCase();
      const canonicalUrl = input.canonicalUrl?.trim() || null;
      const normalizedAddress = input.address
        ? {
            line1: input.address.line1.trim().toLowerCase(),
            city: input.address.city.trim().toLowerCase(),
            region: input.address.region.trim().toLowerCase(),
            postalCode: input.address.postalCode.trim().toLowerCase(),
            country: input.address.country.trim().toLowerCase(),
          }
        : null;
      const lineageLockKeys = [
        canonicalUrl ? `canonical:${canonicalUrl.trim().toLowerCase()}` : null,
        normalizedAddress
          ? `address:${[
              normalizedAddress.line1,
              normalizedAddress.city,
              normalizedAddress.region,
              normalizedAddress.postalCode,
              normalizedAddress.country,
            ].join('\u0000')}`
          : null,
        `extract:${input.extractKey.toLowerCase()}`,
        `name:${normalizedOrgName}\u0000${normalizedServiceName}`,
      ].filter((key): key is string => Boolean(key)).sort();

      // A query planner need not evaluate a set-returning lock expression in
      // presentation order. Take each already-sorted identity lock in its own
      // statement so every transaction has one deterministic global order.
      for (const lineageLockKey of lineageLockKeys) {
        await db.execute(sql`
          SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
            ${`oran:candidate-lineage:${lineageLockKey}`},
            0
          ))
        `);
      }

      const lineageAvailable = await hasCandidateLineageColumns(db);
      if (lineageAvailable) {
        // First resolve any matching revision to its stable lineage root. The
        // matching row may be historical: later revisions can legitimately
        // correct the URL, address, or display names used by this lookup.
        // URLs can be shared directory pages and addresses can host multiple
        // services, so neither may establish lineage without the same
        // normalized organization/service identity. Only an exact extract key
        // is strong enough to replay across corrected identity fields.
        const lineageMatchResult = await db.execute(sql`
          SELECT DISTINCT ON (COALESCE(lineage_root_candidate_id, candidate_id))
                 candidate_id,
                 extract_key_sha256,
                 revision_of_candidate_id,
                 COALESCE(lineage_root_candidate_id, candidate_id) AS lineage_root_candidate_id,
                 COALESCE(revision_number, 1) AS revision_number,
                 extract_key_sha256 = ${input.extractKey} AS matched_exact_extract_key,
                 (${canonicalUrl}::text IS NOT NULL
                   AND investigation_pack ->> 'canonicalUrl' = ${canonicalUrl}
                   AND lower(trim(organization_name)) = ${normalizedOrgName}
                   AND lower(trim(service_name)) = ${normalizedServiceName}) AS matched_canonical_url,
                 (${normalizedAddress?.line1 ?? null}::text IS NOT NULL
                   AND lower(trim(organization_name)) = ${normalizedOrgName}
                   AND lower(trim(service_name)) = ${normalizedServiceName}
                   AND lower(trim(coalesce(address_line1, ''))) = ${normalizedAddress?.line1 ?? null}
                   AND lower(trim(coalesce(address_city, ''))) = ${normalizedAddress?.city ?? null}
                   AND lower(trim(coalesce(address_region, ''))) = ${normalizedAddress?.region ?? null}
                   AND lower(trim(coalesce(address_postal_code, ''))) = ${normalizedAddress?.postalCode ?? null}
                   AND lower(trim(coalesce(address_country, 'US'))) = ${normalizedAddress?.country ?? null}) AS matched_address,
                 (lower(trim(organization_name)) = ${normalizedOrgName}
                   AND lower(trim(service_name)) = ${normalizedServiceName}) AS matched_name
          FROM public.extracted_candidates
          WHERE extract_key_sha256 = ${input.extractKey}
             OR (
               ${canonicalUrl}::text IS NOT NULL
               AND investigation_pack ->> 'canonicalUrl' = ${canonicalUrl}
               AND lower(trim(organization_name)) = ${normalizedOrgName}
               AND lower(trim(service_name)) = ${normalizedServiceName}
             )
             OR (
               ${normalizedAddress?.line1 ?? null}::text IS NOT NULL
               AND lower(trim(organization_name)) = ${normalizedOrgName}
               AND lower(trim(service_name)) = ${normalizedServiceName}
               AND lower(trim(coalesce(address_line1, ''))) = ${normalizedAddress?.line1 ?? null}
               AND lower(trim(coalesce(address_city, ''))) = ${normalizedAddress?.city ?? null}
               AND lower(trim(coalesce(address_region, ''))) = ${normalizedAddress?.region ?? null}
               AND lower(trim(coalesce(address_postal_code, ''))) = ${normalizedAddress?.postalCode ?? null}
               AND lower(trim(coalesce(address_country, 'US'))) = ${normalizedAddress?.country ?? null}
             )
             OR (
               lower(trim(organization_name)) = ${normalizedOrgName}
               AND lower(trim(service_name)) = ${normalizedServiceName}
             )
          ORDER BY COALESCE(lineage_root_candidate_id, candidate_id),
                   CASE
                     WHEN extract_key_sha256 = ${input.extractKey} THEN 0
                     WHEN ${canonicalUrl}::text IS NOT NULL
                       AND investigation_pack ->> 'canonicalUrl' = ${canonicalUrl}
                       AND lower(trim(organization_name)) = ${normalizedOrgName}
                       AND lower(trim(service_name)) = ${normalizedServiceName}
                       THEN 1
                     WHEN ${normalizedAddress?.line1 ?? null}::text IS NOT NULL
                       AND lower(trim(organization_name)) = ${normalizedOrgName}
                       AND lower(trim(service_name)) = ${normalizedServiceName}
                       AND lower(trim(coalesce(address_line1, ''))) = ${normalizedAddress?.line1 ?? null}
                       AND lower(trim(coalesce(address_city, ''))) = ${normalizedAddress?.city ?? null}
                       AND lower(trim(coalesce(address_region, ''))) = ${normalizedAddress?.region ?? null}
                       AND lower(trim(coalesce(address_postal_code, ''))) = ${normalizedAddress?.postalCode ?? null}
                       AND lower(trim(coalesce(address_country, 'US'))) = ${normalizedAddress?.country ?? null}
                       THEN 2
                     WHEN lower(trim(organization_name)) = ${normalizedOrgName}
                       AND lower(trim(service_name)) = ${normalizedServiceName}
                       THEN 3
                     ELSE 4
                   END,
                   revision_number DESC,
                   extracted_at DESC,
                   created_at DESC,
                   candidate_id DESC
        `);
        const lineageMatches = resultRows<CandidateLineageIdentityRow>(lineageMatchResult);
        const selectUniqueMatch = (
          kind: string,
          matches: CandidateLineageIdentityRow[],
        ): CandidateLineageIdentityRow | null => {
          const roots = new Set(matches.map((match) => match.lineage_root_candidate_id));
          if (roots.size > 1) {
            throw new Error(`Ambiguous candidate lineage ${kind} identity`);
          }
          return matches[0] ?? null;
        };
        const exactMatches = lineageMatches.filter((match) => (
          match.matched_exact_extract_key ?? match.extract_key_sha256 === input.extractKey
        ));
        const canonicalMatches = lineageMatches.filter((match) => match.matched_canonical_url);
        const addressMatches = lineageMatches.filter((match) => match.matched_address);
        const nameMatches = lineageMatches.filter((match) => match.matched_name);
        const lineageMatch = selectUniqueMatch('extract-key', exactMatches)
          ?? selectUniqueMatch('canonical-url', canonicalMatches)
          ?? selectUniqueMatch('address', addressMatches)
          ?? selectUniqueMatch('name', nameMatches)
          ?? null;
        if (!lineageMatch) return null;
        const matchedExactExtractKey = lineageMatch.extract_key_sha256 === input.extractKey;

        // Every ingestion identity for this lineage converges on this lock,
        // even when the incoming data only matches an older revision. Once it
        // is held, re-read and row-lock the actual lineage head.
        await db.execute(sql`
          SELECT pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(
              ${`oran:candidate-lineage-root:${lineageMatch.lineage_root_candidate_id}`},
              0
            )
          )
        `);

        const lineageHeadResult = await db.execute(sql`
          SELECT candidate_id,
                 extract_key_sha256,
                 revision_of_candidate_id,
                 COALESCE(lineage_root_candidate_id, candidate_id) AS lineage_root_candidate_id,
                 COALESCE(revision_number, 1) AS revision_number
          FROM public.extracted_candidates
          WHERE COALESCE(lineage_root_candidate_id, candidate_id) = ${lineageMatch.lineage_root_candidate_id}
          ORDER BY revision_number DESC NULLS LAST,
                   extracted_at DESC,
                   created_at DESC,
                   candidate_id DESC
          LIMIT 1
          FOR UPDATE
        `);
        const lineageHead = resultRows<CandidateLineageIdentityRow>(lineageHeadResult)[0];
        if (!lineageHead) return null;

        const rows = await db
          .select()
          .from(extractedCandidates)
          .where(eq(extractedCandidates.candidateId, lineageHead.candidate_id))
          .limit(1);
        const row = rows[0];
        if (!row) return null;

        return {
          candidate: rowToCandidate({
            ...row,
            revisionOfCandidateId: lineageHead.revision_of_candidate_id,
            lineageRootCandidateId: lineageHead.lineage_root_candidate_id,
            revisionNumber: lineageHead.revision_number,
          }),
          historicalExtractReplay: matchedExactExtractKey
            && lineageHead.extract_key_sha256 !== input.extractKey,
          exactExtractKey: lineageHead.extract_key_sha256 === input.extractKey,
          lineageAvailable: true,
        };
      }

      const identityConditions = [
        eq(extractedCandidates.extractKeySha256, input.extractKey),
      ];
      if (canonicalUrl) {
        identityConditions.push(
          and(
            sql`${extractedCandidates.investigationPack} ->> 'canonicalUrl' = ${canonicalUrl}`,
            sql`lower(trim(${extractedCandidates.organizationName})) = ${normalizedOrgName}`,
            sql`lower(trim(${extractedCandidates.serviceName})) = ${normalizedServiceName}`,
          )!,
        );
      }
      if (normalizedAddress) {
        const addressIdentity = and(
          sql`lower(trim(${extractedCandidates.organizationName})) = ${normalizedOrgName}`,
          sql`lower(trim(${extractedCandidates.serviceName})) = ${normalizedServiceName}`,
          sql`lower(trim(coalesce(${extractedCandidates.addressLine1}, ''))) = ${normalizedAddress.line1}`,
          sql`lower(trim(coalesce(${extractedCandidates.addressCity}, ''))) = ${normalizedAddress.city}`,
          sql`lower(trim(coalesce(${extractedCandidates.addressRegion}, ''))) = ${normalizedAddress.region}`,
          sql`lower(trim(coalesce(${extractedCandidates.addressPostalCode}, ''))) = ${normalizedAddress.postalCode}`,
          sql`lower(trim(coalesce(${extractedCandidates.addressCountry}, 'US'))) = ${normalizedAddress.country}`,
        );
        if (addressIdentity) identityConditions.push(addressIdentity);
      }
      const nameIdentity = and(
        sql`lower(trim(${extractedCandidates.organizationName})) = ${normalizedOrgName}`,
        sql`lower(trim(${extractedCandidates.serviceName})) = ${normalizedServiceName}`,
      );
      if (nameIdentity) identityConditions.push(nameIdentity);

      const rows = await db
        .select()
        .from(extractedCandidates)
        .where(or(...identityConditions))
        .orderBy(
          sql`CASE
                WHEN ${extractedCandidates.extractKeySha256} = ${input.extractKey} THEN 0
                WHEN ${canonicalUrl}::text IS NOT NULL
                  AND ${extractedCandidates.investigationPack} ->> 'canonicalUrl' = ${canonicalUrl}
                  AND lower(trim(${extractedCandidates.organizationName})) = ${normalizedOrgName}
                  AND lower(trim(${extractedCandidates.serviceName})) = ${normalizedServiceName}
                  THEN 1
                WHEN lower(trim(${extractedCandidates.organizationName})) = ${normalizedOrgName}
                  AND lower(trim(${extractedCandidates.serviceName})) = ${normalizedServiceName}
                  THEN 2
                ELSE 3
              END`,
          desc(extractedCandidates.extractedAt),
          desc(extractedCandidates.createdAt),
          desc(extractedCandidates.candidateId),
        )
        .limit(1)
        .for('update');

      const row = rows[0];
      return row
        ? {
          candidate: rowToCandidate(row),
          historicalExtractReplay: false,
          exactExtractKey: row.extractKeySha256 === input.extractKey,
          lineageAvailable: false,
        }
        : null;
    },

    async update(candidateId, updates) {
      const updateData: Partial<NewExtractedCandidateRow> = {};

      if (updates.fields) {
        if (updates.fields.organizationName) updateData.organizationName = updates.fields.organizationName;
        if (updates.fields.serviceName) updateData.serviceName = updates.fields.serviceName;
        if (updates.fields.description !== undefined) updateData.description = updates.fields.description;
        updateData.websiteUrl = updates.fields.websiteUrl ?? null;
        updateData.phone = updates.fields.phone ?? null;
        updateData.phones = updates.fields.phones ?? [];
        if (updates.fields.address) {
          updateData.addressLine1 = updates.fields.address.line1;
          updateData.addressLine2 = updates.fields.address.line2;
          updateData.addressCity = updates.fields.address.city;
          updateData.addressRegion = updates.fields.address.region;
          updateData.addressPostalCode = updates.fields.address.postalCode;
          updateData.addressCountry = updates.fields.address.country;
        } else {
          updateData.addressLine1 = null;
          updateData.addressLine2 = null;
          updateData.addressCity = null;
          updateData.addressRegion = null;
          updateData.addressPostalCode = null;
          updateData.addressCountry = null;
        }
        updateData.isRemoteService = updates.fields.isRemoteService ?? false;
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

    async escalateForReview(candidateId) {
      if (
        await canExecuteDatabaseFunction(
          db,
          'oran_internal.escalate_candidate_for_review(text)',
        )
      ) {
        await db.execute(
          sql`SELECT oran_internal.escalate_candidate_for_review(${candidateId})`,
        );
        return;
      }

      // During the additive migration window the stricter transition function
      // exists but is not executable yet. Preserve the legacy pending-to-
      // escalated behavior until 0078 grants the guarded function.
      await db
        .update(extractedCandidates)
        .set({
          reviewStatus: 'escalated',
          assignedToRole: 'oran_admin',
          assignedToUserId: null,
          assignedAt: null,
        })
        .where(
          and(
            eq(extractedCandidates.candidateId, candidateId),
            eq(extractedCandidates.reviewStatus, 'pending'),
          ),
        );
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
