/**
 * GET    /api/admin/ingestion/source-systems/[id]
 * PUT    /api/admin/ingestion/source-systems/[id]
 * DELETE /api/admin/ingestion/source-systems/[id]
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { SourceResourcePurposeSchema } from '@/agents/ingestion/sourcePurpose';

import { isDatabaseConfigured } from '@/services/db/postgres';
import { checkRateLimitShared } from '@/services/security/rateLimit';
import { captureException } from '@/services/telemetry/sentry';
import { getAuthContext } from '@/services/auth/session';
import { requireMinRole } from '@/services/auth/guards';
import {
	RATE_LIMIT_WINDOW_MS,
	ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS,
	ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS,
} from '@/domain/constants';
import { getIp } from '@/services/security/ip';
import {
	queueIngestionControlChange,
} from '@/services/ingestion/controlChanges';

const JurisdictionScopeSchema = z.object({
	kind: z.enum(['local', 'regional', 'statewide', 'national', 'virtual']).optional(),
	country: z.string().min(2).max(2).optional(),
	stateProvince: z.string().min(1).optional(),
	countyOrRegion: z.string().min(1).optional(),
	city: z.string().min(1).optional(),
	postalCode: z.string().min(1).optional(),
}).strict();

const DomainRuleSchema = z.object({
	type: z.enum(['exact_host', 'suffix']),
	value: z.string().min(1),
}).strict();

const ContactInfoSchema = z.object({
	email: z.string().email().optional(),
	name: z.string().min(1).optional(),
	team: z.string().min(1).optional(),
}).strict();

const UpdateSourceSystemSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	family: z.enum([
		'hsds_api',
		'hsds_tabular',
		'partner_api',
		'partner_export',
		'government_open_data',
		'allowlisted_scrape',
		'manual',
	]).optional(),
	trustTier: z.enum([
		'verified_publisher',
		'trusted_partner',
		'curated',
		'community',
		'quarantine',
		'blocked',
	]).optional(),
	resourcePurpose: SourceResourcePurposeSchema.optional(),
	homepageUrl: z.string().url().nullable().optional(),
	licenseNotes: z.string().max(4000).nullable().optional(),
	termsUrl: z.string().url().nullable().optional(),
	hsdsProfileUri: z.string().url().nullable().optional(),
	notes: z.string().max(4000).nullable().optional(),
	domainRules: z.array(DomainRuleSchema).optional(),
	jurisdictionScope: JurisdictionScopeSchema.optional(),
	contactInfo: ContactInfoSchema.optional(),
	isActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
	message: 'At least one source-system field is required.',
});
async function requireAdmin(req: NextRequest, operation: 'read' | 'write') {
	if (!isDatabaseConfigured()) {
		return NextResponse.json({ error: 'Database not configured.' }, { status: 503 });
	}

	const maxRequests = operation === 'read'
		? ORAN_ADMIN_READ_RATE_LIMIT_MAX_REQUESTS
		: ORAN_ADMIN_WRITE_RATE_LIMIT_MAX_REQUESTS;
	const rl = await checkRateLimitShared(
		`admin:ingestion:source-systems:${operation}:${getIp(req)}`,
		{ maxRequests, windowMs: RATE_LIMIT_WINDOW_MS },
	);
  if (rl.backendUnavailable) {
    return NextResponse.json(
      { error: 'Rate limit service unavailable. Please try again later.' },
      { status: 503, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    );
  }
  if (rl.exceeded === true) {
		return NextResponse.json(
			{ error: 'Rate limit exceeded.' },
			{ status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
		);
	}

	const session = await getAuthContext();
	if (!session) {
		return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
	}
	if (!requireMinRole(session, 'oran_admin')) {
		return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
	}

	return null;
}

async function loadStores() {
	const { createIngestionStores } = await import('@/agents/ingestion/persistence/storeFactory');
	const { getDrizzle } = await import('@/services/db/drizzle');
	return createIngestionStores(getDrizzle());
}

export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const guard = await requireAdmin(req, 'read');
	if (guard) return guard;

	try {
		const { id } = await params;
		const stores = await loadStores();
		const sourceSystem = await stores.sourceSystems.getById(id);
		if (!sourceSystem) {
			return NextResponse.json({ error: 'Source system not found.' }, { status: 404 });
		}

		const feeds = await stores.sourceFeeds.listBySystem(id);
		return NextResponse.json({ sourceSystem: { ...sourceSystem, feeds } });
	} catch (error) {
		captureException(error instanceof Error ? error : new Error(String(error)));
		return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
	}
}

export async function PUT(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const guard = await requireAdmin(req, 'write');
	if (guard) return guard;

	try {
		const session = await getAuthContext();
		const { id } = await params;
		const body = await req.json();
		const parsed = UpdateSourceSystemSchema.safeParse(body);
		if (!parsed.success) {
			return NextResponse.json(
				{ error: 'Invalid input.', details: parsed.error.flatten() },
				{ status: 400 },
			);
		}

		const stores = await loadStores();
		const existing = await stores.sourceSystems.getById(id);
		if (!existing) {
			return NextResponse.json({ error: 'Source system not found.' }, { status: 404 });
		}

		const { submissionId } = await queueIngestionControlChange({
				submittedByUserId: session?.userId ?? 'unknown',
				actorRole: session?.role ?? 'oran_admin',
				targetId: id,
				title: `Source system authority change queued: ${existing.name}`,
				summary: `Trust or resource-purpose changes for source system ${existing.name} require second approval before publication authority changes.`,
				payload: {
					entityType: 'source_system',
					action: 'update',
					entityId: id,
					entityLabel: existing.name,
					summary: `Trust ${existing.trustTier ?? 'unknown'} -> ${parsed.data.trustTier ?? existing.trustTier ?? 'unknown'}; purpose ${existing.resourcePurpose ?? 'unclassified'} -> ${parsed.data.resourcePurpose ?? existing.resourcePurpose ?? 'unclassified'}`,
					beforeState: existing as Record<string, unknown>,
					patch: parsed.data,
				},
			});

		return NextResponse.json(
			{ queued: true, submissionId, status: 'pending_second_approval' },
			{ status: 202 },
		);
	} catch (error) {
		captureException(error instanceof Error ? error : new Error(String(error)));
		return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
	}
}

export async function DELETE(
	req: NextRequest,
	{ params }: { params: Promise<{ id: string }> }
) {
	const guard = await requireAdmin(req, 'write');
	if (guard) return guard;

	try {
		const session = await getAuthContext();
		const { id } = await params;
		const stores = await loadStores();
		const existing = await stores.sourceSystems.getById(id);
		if (!existing) {
			return NextResponse.json({ error: 'Source system not found.' }, { status: 404 });
		}

		const { submissionId } = await queueIngestionControlChange({
			submittedByUserId: session?.userId ?? 'unknown',
			actorRole: session?.role ?? 'oran_admin',
			targetId: id,
			title: `Source system deactivation queued: ${existing.name}`,
			summary: `Deactivating source system ${existing.name} requires second approval because it can remove a structured ingestion lane.`,
			payload: {
				entityType: 'source_system',
				action: 'deactivate',
				entityId: id,
				entityLabel: existing.name,
				summary: `Deactivate source system ${existing.name}`,
				beforeState: existing as Record<string, unknown>,
			},
		});

		return NextResponse.json(
			{ queued: true, submissionId, status: 'pending_second_approval' },
			{ status: 202 },
		);
	} catch (error) {
		captureException(error instanceof Error ? error : new Error(String(error)));
		return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
	}
}
