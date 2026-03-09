import type {
  OranRole,
  SubmissionPriority,
  SubmissionStatus,
  SubmissionTargetType,
  SubmissionType,
} from '@/domain/types';

// ============================================================
// AUDIENCE + SCOPE CONSTANTS
// ============================================================

export const FORM_TEMPLATE_AUDIENCES = [
  'shared',
  'host_member',
  'host_admin',
  'community_admin',
  'oran_admin',
] as const;

export type FormTemplateAudience = (typeof FORM_TEMPLATE_AUDIENCES)[number];

export const FORM_STORAGE_SCOPES = [
  'platform',
  'organization',
  'community',
] as const;

export type FormStorageScope = (typeof FORM_STORAGE_SCOPES)[number];

export const FORM_RECIPIENT_ROLES = [
  'host_member',
  'host_admin',
  'community_admin',
  'oran_admin',
] as const;

export type FormRecipientRole = (typeof FORM_RECIPIENT_ROLES)[number];

export const FORM_TEMPLATE_VISIBLE_AUDIENCES: Record<
  'host_member' | 'host_admin' | 'community_admin' | 'oran_admin',
  FormTemplateAudience[]
> = {
  host_member: ['shared', 'host_member'],
  host_admin: ['shared', 'host_member', 'host_admin'],
  community_admin: ['shared', 'community_admin'],
  oran_admin: ['shared', 'host_member', 'host_admin', 'community_admin', 'oran_admin'],
};

export function getVisibleFormTemplateAudiences(role: OranRole): FormTemplateAudience[] {
  if (role === 'host_member' || role === 'host_admin' || role === 'community_admin' || role === 'oran_admin') {
    return FORM_TEMPLATE_VISIBLE_AUDIENCES[role];
  }

  return [];
}

