import { z } from 'zod';

import type { EnrichedService } from '@/domain/types';

export const ServiceLinkKindSchema = z.enum([
  'primary',
  'organization_home',
  'service_page',
  'apply',
  'eligibility',
  'contact',
  'hours',
  'intake_form',
  'pdf',
  'other',
]);
export type ServiceLinkKind = z.infer<typeof ServiceLinkKindSchema>;

export const ServiceLinkConstraintsSchema = z
  .object({
    /** If present, link is only relevant for these intent categories. */
    intentCategories: z.array(z.string().min(1)).optional(),
    /** If present, link is only relevant for these action intents (apply/contact/etc). */
    intentActions: z.array(z.string().min(1)).optional(),
    /** If present, link is only relevant for these audience tags (self-identified). */
    audienceTags: z.array(z.string().min(1)).optional(),
    /** If present, link is only relevant for these locales. */
    locales: z.array(z.string().min(2)).optional(),
  })
  .strict();
export type ServiceLinkConstraints = z.infer<typeof ServiceLinkConstraintsSchema>;

export const ServiceLinkSchema = z
  .object({
    url: z.string().url(),
    label: z.string().min(1),
    kind: ServiceLinkKindSchema,

    /** UI hint: the link most relevant to this user's question/context. */
    isPrimary: z.boolean().optional(),

    /** Optional relevance constraints used for deterministic selection/ranking. */
    constraints: ServiceLinkConstraintsSchema.optional(),

    /** Optional provenance: only set when the link is derived from verified evidence. */
    evidenceId: z.string().min(1).optional(),
    lastVerifiedAt: z.string().datetime().optional(),
  })
  .strict();
export type ServiceLink = z.infer<typeof ServiceLinkSchema>;

export interface LinkSelectionContext {
  intentCategory: string;
  /** Optional action intent used to prefer deep links (apply/contact/eligibility/hours). */
  intentAction?: string;
  locale: string;
  /** Self-identified tags; must be optional + consented when persisted. */
  audienceTags?: string[];
}

function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function uniqueByUrl(links: ServiceLink[]): ServiceLink[] {
  const seen = new Set<string>();
  const out: ServiceLink[] = [];
  for (const l of links) {
    const key = l.url.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

function linkMatchesContext(link: ServiceLink, ctx: LinkSelectionContext): boolean {
  const c = link.constraints;
  if (!c) return true;

  if (c.intentCategories && c.intentCategories.length > 0) {
    if (!c.intentCategories.includes(ctx.intentCategory)) return false;
  }

  if (c.intentActions && c.intentActions.length > 0) {
    const action = ctx.intentAction ?? 'general';
    if (!c.intentActions.includes(action)) return false;
  }

  if (c.locales && c.locales.length > 0) {
    if (!c.locales.includes(ctx.locale)) return false;
  }

  if (c.audienceTags && c.audienceTags.length > 0) {
    const tags = new Set((ctx.audienceTags ?? []).map((t) => t.toLowerCase()));
    const needsAny = c.audienceTags.some((t) => tags.has(t.toLowerCase()));
    if (!needsAny) return false;
  }

  return true;
}

function linkScore(link: ServiceLink, ctx: LinkSelectionContext): number {
  // Deterministic, transparent ranking. Higher wins.
  let score = 0;

  // 'primary' is a legacy kind; we prefer using `isPrimary` as a UI hint.
  // Still keep it rank-high if a stored record uses it.
  if (link.kind === 'primary') score += 95;
  if (link.kind === 'service_page') score += 90;
  if (link.kind === 'apply') score += 80;
  if (link.kind === 'eligibility') score += 70;
  if (link.kind === 'contact') score += 60;
  if (link.kind === 'hours') score += 50;
  if (link.kind === 'organization_home') score += 40;

  if (link.constraints?.intentCategories?.includes(ctx.intentCategory)) score += 15;
  if (link.constraints?.intentActions?.includes(ctx.intentAction ?? 'general')) score += 15;
  if (link.constraints?.locales?.includes(ctx.locale)) score += 5;
  if (link.constraints?.audienceTags && (ctx.audienceTags ?? []).length > 0) score += 10;

  // Prefer deep links when the user is asking for a specific action.
  // This enables: same site → different URL depending on conversation context.
  const action = ctx.intentAction;
  if (action === 'apply') {
    if (link.kind === 'apply' || link.kind === 'intake_form') score += 40;
  } else if (action === 'contact') {
    if (link.kind === 'contact') score += 35;
  } else if (action === 'eligibility') {
    if (link.kind === 'eligibility') score += 35;
  } else if (action === 'hours') {
    if (link.kind === 'hours') score += 35;
  } else if (action === 'website') {
    if (link.kind === 'service_page' || link.kind === 'organization_home') score += 20;
  }

  return score;
}

/**
 * Selects links to present for a service card.
 *
 * Safety rules:
 * - Only returns links already stored on the service/org record (or later, verified link tables).
 * - Never invents URLs.
 */
export function selectServiceLinks(
  enriched: EnrichedService,
  ctx: LinkSelectionContext,
  verifiedLinks?: ServiceLink[]
): ServiceLink[] {
  const candidates: ServiceLink[] = [];

  const serviceUrl = enriched.service.url ? safeHttpUrl(enriched.service.url) : null;
  const orgUrl = enriched.organization.url ? safeHttpUrl(enriched.organization.url) : null;

  if (serviceUrl) {
    candidates.push({
      url: serviceUrl,
      label: 'Service page',
      kind: 'service_page',
    });
  }

  if (orgUrl) {
    candidates.push({
      url: orgUrl,
      label: 'Organization website',
      kind: 'organization_home',
    });
  }

  if (verifiedLinks && verifiedLinks.length > 0) {
    for (const raw of verifiedLinks) {
      const safe = safeHttpUrl(raw.url);
      if (!safe) continue;
      candidates.push({ ...raw, url: safe });
    }
  }

  const filtered = uniqueByUrl(candidates).filter((l) => linkMatchesContext(l, ctx));

  filtered.sort((a, b) => linkScore(b, ctx) - linkScore(a, ctx));

  // Keep the list short for UI consistency.
  const top = filtered.slice(0, 3);
  if (top.length === 0) return top;

  return top.map((l, idx) => (idx === 0 ? { ...l, isPrimary: true } : l));
}
