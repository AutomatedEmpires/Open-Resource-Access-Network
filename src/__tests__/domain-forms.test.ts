/**
 * Tests for domain/forms.ts — validation, visibility, SLA helpers,
 * routing config extraction, and reference generation.
 */
import { describe, it, expect } from 'vitest';
import {
  computeVisibleFields,
  extractRoutingConfig,
  formatSlaRemaining,
  generateFormReference,
  validateFormData,
  validateFormField,
  type FormFieldDefinition,
} from '@/domain/forms';

// ── validateFormField ──────────────────────────────────────

describe('validateFormField', () => {
  const textField: FormFieldDefinition = {
    key: 'name',
    label: 'Name',
    type: 'text',
    required: true,
  };

  it('returns error when required field is empty', () => {
    expect(validateFormField(textField, '')).toBe('Name is required');
    expect(validateFormField(textField, null)).toBe('Name is required');
    expect(validateFormField(textField, undefined)).toBe('Name is required');
  });

  it('returns null when required field has value', () => {
    expect(validateFormField(textField, 'Alice')).toBeNull();
  });

  it('returns null for optional empty field', () => {
    const optional: FormFieldDefinition = { ...textField, required: false };
    expect(validateFormField(optional, '')).toBeNull();
  });

  it('validates minLength', () => {
    const field: FormFieldDefinition = {
      key: 'code',
      label: 'Code',
      type: 'text',
      required: false,
      validation: { minLength: 3 },
    };
    expect(validateFormField(field, 'AB')).toContain('at least 3');
    expect(validateFormField(field, 'ABC')).toBeNull();
  });

  it('validates maxLength', () => {
    const field: FormFieldDefinition = {
      key: 'code',
      label: 'Code',
      type: 'text',
      required: false,
      validation: { maxLength: 5 },
    };
    expect(validateFormField(field, 'ABCDEF')).toContain('at most 5');
    expect(validateFormField(field, 'ABCDE')).toBeNull();
  });

  it('validates number min/max', () => {
    const field: FormFieldDefinition = {
      key: 'age',
      label: 'Age',
      type: 'number',
      required: false,
      validation: { min: 0, max: 150 },
    };
    expect(validateFormField(field, -1)).toContain('at least 0');
    expect(validateFormField(field, 200)).toContain('at most 150');
    expect(validateFormField(field, 25)).toBeNull();
  });

  it('validates email format', () => {
    const field: FormFieldDefinition = {
      key: 'email',
      label: 'Email',
      type: 'email',
      required: false,
    };
    expect(validateFormField(field, 'bad')).toBe('Please enter a valid email address');
    expect(validateFormField(field, 'a@b.com')).toBeNull();
  });

  it('validates phone format', () => {
    const field: FormFieldDefinition = {
      key: 'phone',
      label: 'Phone',
      type: 'phone',
      required: false,
    };
    expect(validateFormField(field, 'abc')).toBe('Please enter a valid phone number');
    expect(validateFormField(field, '+1 (555) 123-4567')).toBeNull();
  });

  it('validates URL format', () => {
    const field: FormFieldDefinition = {
      key: 'website',
      label: 'Website',
      type: 'url',
      required: false,
    };
    expect(validateFormField(field, 'not_a_url')).toBe('Please enter a valid URL');
    expect(validateFormField(field, 'https://example.com')).toBeNull();
  });

  it('validates pattern', () => {
    const field: FormFieldDefinition = {
      key: 'zip',
      label: 'Zip',
      type: 'text',
      required: false,
      validation: { pattern: '^\\d{5}$', patternMessage: 'Must be 5 digits' },
    };
    expect(validateFormField(field, '123')).toBe('Must be 5 digits');
    expect(validateFormField(field, '12345')).toBeNull();
  });

  it('validates multi_select required', () => {
    const field: FormFieldDefinition = {
      key: 'tags',
      label: 'Tags',
      type: 'multi_select',
      required: true,
    };
    expect(validateFormField(field, [])).toBe('Tags requires at least one selection');
    expect(validateFormField(field, ['a'])).toBeNull();
  });

  it('uses customMessage when provided', () => {
    const field: FormFieldDefinition = {
      key: 'x',
      label: 'X',
      type: 'text',
      required: false,
      validation: { minLength: 5, customMessage: 'Too short!' },
    };
    expect(validateFormField(field, 'ab')).toBe('Too short!');
  });
});

// ── validateFormData ───────────────────────────────────────

describe('validateFormData', () => {
  const fields: FormFieldDefinition[] = [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'bio', label: 'Bio', type: 'textarea', required: false },
    { key: 'section_heading', label: 'Section', type: 'heading', required: false },
  ];

  it('returns errors for invalid fields', () => {
    const errors = validateFormData(fields, { name: '', bio: '' });
    expect(errors).toEqual({ name: 'Name is required' });
  });

  it('skips heading/divider fields', () => {
    const errors = validateFormData(fields, { name: 'Alice' });
    expect(errors).toEqual({});
  });

  it('skips hidden fields', () => {
    const visible = new Set(['bio']);
    const errors = validateFormData(fields, { name: '' }, visible);
    expect(errors).toEqual({});
  });
});

// ── computeVisibleFields ──────────────────────────────────