export interface FormTemplate {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string;
  audience_scope: FormTemplateAudience;
  storage_scope: FormStorageScope;
  default_target_role: FormRecipientRole | null;
  schema_json: Record<string, unknown>;
  ui_schema_json: Record<string, unknown>;
  instructions_markdown: string | null;
  version: number;
  is_published: boolean;
  blob_storage_prefix: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FormInstance {
  id: string;
  submission_id: string;
  template_id: string;
  template_slug: string;
  template_title: string;
  template_description: string | null;
  template_category: string;
  template_audience_scope?: FormTemplateAudience;
  template_storage_scope?: FormStorageScope;
  template_default_target_role?: FormRecipientRole | null;
  template_schema_json?: Record<string, unknown>;
  template_ui_schema_json?: Record<string, unknown>;
  template_instructions_markdown?: string | null;
  template_is_published?: boolean;
  template_version: number;
  storage_scope: FormStorageScope;
  owner_organization_id: string | null;
  coverage_zone_id: string | null;
  recipient_role: FormRecipientRole | null;
  recipient_user_id: string | null;
  recipient_organization_id: string | null;
  blob_storage_prefix: string | null;
  form_data: Record<string, unknown>;
  attachment_manifest: unknown[];
  last_saved_at: string;
  submission_type: SubmissionType;
  status: SubmissionStatus;
  target_type: SubmissionTargetType;
  target_id: string | null;
  submitted_by_user_id: string;
  assigned_to_user_id: string | null;
  title: string | null;
  notes: string | null;
  reviewer_notes: string | null;
  priority: SubmissionPriority;
  sla_deadline: string | null;
  sla_breached: boolean;
  submitted_at: string | null;
  reviewed_at: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// FIELD TYPES — Extended enterprise form field definitions
// ============================================================

/** All supported field input types for dynamic form rendering. */
export const FORM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'checkbox',
  'select',
  'multi_select',
  'radio',
  'date',
  'email',
  'phone',
  'url',
  'currency',
  'file',
  'heading',
  'divider',
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** Validation rule that can be attached to any form field. */
export interface FormFieldValidation {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  patternMessage?: string;
  customMessage?: string;
}

/** Single option in a select, multi_select, or radio field. */
export interface FormFieldOption {
  label: string;
  value: string;
  disabled?: boolean;
}

/** Conditional visibility rule — show/hide a field based on another field's value. */
export interface FormFieldCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_empty' | 'empty';
  value?: unknown;
}

/**
 * Enterprise-grade field definition for dynamic form rendering.
 * Compatible with both the `fields[]` array format and JSON Schema-style `properties`.
 */
export interface FormFieldDefinition {
  key: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  help?: string;
  placeholder?: string;
  options?: FormFieldOption[];
  defaultValue?: unknown;
  validation?: FormFieldValidation;
  showWhen?: FormFieldCondition;
  section?: string;
  order?: number;
  readonlyAfterSubmit?: boolean;
  width?: 'full' | 'half';
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildFieldOptions(value: unknown): FormFieldOption[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const options = value
    .map((entry) => {
      if (typeof entry === 'string') {
        return { label: entry, value: entry } satisfies FormFieldOption;
      }

      const option = readObject(entry);
      if (typeof option.value !== 'string') {
        return null;
      }

      return {
        value: option.value,
        label: typeof option.label === 'string' ? option.label : option.value,
        disabled: option.disabled === true,
      } satisfies FormFieldOption;
    })
    .filter((entry): entry is FormFieldOption => entry !== null);

  return options.length > 0 ? options : undefined;
}

function resolveFieldType(
  declaredType: string | undefined,
  widget: string | undefined,
  hasOptions: boolean,
): FormFieldType {
  const typeMap: Record<string, FormFieldType> = {
    date: 'date',
    email: 'email',
    phone: 'phone',
    url: 'url',
    currency: 'currency',
    file: 'file',
    heading: 'heading',
    divider: 'divider',
    radio: 'radio',
    multi_select: 'multi_select',
    multiselect: 'multi_select',
    textarea: 'textarea',
    checkbox: 'checkbox',
    boolean: 'checkbox',
    number: 'number',
    integer: 'number',
    select: 'select',
    text: 'text',
  };

  if (declaredType && typeMap[declaredType]) return typeMap[declaredType];
  if (widget && typeMap[widget]) return typeMap[widget];
  if (hasOptions) return 'select';
  return 'text';
}

function extractFieldExtras(
  field: Record<string, unknown>,
): Pick<FormFieldDefinition, 'validation' | 'showWhen' | 'section' | 'width'> {
  const extras: Pick<FormFieldDefinition, 'validation' | 'showWhen' | 'section' | 'width'> = {};
  const validation = readObject(field.validation);
  if (Object.keys(validation).length > 0) {
    extras.validation = validation as FormFieldValidation;
  }

  const showWhen = readObject(field.showWhen);
  if (typeof showWhen.field === 'string' && typeof showWhen.operator === 'string') {
    extras.showWhen = showWhen as unknown as FormFieldCondition;
  }

  if (typeof field.section === 'string') extras.section = field.section;
  if (field.width === 'full' || field.width === 'half') extras.width = field.width;
  return extras;
}

export function deriveFormFieldDefinitions(
  schema: Record<string, unknown>,
  uiSchema: Record<string, unknown> = {},
): FormFieldDefinition[] {
  const ui = readObject(uiSchema);
  const explicitFields = Array.isArray(schema.fields) ? schema.fields : null;

  if (explicitFields) {
    return explicitFields
      .map((entry): FormFieldDefinition | null => {
        const field = readObject(entry);
        const key = typeof field.key === 'string'
          ? field.key
          : typeof field.name === 'string'
            ? field.name
            : null;
        if (!key) return null;

        const uiField = readObject(ui[key]);
        const options = buildFieldOptions(field.options ?? field.enum ?? uiField.options);
        const declaredType = typeof field.type === 'string' ? field.type : undefined;
        const widget = typeof uiField.widget === 'string' ? uiField.widget : undefined;

        return {
          key,
          label: typeof field.label === 'string' ? field.label : typeof field.title === 'string' ? field.title : key,
          type: resolveFieldType(declaredType, widget, Boolean(options && options.length > 0)),
          required: field.required === true,
          help: typeof field.help === 'string' ? field.help : typeof field.description === 'string' ? field.description : undefined,
          placeholder: typeof field.placeholder === 'string' ? field.placeholder : undefined,
          options,
          defaultValue: field.default,
          ...extractFieldExtras(field),
        } satisfies FormFieldDefinition;
      })
      .filter((entry): entry is FormFieldDefinition => entry !== null);
  }

  const properties = readObject(schema.properties);
  if (Object.keys(properties).length > 0) {
    const requiredKeys = Array.isArray(schema.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : [];

    return Object.entries(properties).map(([key, value]) => {
      const field = readObject(value);
      const uiField = readObject(ui[key]);
      const options = buildFieldOptions(field.enum ?? uiField.options);
      const declaredType = typeof field.type === 'string' ? field.type : undefined;
      const widget = typeof uiField.widget === 'string' ? uiField.widget : undefined;

      return {
        key,
        label: typeof field.title === 'string' ? field.title : key,
        type: resolveFieldType(declaredType, widget, Boolean(options && options.length > 0)),
        required: requiredKeys.includes(key),
        help: typeof field.description === 'string' ? field.description : undefined,
        placeholder: typeof uiField.placeholder === 'string' ? uiField.placeholder : undefined,
        options,
        defaultValue: field.default,
        ...extractFieldExtras(field),
      } satisfies FormFieldDefinition;
    });
  }

  return Object.entries(schema)
    .filter(([, value]) => value && typeof value === 'object' && !Array.isArray(value))
    .map(([key, value]): FormFieldDefinition | null => {
      const field = readObject(value);
      if (!('type' in field) && !('label' in field) && !('title' in field)) {
        return null;
      }

      const options = buildFieldOptions(field.options ?? field.enum);
      const declaredType = typeof field.type === 'string' ? field.type : undefined;

      return {
        key,
        label: typeof field.label === 'string' ? field.label : typeof field.title === 'string' ? field.title : key,
        type: resolveFieldType(declaredType, undefined, Boolean(options && options.length > 0)),
        required: field.required === true,
        help: typeof field.help === 'string' ? field.help : undefined,
        placeholder: typeof field.placeholder === 'string' ? field.placeholder : undefined,
        options,
        defaultValue: field.default,
        ...extractFieldExtras(field),
      } satisfies FormFieldDefinition;
    })
    .filter((entry): entry is FormFieldDefinition => entry !== null);
}

export function validateAttachmentManifest(
  manifest: unknown[],
  routing: Pick<FormRoutingConfig, 'attachmentsEnabled' | 'maxAttachments' | 'allowedMimeTypes'>,
): string | null {
  if (!routing.attachmentsEnabled && manifest.length > 0) {
    return 'Attachments are not allowed for this form template';
  }

  if (routing.attachmentsEnabled && manifest.length > (routing.maxAttachments ?? 5)) {
    return `This form accepts at most ${routing.maxAttachments ?? 5} attachments`;
  }

  const allowedMimeTypes = routing.allowedMimeTypes ?? [];
  if (allowedMimeTypes.length === 0) return null;

  for (const entry of manifest) {
    const attachment = readObject(entry);
    if (typeof attachment.mimeType === 'string' && !allowedMimeTypes.includes(attachment.mimeType)) {
      return `${attachment.mimeType} attachments are not allowed for this form template`;
    }
  }

  return null;
}

// ============================================================
// PRIORITY SYSTEM — Per-template configurable priority defaults
// ============================================================

export const FORM_PRIORITY_LABELS: Record<SubmissionPriority, string> = {
  0: 'Standard',
  1: 'Elevated',
  2: 'High',
  3: 'Critical',
};

export const FORM_PRIORITY_STYLES: Record<SubmissionPriority, string> = {
  0: 'bg-slate-100 text-slate-700',
  1: 'bg-blue-100 text-blue-800',
  2: 'bg-amber-100 text-amber-800',
  3: 'bg-red-100 text-red-800',
};

// ============================================================
// CATEGORY SYSTEM — Predefined form categories with metadata
// ============================================================

export const FORM_CATEGORIES = [
  { key: 'general', label: 'General', icon: 'clipboard-list', color: 'slate' },
  { key: 'service_listing', label: 'Service Listing', icon: 'map-pin', color: 'blue' },
  { key: 'org_verification', label: 'Org Verification', icon: 'shield-check', color: 'emerald' },
  { key: 'data_correction', label: 'Data Correction', icon: 'pencil', color: 'amber' },
  { key: 'community_report', label: 'Community Report', icon: 'flag', color: 'rose' },
  { key: 'intake', label: 'Intake / Request', icon: 'inbox', color: 'violet' },
  { key: 'compliance', label: 'Compliance', icon: 'file-check', color: 'indigo' },
  { key: 'feedback', label: 'Feedback', icon: 'message-square', color: 'teal' },
] as const;

export type FormCategoryKey = (typeof FORM_CATEGORIES)[number]['key'];

// ============================================================
// TIMELINE / AUDIT — Submission history for UI display
// ============================================================

/** Single entry in a submission's visible timeline. */
export interface FormTimelineEntry {
  id: string;
  timestamp: string;
  fromStatus: string;
  toStatus: string;
  actorRole: string | null;
  reason: string | null;
  gatesPassed: boolean;
}

// ============================================================
// FORM ANALYTICS — Per-form metrics for admin dashboards
// ============================================================

export interface FormAnalytics {
  totalInstances: number;
  byStatus: Record<string, number>;
  avgTimeToReview: number | null;
  avgTimeToResolve: number | null;
  slaComplianceRate: number | null;
  overdueCount: number;
}

// ============================================================
// ROUTING CONFIGURATION — Declarative auto-routing rules
// ============================================================

/**
 * Routing configuration embedded in a form template's schema_json.
 * Determines who receives the form based on context.
 */
export interface FormRoutingConfig {
  /** Domain workflow type written to submissions.submission_type. */
  submissionType?: SubmissionType;
  /** Domain target type written to submissions.target_type. */
  targetType?: SubmissionTargetType;
  /** Default recipient role when no specific routing rule matches. */
  defaultRecipientRole: FormRecipientRole;
  /** Auto-assign to a specific user ID when template is instantiated (for direct-to-person forms). */
  autoAssignUserId?: string;
  /** Priority to apply when this form is submitted (overrides default 0). */
  defaultPriority?: SubmissionPriority;
  /** SLA review hours override for this template (overrides submission_slas table). */
  slaReviewHours?: number;
  /** Whether this form supports file attachments. */
  attachmentsEnabled?: boolean;
  /** Maximum number of attachments. */
  maxAttachments?: number;
  /** Allowed MIME types for attachments. */
  allowedMimeTypes?: string[];
  /** Whether submitter receives email confirmation on submit. */
  emailConfirmation?: boolean;
  /** Whether this form auto-advances submitted → needs_review without manual step. */
  autoQueueForReview?: boolean;
}

/**
 * Extract routing configuration from a template's schema_json.
 * Falls back to sensible defaults if not present.
 */
export function extractRoutingConfig(
  schemaJson: Record<string, unknown>,
  template: Pick<FormTemplate, 'default_target_role'>,
): FormRoutingConfig {
  const routing = schemaJson.routing;
  const config =
    routing && typeof routing === 'object' && !Array.isArray(routing)
      ? (routing as Record<string, unknown>)
      : {};

  return {
    defaultRecipientRole:
      (typeof config.defaultRecipientRole === 'string' &&
        FORM_RECIPIENT_ROLES.includes(config.defaultRecipientRole as FormRecipientRole)
        ? config.defaultRecipientRole
        : template.default_target_role ?? 'community_admin') as FormRecipientRole,
    submissionType:
      typeof config.submissionType === 'string'
        ? (config.submissionType as SubmissionType)
        : undefined,
    targetType:
      typeof config.targetType === 'string'
        ? (config.targetType as SubmissionTargetType)
        : undefined,
    autoAssignUserId:
      typeof config.autoAssignUserId === 'string' ? config.autoAssignUserId : undefined,
    defaultPriority:
      typeof config.defaultPriority === 'number' &&
      [0, 1, 2, 3].includes(config.defaultPriority)
        ? (config.defaultPriority as SubmissionPriority)
        : 0,
    slaReviewHours:
      typeof config.slaReviewHours === 'number' && config.slaReviewHours > 0
        ? config.slaReviewHours
        : undefined,
    attachmentsEnabled: config.attachmentsEnabled === true,
    maxAttachments:
      typeof config.maxAttachments === 'number' ? config.maxAttachments : 5,
    allowedMimeTypes: Array.isArray(config.allowedMimeTypes)
      ? config.allowedMimeTypes.filter((m): m is string => typeof m === 'string')
      : ['application/pdf', 'image/png', 'image/jpeg'],
    emailConfirmation: config.emailConfirmation !== false,
    autoQueueForReview: config.autoQueueForReview !== false,
  };
}

// ============================================================
// FIELD VALIDATION — Client-side validation engine
// ============================================================

/** Validate a single field value against its definition. Returns error message or null. */
export function validateFormField(
  field: FormFieldDefinition,
  value: unknown,
): string | null {
  // Required check
  if (field.required) {
    if (value === undefined || value === null || value === '') {
      return `${field.label} is required`;
    }
    if (field.type === 'multi_select' && Array.isArray(value) && value.length === 0) {
      return `${field.label} requires at least one selection`;
    }
  }

  // Skip further validation for empty optional fields
  if (value === undefined || value === null || value === '') return null;

  const v = field.validation;
  const strValue = typeof value === 'string' ? value : '';

  if (v) {
    if (v.minLength !== undefined && strValue.length < v.minLength) {
      return v.customMessage ?? `${field.label} must be at least ${v.minLength} characters`;
    }
    if (v.maxLength !== undefined && strValue.length > v.maxLength) {
      return v.customMessage ?? `${field.label} must be at most ${v.maxLength} characters`;
    }

    if (field.type === 'number' || field.type === 'currency') {
      const numValue = typeof value === 'number' ? value : Number(value);
      if (v.min !== undefined && numValue < v.min) {
        return v.customMessage ?? `${field.label} must be at least ${v.min}`;
      }
      if (v.max !== undefined && numValue > v.max) {
        return v.customMessage ?? `${field.label} must be at most ${v.max}`;
      }
    }

    if (v.pattern) {
      try {
        const re = new RegExp(v.pattern);
        if (!re.test(strValue)) {
          return v.patternMessage ?? v.customMessage ?? `${field.label} format is invalid`;
        }
      } catch {
        // Invalid regex in definition — skip
      }
    }
  }

  // Built-in type validation
  if (field.type === 'email' && strValue) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(strValue)) {
      return 'Please enter a valid email address';
    }
  }

