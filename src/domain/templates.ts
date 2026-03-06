/**
 * Domain types and constants for the Content Templates Library (§2).
 *
 * Templates are role-scoped knowledge artifacts:
 *   - shared       — visible to all authenticated portal users
 *   - host_admin   — org-portal users only
 *   - community_admin — community admin portal only
 *   - oran_admin   — platform admin only
 *
 * Role visibility is additive (oran_admin can see everything).
 */

// ============================================================
// ENUMS AS CONST OBJECTS (matches existing domain convention)
// ============================================================

export const TEMPLATE_ROLE_SCOPES = [
  'shared',
  'host_admin',
  'community_admin',
  'oran_admin',
] as const;

export type TemplateRoleScope = (typeof TEMPLATE_ROLE_SCOPES)[number];

export const TEMPLATE_CATEGORIES = [
  'faq',
  'outreach',
  'verification_script',
  'policy',
  'training',
  'onboarding',
  'dispute_handling',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export const TEMPLATE_USAGE_ACTIONS = ['view', 'copy', 'use'] as const;

export type TemplateUsageAction = (typeof TEMPLATE_USAGE_ACTIONS)[number];

// ============================================================
// VISIBILITY MAP
// Role → which scopes that role can view (own + shared + lower)
// ============================================================

export const TEMPLATE_VISIBLE_SCOPES: Record<
  'host_admin' | 'community_admin' | 'oran_admin',
  TemplateRoleScope[]
> = {
  host_admin:       ['shared', 'host_admin'],
  community_admin:  ['shared', 'host_admin', 'community_admin'],
  oran_admin:       ['shared', 'host_admin', 'community_admin', 'oran_admin'],
};

// ============================================================
// DB ROW TYPES
// ============================================================

export interface ContentTemplate {
  id:                string;
  title:             string;
  slug:              string;
  role_scope:        TemplateRoleScope;
  category:          TemplateCategory;
  content_markdown:  string;
  tags:              string[];
  language:          string;
  jurisdiction_scope: string | null;
  version:           number;
  is_published:      boolean;
  created_by:        string | null;
  updated_by:        string | null;
  created_at:        string;
  updated_at:        string;
}

export interface TemplateUsageEvent {
  id:          string;
  template_id: string;
  action:      TemplateUsageAction;
  actor_role:  string;
  recorded_at: string;
}