describe('computeVisibleFields', () => {
  const fields: FormFieldDefinition[] = [
    { key: 'has_org', label: 'Has Org', type: 'checkbox', required: false },
    {
      key: 'org_name',
      label: 'Org Name',
      type: 'text',
      required: false,
      showWhen: { field: 'has_org', operator: 'equals', value: true },
    },
    {
      key: 'reason',
      label: 'Reason',
      type: 'text',
      required: false,
      showWhen: { field: 'has_org', operator: 'not_equals', value: true },
    },
    { key: 'always', label: 'Always', type: 'text', required: false },
  ];

  it('shows unconditional fields always', () => {
    const visible = computeVisibleFields(fields, {});
    expect(visible.has('has_org')).toBe(true);
    expect(visible.has('always')).toBe(true);
  });

  it('shows conditional field when equals matches', () => {
    const visible = computeVisibleFields(fields, { has_org: true });
    expect(visible.has('org_name')).toBe(true);
    expect(visible.has('reason')).toBe(false);
  });

  it('shows not_equals field when condition met', () => {
    const visible = computeVisibleFields(fields, { has_org: false });
    expect(visible.has('org_name')).toBe(false);
    expect(visible.has('reason')).toBe(true);
  });

  it('handles contains operator for strings', () => {
    const field: FormFieldDefinition = {
      key: 'extra',
      label: 'Extra',
      type: 'text',
      required: false,
      showWhen: { field: 'note', operator: 'contains', value: 'urgent' },
    };
    expect(computeVisibleFields([field], { note: 'this is urgent' }).has('extra')).toBe(true);
    expect(computeVisibleFields([field], { note: 'not important' }).has('extra')).toBe(false);
  });

  it('handles not_empty operator', () => {
    const field: FormFieldDefinition = {
      key: 'extra',
      label: 'Extra',
      type: 'text',
      required: false,
      showWhen: { field: 'name', operator: 'not_empty' },
    };
    expect(computeVisibleFields([field], { name: 'Alice' }).has('extra')).toBe(true);
    expect(computeVisibleFields([field], { name: '' }).has('extra')).toBe(false);
    expect(computeVisibleFields([field], {}).has('extra')).toBe(false);
  });

  it('handles empty operator', () => {
    const field: FormFieldDefinition = {
      key: 'extra',
      label: 'Extra',
      type: 'text',
      required: false,
      showWhen: { field: 'name', operator: 'empty' },
    };
    expect(computeVisibleFields([field], {}).has('extra')).toBe(true);
    expect(computeVisibleFields([field], { name: '' }).has('extra')).toBe(true);
    expect(computeVisibleFields([field], { name: 'Alice' }).has('extra')).toBe(false);
  });
});

// ── formatSlaRemaining ────────────────────────────────────

describe('formatSlaRemaining', () => {
  it('returns "No SLA" when null', () => {
    const result = formatSlaRemaining(null);
    expect(result).toEqual({ label: 'No SLA', urgency: 'ok' });
  });

  it('returns "breached" when past deadline', () => {
    const pastDate = new Date(Date.now() - 3600_000).toISOString();
    const result = formatSlaRemaining(pastDate);
    expect(result.urgency).toBe('breached');
    expect(result.label).toContain('overdue');
  });

  it('returns "ok" when far from deadline', () => {
    const futureDate = new Date(Date.now() + 48 * 3600_000).toISOString();
    const result = formatSlaRemaining(futureDate);
    expect(result.urgency).toBe('ok');
    expect(result.label).toContain('left');
  });

  it('returns "warning" when close to deadline', () => {
    const soonDate = new Date(Date.now() + 15 * 60_000).toISOString(); // 15 min
    const result = formatSlaRemaining(soonDate);
    expect(result.urgency).toBe('warning');
    expect(result.label).toContain('left');
  });
});

// ── extractRoutingConfig ──────────────────────────────────

describe('extractRoutingConfig', () => {
  it('returns defaults when no routing block', () => {
    const config = extractRoutingConfig({}, { default_target_role: null });
    expect(config.defaultRecipientRole).toBe('community_admin');
    expect(config.defaultPriority).toBe(0);
    expect(config.emailConfirmation).toBe(true);
    expect(config.autoQueueForReview).toBe(true);
  });

  it('extracts routing from schema_json', () => {
    const schema = {
      routing: {
        defaultRecipientRole: 'oran_admin',
        defaultPriority: 2,
        slaReviewHours: 24,
        attachmentsEnabled: true,
        maxAttachments: 3,
        emailConfirmation: false,
        autoQueueForReview: false,
      },
    };
    const config = extractRoutingConfig(schema, { default_target_role: 'host_admin' });
    expect(config.defaultRecipientRole).toBe('oran_admin');
    expect(config.defaultPriority).toBe(2);
    expect(config.slaReviewHours).toBe(24);
    expect(config.attachmentsEnabled).toBe(true);
    expect(config.maxAttachments).toBe(3);
    expect(config.emailConfirmation).toBe(false);
    expect(config.autoQueueForReview).toBe(false);
  });

  it('falls back to template.default_target_role', () => {
    const config = extractRoutingConfig({}, { default_target_role: 'host_admin' });
    expect(config.defaultRecipientRole).toBe('host_admin');
  });

  it('rejects invalid priority values', () => {
    const schema = { routing: { defaultPriority: 99 } };
    const config = extractRoutingConfig(schema, { default_target_role: null });
    expect(config.defaultPriority).toBe(0);
  });

  it('filters allowed MIME types to strings', () => {
    const schema = { routing: { allowedMimeTypes: ['image/png', 42, null, 'application/pdf'] } };
    const config = extractRoutingConfig(schema, { default_target_role: null });
    expect(config.allowedMimeTypes).toEqual(['image/png', 'application/pdf']);
  });
});

// ── generateFormReference ─────────────────────────────────

describe('generateFormReference', () => {
  it('generates ORAN-F- prefixed reference', () => {
    const ref = generateFormReference('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(ref).toMatch(/^ORAN-F-[A-Z0-9]{6}$/);
  });

  it('produces consistent output for same input', () => {
    const id = '12345678-1234-1234-1234-123456789012';
    expect(generateFormReference(id)).toBe(generateFormReference(id));
  });
});