  if (field.type === 'phone' && strValue) {
    if (!/^[+]?[\d\s()-]{7,20}$/.test(strValue)) {
      return 'Please enter a valid phone number';
    }
  }

  if (field.type === 'url' && strValue) {
    try {
      new URL(strValue);
    } catch {
      return 'Please enter a valid URL';
    }
  }

  return null;
}

/** Validate all fields in a form. Returns a map of field key → error message. */
export function validateFormData(
  fields: FormFieldDefinition[],
  data: Record<string, unknown>,
  visibleFields?: Set<string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    // Skip hidden (conditionally invisible) fields
    if (visibleFields && !visibleFields.has(field.key)) continue;
    // Skip layout-only fields
    if (field.type === 'heading' || field.type === 'divider') continue;

    const error = validateFormField(field, data[field.key]);
    if (error) errors[field.key] = error;
  }
  return errors;
}

/** Evaluate conditional visibility for all fields. Returns set of visible field keys. */
export function computeVisibleFields(
  fields: FormFieldDefinition[],
  data: Record<string, unknown>,
): Set<string> {
  const visible = new Set<string>();
  for (const field of fields) {
    if (!field.showWhen) {
      visible.add(field.key);
      continue;
    }

    const { field: depField, operator, value: condValue } = field.showWhen;
    const depValue = data[depField];

    let show = false;
    switch (operator) {
      case 'equals':
        show = depValue === condValue;
        break;
      case 'not_equals':
        show = depValue !== condValue;
        break;
      case 'contains':
        show =
          typeof depValue === 'string' && typeof condValue === 'string'
            ? depValue.includes(condValue)
            : Array.isArray(depValue) && depValue.includes(condValue);
        break;
      case 'not_empty':
        show =
          depValue !== undefined &&
          depValue !== null &&
          depValue !== '' &&
          !(Array.isArray(depValue) && depValue.length === 0);
        break;
      case 'empty':
        show =
          depValue === undefined ||
          depValue === null ||
          depValue === '' ||
          (Array.isArray(depValue) && depValue.length === 0);
        break;
    }

    if (show) visible.add(field.key);
  }
  return visible;
}

// ============================================================
// SLA HELPERS
// ============================================================

/** Compute human-readable time remaining until SLA deadline. */
export function formatSlaRemaining(deadline: string | null): {
  label: string;
  urgency: 'ok' | 'warning' | 'breached';
} {
  if (!deadline) return { label: 'No SLA', urgency: 'ok' };
  const deadlineMs = new Date(deadline).getTime();
  const nowMs = Date.now();
  const diffMs = deadlineMs - nowMs;

  if (diffMs <= 0) {
    const overdueMins = Math.abs(Math.round(diffMs / 60_000));
    if (overdueMins < 60) return { label: `${overdueMins}m overdue`, urgency: 'breached' };
    const overdueHrs = Math.round(overdueMins / 60);
    return { label: `${overdueHrs}h overdue`, urgency: 'breached' };
  }

  const remainMins = Math.round(diffMs / 60_000);
  if (remainMins < 60) return { label: `${remainMins}m left`, urgency: remainMins < 30 ? 'warning' : 'ok' };
  const remainHrs = Math.round(remainMins / 60);
  if (remainHrs < 24) return { label: `${remainHrs}h left`, urgency: remainHrs < 4 ? 'warning' : 'ok' };
  const remainDays = Math.round(remainHrs / 24);
  return { label: `${remainDays}d left`, urgency: 'ok' };
}

// ============================================================
// SUBMISSION REFERENCE IDs
// ============================================================

/** Generate a human-readable submission reference (e.g. ORAN-F-A3B2C1). */
export function generateFormReference(submissionId: string): string {
  const short = submissionId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `ORAN-F-${short}`;
}
