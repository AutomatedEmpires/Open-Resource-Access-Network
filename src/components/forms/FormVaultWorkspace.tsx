'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  BarChart3,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  ShieldX,
  Square,
  Trash2,
  UserPlus,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { FormAlert } from '@/components/ui/form-alert';
import { FormField } from '@/components/ui/form-field';
import { FormSection } from '@/components/ui/form-section';
import { PageHeader, PageHeaderBadge } from '@/components/ui/PageHeader';
import { useToast } from '@/components/ui/toast';
import {
  computeVisibleFields,
  deriveFormFieldDefinitions,
  extractRoutingConfig,
  FORM_PRIORITY_LABELS,
  FORM_PRIORITY_STYLES,
  FORM_RECIPIENT_ROLES,
  FORM_STORAGE_SCOPES,
  FORM_TEMPLATE_AUDIENCES,
  formatSlaRemaining,
  generateFormReference,
  validateFormData,
  type FormInstance,
  type FormRecipientRole,
  type FormStorageScope,
  type FormAnalytics,
  type FormTemplate,
  type FormTemplateAudience,
  type FormTimelineEntry,
} from '@/domain/forms';

type PortalMode = 'host' | 'community_admin' | 'oran_admin';

interface FormVaultWorkspaceProps {
  portal: PortalMode;
}

interface TemplateListResponse {
  templates: FormTemplate[];
  total: number;
}

interface InstanceListResponse {
  instances: FormInstance[];
  total: number;
}

interface HostOrgOption {
  id: string;
  name: string;
}

interface CoverageZoneOption {
  id: string;
  name: string;
  description: string | null;
}

interface FormTemplateDraft {
  slug: string;
  title: string;
  description: string;
  category: string;
  audience_scope: FormTemplateAudience;
  storage_scope: FormStorageScope;
  default_target_role: FormRecipientRole | '';
  instructions_markdown: string;
  is_published: boolean;
  schemaJsonText: string;
  uiSchemaJsonText: string;
  default_priority: '0' | '1' | '2' | '3';
  sla_review_hours: string;
  auto_assign_user_id: string;
  auto_queue_for_review: boolean;
  attachments_enabled: boolean;
  email_confirmation: boolean;
}

const EMPTY_TEMPLATE_DRAFT: FormTemplateDraft = {
  slug: '',
  title: '',
  description: '',
  category: 'general',
  audience_scope: 'shared',
  storage_scope: 'platform',
  default_target_role: '',
  instructions_markdown: '',
  is_published: false,
  schemaJsonText: JSON.stringify(
    {
      fields: [
        {
          key: 'summary',
          label: 'Summary',
          type: 'textarea',
          required: true,
          help: 'Describe the request or outcome the reviewer should evaluate.',
        },
      ],
    },
    null,
    2,
  ),
  uiSchemaJsonText: JSON.stringify({}, null, 2),
  default_priority: '0',
  sla_review_hours: '72',
  auto_assign_user_id: '',
  auto_queue_for_review: true,
  attachments_enabled: true,
  email_confirmation: true,
};

const PORTAL_COPY: Record<PortalMode, { eyebrow: string; title: string; subtitle: string }> = {
  host: {
    eyebrow: 'Host workspace',
    title: 'Managed Forms',
    subtitle:
      'Browse approved templates, start a managed form in-app, save draft progress, and submit it into the shared ORAN review workflow.',
  },
  community_admin: {
    eyebrow: 'Community Admin',
    title: 'Managed Form Review',
    subtitle:
      'Review submission-backed forms routed to community operators without leaving the portal or losing workflow history.',
  },
  oran_admin: {
    eyebrow: 'ORAN Admin',
    title: 'Form Vault',
    subtitle:
      'Publish reusable form templates, inspect managed-form traffic across the platform, and intervene in review when policy requires it.',
  },
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'returned', label: 'Returned' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'under_review', label: 'Under review' },
  { value: 'approved', label: 'Approved' },
  { value: 'denied', label: 'Denied' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'archived', label: 'Archived' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'expired', label: 'Expired' },
];

const PRIORITY_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All priorities' },
  { value: '0', label: 'Standard' },
  { value: '1', label: 'Elevated' },
  { value: '2', label: 'High' },
  { value: '3', label: 'Critical' },
];

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-800',
  returned: 'bg-amber-100 text-amber-800',
  submitted: 'bg-blue-100 text-blue-800',
  needs_review: 'bg-violet-100 text-violet-800',
  under_review: 'bg-indigo-100 text-indigo-800',
  approved: 'bg-emerald-100 text-emerald-800',
  denied: 'bg-rose-100 text-rose-800',
  withdrawn: 'bg-gray-100 text-gray-700',
  archived: 'bg-gray-200 text-gray-600',
  escalated: 'bg-orange-100 text-orange-800',
  expired: 'bg-red-50 text-red-700',
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 120);
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonObject(value: string, fieldName: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${fieldName} must be valid JSON object syntax.`);
  }
}

function buildInitialFormData(template: FormTemplate): Record<string, unknown> {
  const fields = deriveFormFieldDefinitions(readObject(template.schema_json), readObject(template.ui_schema_json));
  return fields.reduce<Record<string, unknown>>((accumulator, field) => {
    if (field.defaultValue !== undefined) {
      accumulator[field.key] = field.defaultValue;
      return accumulator;
    }
    if (field.type === 'checkbox') {
      accumulator[field.key] = false;
    }
    return accumulator;
  }, {});
}

function getTemplateInstructions(instance: FormInstance | null, template: FormTemplate | null): string | null {
  return instance?.template_instructions_markdown ?? template?.instructions_markdown ?? null;
}

function getNextActionSummary(instance: FormInstance | null): string {
  if (!instance) return 'No form selected.';

  switch (instance.status) {
    case 'draft':
    case 'returned':
      return 'Submitter action required before the form can enter review.';
    case 'submitted':
    case 'needs_review':
      return instance.assigned_to_user_id
        ? 'Assigned reviewer should open the form and begin review.'
        : 'Reviewer assignment or pickup is required to start review.';
    case 'under_review':
      return instance.assigned_to_user_id
        ? 'Assigned reviewer should approve, deny, or return the form.'
        : 'Review is active, but the working owner is still unassigned.';
    case 'approved':
      return 'Completed successfully. Keep the record for audit and follow-up.';
    case 'denied':
      return 'Completed with denial. Submitter may need an appeal or correction path.';
    default:
      return 'Monitor the form history and routing metadata.';
  }
}

function renderStatusBadge(status: string) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-800'}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-white px-4 py-8 text-center">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-2 text-sm text-gray-600">{body}</p>
    </div>
  );
}

export default function FormVaultWorkspace({ portal }: FormVaultWorkspaceProps) {
  const copy = PORTAL_COPY[portal];
  const { success, error: showError } = useToast();
  const canCreateTemplates = portal === 'oran_admin';
  const canCreateInstances = portal === 'host';
  const canReview = portal === 'community_admin' || portal === 'oran_admin';
  const showTemplates = portal !== 'community_admin';

  const [templatesData, setTemplatesData] = useState<TemplateListResponse | null>(null);
  const [instancesData, setInstancesData] = useState<InstanceListResponse | null>(null);
  const [organizations, setOrganizations] = useState<HostOrgOption[]>([]);
  const [coverageZones, setCoverageZones] = useState<CoverageZoneOption[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(showTemplates);
  const [instancesLoading, setInstancesLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [instancesError, setInstancesError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState(portal === 'community_admin' ? 'needs_review' : '');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [selectedInstance, setSelectedInstance] = useState<FormInstance | null>(null);
  const [selectedOwnerOrganizationId, setSelectedOwnerOrganizationId] = useState('');
  const [selectedCoverageZoneId, setSelectedCoverageZoneId] = useState('');
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftFormData, setDraftFormData] = useState<Record<string, unknown>>({});
  const [rawFormData, setRawFormData] = useState('{}');
  const [rawFormDataError, setRawFormDataError] = useState<string | null>(null);
  const [draftRecipientRole, setDraftRecipientRole] = useState<FormRecipientRole | ''>('');
  const [draftRecipientUserId, setDraftRecipientUserId] = useState('');
  const [draftRecipientOrganizationId, setDraftRecipientOrganizationId] = useState('');
  const [instanceActionPending, setInstanceActionPending] = useState<string | null>(null);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [templateFormPending, setTemplateFormPending] = useState(false);
  const [templateFormError, setTemplateFormError] = useState<string | null>(null);
  const [templateDraft, setTemplateDraft] = useState<FormTemplateDraft>(EMPTY_TEMPLATE_DRAFT);

  // ── Analytics state ─────────────────────────────────────
  const [analytics, setAnalytics] = useState<FormAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);

  // ── Priority filter ─────────────────────────────────────
  const [priorityFilter, setPriorityFilter] = useState('');

  // ── Duplicate template state ────────────────────────────
  const [duplicatePending, setDuplicatePending] = useState<string | null>(null);

  // ── Export state ────────────────────────────────────────
  const [exportPending, setExportPending] = useState(false);

  // ── Template search ─────────────────────────────────────
  const [templateSearch, setTemplateSearch] = useState('');

  // ── Template editing state ──────────────────────────────
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<FormTemplateDraft>(EMPTY_TEMPLATE_DRAFT);
  const [editPending, setEditPending] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // ── Bulk selection state ────────────────────────────────
  const [selectedInstanceIds, setSelectedInstanceIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<'approve' | 'deny' | 'return' | ''>('');
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkPending, setBulkPending] = useState(false);

  // ── Instance pagination state ───────────────────────────
  const [instancePage, setInstancePage] = useState(0);

  // ── Reassignment state ──────────────────────────────────
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [assignPending, setAssignPending] = useState(false);

  // ── Template delete state ───────────────────────────────
  const [deletePending, setDeletePending] = useState<string | null>(null);

  const templateMap = useMemo(
    () => new Map((templatesData?.templates ?? []).map((template) => [template.id, template])),
    [templatesData],
  );

  const filteredInstances = useMemo(() => {
    const all = instancesData?.instances ?? [];
    if (!priorityFilter) return all;
    const p = Number(priorityFilter);
    return all.filter((i) => i.priority === p);
  }, [instancesData, priorityFilter]);

  const selectedTemplate = useMemo(() => {
    if (!selectedTemplateId) return null;
    return templateMap.get(selectedTemplateId) ?? null;
  }, [selectedTemplateId, templateMap]);

  const detailTemplate = useMemo(() => {
    if (!selectedInstance) return selectedTemplate;
    return templateMap.get(selectedInstance.template_id) ?? null;
  }, [selectedInstance, selectedTemplate, templateMap]);

  const schemaForDetail = useMemo(
    () => readObject(selectedInstance?.template_schema_json ?? detailTemplate?.schema_json ?? {}),
    [detailTemplate, selectedInstance],
  );
  const uiSchemaForDetail = useMemo(
    () => readObject(selectedInstance?.template_ui_schema_json ?? detailTemplate?.ui_schema_json ?? {}),
    [detailTemplate, selectedInstance],
  );
  const fieldSpecs = useMemo(
    () => deriveFormFieldDefinitions(schemaForDetail, uiSchemaForDetail),
    [schemaForDetail, uiSchemaForDetail],
  );
  const selectedTemplateRouting = useMemo(
    () => (selectedTemplate ? extractRoutingConfig(readObject(selectedTemplate.schema_json), selectedTemplate) : null),
    [selectedTemplate],
  );
  const selectedInstanceRouting = useMemo(
    () => selectedInstance
      ? extractRoutingConfig(readObject(selectedInstance.template_schema_json ?? detailTemplate?.schema_json ?? {}), {
          default_target_role: selectedInstance.template_default_target_role ?? detailTemplate?.default_target_role ?? null,
        })
      : null,
    [detailTemplate, selectedInstance],
  );
  const instructions = useMemo(
    () => getTemplateInstructions(selectedInstance, detailTemplate),
    [detailTemplate, selectedInstance],
  );
  const editable = Boolean(selectedInstance && ['draft', 'returned'].includes(selectedInstance.status));
  const slaSummary = useMemo(
    () => formatSlaRemaining(selectedInstance?.sla_deadline ?? null),
    [selectedInstance?.sla_deadline],
  );
  const formReference = useMemo(
    () => (selectedInstance ? generateFormReference(selectedInstance.submission_id) : null),
    [selectedInstance],
  );

  // ── Validation + conditional visibility ─────────────────
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const visibleFieldKeys = useMemo(
    () => computeVisibleFields(fieldSpecs, draftFormData),
    [fieldSpecs, draftFormData],
  );

  // Group visible fields by section for structured layout
  const sectionedFields = useMemo(() => {
    const visible = fieldSpecs.filter((f) => visibleFieldKeys.has(f.key));
    const sections: Array<{ name: string | null; fields: typeof visible }> = [];
    let currentSection: string | null = null;
    let currentFields: typeof visible = [];

    for (const field of visible) {
      const section = field.section ?? null;
      if (section !== currentSection && currentFields.length > 0) {
        sections.push({ name: currentSection, fields: currentFields });
        currentFields = [];
      }
      currentSection = section;
      currentFields.push(field);
    }
    if (currentFields.length > 0) {
      sections.push({ name: currentSection, fields: currentFields });
    }
    return sections;
  }, [fieldSpecs, visibleFieldKeys]);

  // ── Timeline state ──────────────────────────────────────
  const [timeline, setTimeline] = useState<FormTimelineEntry[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // ── Post-submit confirmation banner ─────────────────────
  const [showConfirmation, setShowConfirmation] = useState<{ reference: string; queuedForReview: boolean } | null>(null);

  const applyInstanceState = useCallback((instance: FormInstance) => {
    setSelectedInstance(instance);
    setDraftTitle(instance.title ?? instance.template_title ?? '');
    setDraftNotes(instance.notes ?? '');
    const nextFormData = readObject(instance.form_data ?? {});
    setDraftFormData(nextFormData);
    setRawFormData(JSON.stringify(nextFormData, null, 2));
    setRawFormDataError(null);
    setDraftRecipientRole(instance.recipient_role ?? '');
    setDraftRecipientUserId(instance.recipient_user_id ?? '');
    setDraftRecipientOrganizationId(instance.recipient_organization_id ?? '');
    setReviewerNotes(instance.reviewer_notes ?? '');
  }, []);

  const fetchTemplates = useCallback(async () => {
    if (!showTemplates) return;
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (canCreateTemplates) {
        params.set('includeUnpublished', 'true');
      }
      if (templateSearch.trim()) {
        params.set('search', templateSearch.trim());
      }
      const response = await fetch(`/api/forms/templates?${params.toString()}`);
      const body = (await response.json().catch(() => null)) as (TemplateListResponse & { error?: string }) | null;
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to load form templates.');
      }
      setTemplatesData({ templates: body?.templates ?? [], total: body?.total ?? 0 });
      if (!selectedTemplateId && body?.templates?.[0]) {
        setSelectedTemplateId(body.templates[0].id);
      }
    } catch (fetchError) {
      setTemplatesError(fetchError instanceof Error ? fetchError.message : 'Failed to load form templates.');
    } finally {
      setTemplatesLoading(false);
    }
  }, [canCreateTemplates, selectedTemplateId, showTemplates, templateSearch]);

  const fetchInstances = useCallback(async () => {
    setInstancesLoading(true);
    setInstancesError(null);
    try {
      const params = new URLSearchParams({ limit: '50', offset: String(instancePage * 50) });
      if (statusFilter) {
        params.set('status', statusFilter);
      }
      const response = await fetch(`/api/forms/instances?${params.toString()}`);
      const body = (await response.json().catch(() => null)) as (InstanceListResponse & { error?: string }) | null;
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to load form instances.');
      }
      const nextInstances = body?.instances ?? [];
      setInstancesData({ instances: nextInstances, total: body?.total ?? 0 });

      if (selectedInstanceId) {
        const stillVisible = nextInstances.some((instance) => instance.id === selectedInstanceId);
        if (!stillVisible && !detailLoading) {
          setSelectedInstanceId(nextInstances[0]?.id ?? null);
        }
      } else if (nextInstances[0]) {
        setSelectedInstanceId(nextInstances[0].id);
      }
    } catch (fetchError) {
      setInstancesError(fetchError instanceof Error ? fetchError.message : 'Failed to load form instances.');
    } finally {
      setInstancesLoading(false);
    }
  }, [detailLoading, instancePage, selectedInstanceId, statusFilter]);

  const fetchOrganizations = useCallback(async () => {
    if (!canCreateInstances) return;
    try {
      const response = await fetch('/api/host/organizations?limit=100');
      if (!response.ok) return;
      const body = (await response.json()) as { results?: Array<{ id: string; name: string }> };
      const nextOrganizations = (body.results ?? []).map((organization) => ({
        id: organization.id,
        name: organization.name,
      }));
      setOrganizations(nextOrganizations);
      if (!selectedOwnerOrganizationId && nextOrganizations[0]) {
        setSelectedOwnerOrganizationId(nextOrganizations[0].id);
      }
    } catch {
      // Non-fatal. Platform-scoped forms can still start without an org selector.
    }
  }, [canCreateInstances, selectedOwnerOrganizationId]);

  const fetchCoverageZones = useCallback(async () => {
    if (!canCreateInstances) return;
    try {
      const response = await fetch('/api/forms/zones?limit=100');
      if (!response.ok) return;
      const body = (await response.json()) as { zones?: CoverageZoneOption[] };
      const nextZones = body.zones ?? [];
      setCoverageZones(nextZones);
      if (!selectedCoverageZoneId && nextZones[0]) {
        setSelectedCoverageZoneId(nextZones[0].id);
      }
    } catch {
      // Non-fatal. Community-scoped launches stay unavailable without active zones.
    }
  }, [canCreateInstances, selectedCoverageZoneId]);

  const fetchInstanceDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetailError(null);
    setShowConfirmation(null);
    setFieldErrors({});
    try {
      const response = await fetch(`/api/forms/instances/${id}`);
      const body = (await response.json().catch(() => null)) as { instance?: FormInstance; error?: string } | null;
      if (!response.ok || !body?.instance) {
        throw new Error(body?.error ?? 'Failed to load form details.');
      }
      applyInstanceState(body.instance);
    } catch (fetchError) {
      setDetailError(fetchError instanceof Error ? fetchError.message : 'Failed to load form details.');
    } finally {
      setDetailLoading(false);
    }
  }, [applyInstanceState]);

  const fetchTimeline = useCallback(async (instanceId: string) => {
    setTimelineLoading(true);
    try {
      const response = await fetch(`/api/forms/instances/${instanceId}/timeline`);
      const body = (await response.json().catch(() => null)) as { timeline?: FormTimelineEntry[] } | null;
      if (response.ok && body?.timeline) {
        setTimeline(body.timeline);
      }
    } catch {
      // Timeline is non-critical — silently ignore
    } finally {
      setTimelineLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async (templateId?: string) => {
    setAnalyticsLoading(true);
    try {
      const params = new URLSearchParams();
      if (templateId) params.set('templateId', templateId);
      const response = await fetch(`/api/forms/analytics?${params.toString()}`);
      const body = (await response.json().catch(() => null)) as { analytics?: FormAnalytics } | null;
      if (response.ok && body?.analytics) {
        setAnalytics(body.analytics);
      }
    } catch {
      // Analytics are non-critical
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  const handleDuplicateTemplate = useCallback(async (templateId: string, originalSlug: string) => {
    const newSlug = `${originalSlug}-copy`.slice(0, 120);
    setDuplicatePending(templateId);
    try {
      const response = await fetch(`/api/forms/templates/${templateId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newSlug }),
      });
      const body = (await response.json().catch(() => null)) as { template?: FormTemplate; error?: unknown } | null;
      if (!response.ok || !body?.template) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Failed to duplicate template.');
      }
      success('Template duplicated.');
      await fetchTemplates();
      setSelectedTemplateId(body.template.id);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to duplicate template.');
    } finally {
      setDuplicatePending(null);
    }
  }, [fetchTemplates, showError, success]);

  const handleExport = useCallback(async (format: 'csv' | 'json') => {
    setExportPending(true);
    try {
      const params = new URLSearchParams({ format });
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) {
        // Priority filter is UI-only; export all matching the status
      }
      const response = await fetch(`/api/forms/instances/export?${params.toString()}`);
      if (!response.ok) {
        throw new Error('Failed to export forms.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `form-instances-${Date.now()}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      success(`Exported as ${format.toUpperCase()}.`);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setExportPending(false);
    }
  }, [priorityFilter, showError, statusFilter, success]);

  const startEditingTemplate = useCallback((template: FormTemplate) => {
    const routing = extractRoutingConfig(readObject(template.schema_json), template);
    setEditingTemplateId(template.id);
    setEditError(null);
    setEditDraft({
      slug: template.slug,
      title: template.title,
      description: template.description ?? '',
      category: template.category,
      audience_scope: template.audience_scope,
      storage_scope: template.storage_scope,
      default_target_role: template.default_target_role ?? '',
      instructions_markdown: template.instructions_markdown ?? '',
      is_published: template.is_published,
      schemaJsonText: JSON.stringify(template.schema_json, null, 2),
      uiSchemaJsonText: JSON.stringify(template.ui_schema_json, null, 2),
      default_priority: String(routing.defaultPriority ?? 0) as FormTemplateDraft['default_priority'],
      sla_review_hours: routing.slaReviewHours ? String(routing.slaReviewHours) : '72',
      auto_assign_user_id: routing.autoAssignUserId ?? '',
      auto_queue_for_review: routing.autoQueueForReview !== false,
      attachments_enabled: routing.attachmentsEnabled !== false,
      email_confirmation: routing.emailConfirmation === true,
    });
  }, []);

  const handleEditDraftChange = useCallback(
    (key: keyof FormTemplateDraft, value: FormTemplateDraft[keyof FormTemplateDraft]) => {
      setEditDraft((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const handleUpdateTemplate = useCallback(async () => {
    if (!editingTemplateId) return;
    setEditPending(true);
    setEditError(null);
    try {
      const schemaJson = parseJsonObject(editDraft.schemaJsonText, 'Schema JSON');
      const uiSchemaJson = parseJsonObject(editDraft.uiSchemaJsonText, 'UI schema JSON');
      const schemaWithRouting = {
        ...schemaJson,
        routing: {
          ...readObject(schemaJson.routing),
          defaultRecipientRole: editDraft.default_target_role || undefined,
          autoAssignUserId: editDraft.auto_assign_user_id.trim() || undefined,
          defaultPriority: Number(editDraft.default_priority),
          slaReviewHours: editDraft.sla_review_hours.trim() ? Number(editDraft.sla_review_hours) : undefined,
          attachmentsEnabled: editDraft.attachments_enabled,
          emailConfirmation: editDraft.email_confirmation,
          autoQueueForReview: editDraft.auto_queue_for_review,
        },
      };
      const response = await fetch(`/api/forms/templates/${editingTemplateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editDraft.title.trim(),
          description: editDraft.description.trim() || null,
          category: editDraft.category.trim() || 'general',
          audience_scope: editDraft.audience_scope,
          storage_scope: editDraft.storage_scope,
          default_target_role: editDraft.default_target_role || null,
          schema_json: schemaWithRouting,
          ui_schema_json: uiSchemaJson,
          instructions_markdown: editDraft.instructions_markdown.trim() || null,
          is_published: editDraft.is_published,
        }),
      });
      const body = (await response.json().catch(() => null)) as { template?: FormTemplate; error?: string } | null;
      if (!response.ok || !body?.template) {
        throw new Error(body?.error ?? 'Failed to update template.');
      }
      success('Template updated.');
      setEditingTemplateId(null);
      await fetchTemplates();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to update template.');
    } finally {
      setEditPending(false);
    }
  }, [editDraft, editingTemplateId, fetchTemplates, success]);

  const toggleInstanceSelection = useCallback((instanceId: string) => {
    setSelectedInstanceIds((prev) => {
      const next = new Set(prev);
      if (next.has(instanceId)) {
        next.delete(instanceId);
      } else {
        next.add(instanceId);
      }
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedInstanceIds((prev) => {
      const reviewable = filteredInstances.filter((i) => ['needs_review', 'under_review'].includes(i.status));
      if (prev.size === reviewable.length && reviewable.length > 0) {
        return new Set();
      }
      return new Set(reviewable.map((i) => i.id));
    });
  }, [filteredInstances]);

  const handleBulkAction = useCallback(async () => {
    if (!bulkAction || selectedInstanceIds.size === 0) return;
    setBulkPending(true);
    try {
      const response = await fetch('/api/forms/instances/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instanceIds: Array.from(selectedInstanceIds),
          action: bulkAction,
          reviewerNotes: bulkNotes.trim() || null,
        }),
      });
      const body = (await response.json().catch(() => null)) as {
        summary?: { succeeded: number; failed: number };
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Bulk action failed.');
      }
      const s = body?.summary;
      if (s) {
        success(`Bulk ${bulkAction}: ${s.succeeded} succeeded${s.failed > 0 ? `, ${s.failed} failed` : ''}.`);
      }
      setSelectedInstanceIds(new Set());
      setBulkAction('');
      setBulkNotes('');
      await fetchInstances();
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Bulk action failed.');
    } finally {
      setBulkPending(false);
    }
  }, [bulkAction, bulkNotes, fetchInstances, selectedInstanceIds, showError, success]);

  // Debounce template search — trigger fetch after 300ms of inactivity
  useEffect(() => {
    if (!showTemplates) return;
    const timer = setTimeout(() => {
      void fetchTemplates();
    }, templateSearch ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateSearch]);

  useEffect(() => {
    if (!templateSearch) {
      void fetchTemplates();
    }
  }, [fetchTemplates, templateSearch]);

  useEffect(() => {
    void fetchInstances();
  }, [fetchInstances]);

  useEffect(() => {
    void fetchOrganizations();
  }, [fetchOrganizations]);

  useEffect(() => {
    void fetchCoverageZones();
  }, [fetchCoverageZones]);

  useEffect(() => {
    if (showAnalytics && canReview) {
      void fetchAnalytics();
    }
  }, [canReview, fetchAnalytics, showAnalytics]);

  useEffect(() => {
    if (!selectedInstanceId) {
      setSelectedInstance(null);
      setTimeline([]);
      return;
    }
    void fetchInstanceDetail(selectedInstanceId);
    void fetchTimeline(selectedInstanceId);
  }, [fetchInstanceDetail, fetchTimeline, selectedInstanceId]);

  const handleTemplateDraftChange = useCallback(
    (key: keyof FormTemplateDraft, value: FormTemplateDraft[keyof FormTemplateDraft]) => {
      setTemplateDraft((current) => {
        const next = { ...current, [key]: value };
        if (key === 'title' && !current.slug) {
          next.slug = slugify(String(value));
        }
        return next;
      });
    },
    [],
  );

  const handleCreateTemplate = useCallback(async () => {
    setTemplateFormPending(true);
    setTemplateFormError(null);
    try {
      const schemaJson = parseJsonObject(templateDraft.schemaJsonText, 'Schema JSON');
      const uiSchemaJson = parseJsonObject(templateDraft.uiSchemaJsonText, 'UI schema JSON');
      const schemaWithRouting = {
        ...schemaJson,
        routing: {
          ...readObject(schemaJson.routing),
          defaultRecipientRole: templateDraft.default_target_role || undefined,
          autoAssignUserId: templateDraft.auto_assign_user_id.trim() || undefined,
          defaultPriority: Number(templateDraft.default_priority),
          slaReviewHours: templateDraft.sla_review_hours.trim() ? Number(templateDraft.sla_review_hours) : undefined,
          attachmentsEnabled: templateDraft.attachments_enabled,
          emailConfirmation: templateDraft.email_confirmation,
          autoQueueForReview: templateDraft.auto_queue_for_review,
        },
      };
      const response = await fetch('/api/forms/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: templateDraft.slug.trim(),
          title: templateDraft.title.trim(),
          description: templateDraft.description.trim() || null,
          category: templateDraft.category.trim() || 'general',
          audience_scope: templateDraft.audience_scope,
          storage_scope: templateDraft.storage_scope,
          default_target_role: templateDraft.default_target_role || null,
          schema_json: schemaWithRouting,
          ui_schema_json: uiSchemaJson,
          instructions_markdown: templateDraft.instructions_markdown.trim() || null,
          is_published: templateDraft.is_published,
        }),
      });
      const body = (await response.json().catch(() => null)) as { template?: FormTemplate; error?: string } | null;
      if (!response.ok || !body?.template) {
        throw new Error(body?.error ?? 'Failed to create form template.');
      }
      success('Form template created.');
      setShowTemplateForm(false);
      setTemplateDraft(EMPTY_TEMPLATE_DRAFT);
      await fetchTemplates();
      setSelectedTemplateId(body.template.id);
    } catch (submitError) {
      setTemplateFormError(submitError instanceof Error ? submitError.message : 'Failed to create form template.');
    } finally {
      setTemplateFormPending(false);
    }
  }, [fetchTemplates, success, templateDraft]);

  const handleStartInstance = useCallback(async () => {
    if (!selectedTemplate) {
      return;
    }
    if (selectedTemplate.storage_scope === 'community') {
      if (!selectedCoverageZoneId) {
        showError('Choose the coverage zone that should receive this form before starting it.');
        return;
      }
    }
    if (selectedTemplate.storage_scope === 'organization' && !selectedOwnerOrganizationId) {
      showError('Choose the organization that should own this form before starting it.');
      return;
    }

    setInstanceActionPending('create');
    try {
      const response = await fetch('/api/forms/instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          ownerOrganizationId:
            selectedTemplate.storage_scope === 'organization' ? selectedOwnerOrganizationId || null : null,
          coverageZoneId:
            selectedTemplate.storage_scope === 'community' ? selectedCoverageZoneId || null : null,
          title: selectedTemplate.title,
          formData: buildInitialFormData(selectedTemplate),
        }),
      });
      const body = (await response.json().catch(() => null)) as { instance?: FormInstance; error?: string } | null;
      if (!response.ok || !body?.instance) {
        throw new Error(body?.error ?? 'Failed to start form.');
      }
      success('Managed form started.');
      await fetchInstances();
      setSelectedInstanceId(body.instance.id);
    } catch (submitError) {
      showError(submitError instanceof Error ? submitError.message : 'Failed to start form.');
    } finally {
      setInstanceActionPending(null);
    }
  }, [fetchInstances, selectedCoverageZoneId, selectedOwnerOrganizationId, selectedTemplate, showError, success]);

  const updateDraftField = useCallback((fieldKey: string, value: unknown) => {
    setDraftFormData((current) => {
      const next = { ...current, [fieldKey]: value };
      setRawFormData(JSON.stringify(next, null, 2));
      return next;
    });
  }, []);

  const handleRawFormDataChange = useCallback((value: string) => {
    setRawFormData(value);
    try {
      const parsed = JSON.parse(value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error();
      }
      setDraftFormData(parsed as Record<string, unknown>);
      setRawFormDataError(null);
    } catch {
      setRawFormDataError('Form payload must be valid JSON object syntax before it can be saved.');
    }
  }, []);

  const handleInstanceAction = useCallback(async (action: 'save' | 'submit' | 'start_review' | 'approve' | 'deny' | 'return' | 'archive' | 'withdraw') => {
    if (!selectedInstanceId) {
      return;
    }
    if (rawFormDataError) {
      showError(rawFormDataError);
      return;
    }

    // Validate on submit
    if (action === 'submit' && fieldSpecs.length > 0) {
      const errors = validateFormData(fieldSpecs, draftFormData, visibleFieldKeys);
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) {
        showError(`Please fix ${Object.keys(errors).length} field error(s) before submitting.`);
        return;
      }
    }

    setInstanceActionPending(action);
    try {
      const response = await fetch(`/api/forms/instances/${selectedInstanceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          title: draftTitle.trim() || null,
          notes: draftNotes.trim() || null,
          formData: draftFormData,
          recipientRole: draftRecipientRole || null,
          recipientUserId: draftRecipientUserId.trim() || null,
          recipientOrganizationId: draftRecipientOrganizationId.trim() || null,
          reviewerNotes: reviewerNotes.trim() || null,
        }),
      });
      const body = (await response.json().catch(() => null)) as { instance?: FormInstance; error?: string } | null;
      if (!response.ok || !body?.instance) {
        throw new Error(body?.error ?? 'Failed to update managed form.');
      }
      applyInstanceState(body.instance);
      setFieldErrors({});
      await fetchInstances();
      void fetchTimeline(selectedInstanceId);
      const queuedForReview = body.instance.status === 'needs_review' || body.instance.status === 'under_review';
      const messageMap: Record<typeof action, string> = {
        save: 'Draft saved.',
        submit: queuedForReview ? 'Form submitted for review.' : 'Form submitted and awaiting reviewer pickup.',
        start_review: 'Review started.',
        approve: 'Form approved.',
        deny: 'Form denied.',
        return: 'Form returned to submitter.',
        archive: 'Form archived.',
        withdraw: 'Form withdrawn.',
      };
      success(messageMap[action]);
      if (action === 'submit') {
        setShowConfirmation({
          reference: generateFormReference(body.instance.submission_id),
          queuedForReview,
        });
      }
    } catch (submitError) {
      showError(submitError instanceof Error ? submitError.message : 'Failed to update managed form.');
    } finally {
      setInstanceActionPending(null);
    }
  }, [applyInstanceState, draftFormData, draftNotes, draftRecipientOrganizationId, draftRecipientRole, draftRecipientUserId, draftTitle, fetchInstances, fetchTimeline, fieldSpecs, rawFormDataError, reviewerNotes, selectedInstanceId, showError, success, visibleFieldKeys]);

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        <PageHeader
          eyebrow={copy.eyebrow}
          title={copy.title}
          icon={<ClipboardList className="h-6 w-6 text-blue-600" aria-hidden="true" />}
          subtitle={copy.subtitle}
          badges={(
            <>
              <PageHeaderBadge tone="trust">Submission-backed storage</PageHeaderBadge>
              <PageHeaderBadge tone="accent">Draft, review, return, and reopen stay in app</PageHeaderBadge>
              <PageHeaderBadge>
                {instancesData ? `${instancesData.total} accessible form${instancesData.total === 1 ? '' : 's'}` : 'Loading forms'}
              </PageHeaderBadge>
            </>
          )}
          actions={(
            <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => {
              void fetchTemplates();
              void fetchInstances();
            }}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </Button>
          )}
        />

        <div className={`grid gap-6 ${showTemplates ? 'xl:grid-cols-[1.1fr_1fr_1.4fr]' : 'xl:grid-cols-[1fr_1.6fr]'}`}>
          {showTemplates ? (
            <FormSection
              title={canCreateTemplates ? 'Form templates' : 'Available templates'}
              description={
                canCreateTemplates
                  ? 'Publish the schemas that drive host and reviewer workflows.'
                  : 'Choose an approved form template and launch a submission-backed draft.'
              }
              action={
                canCreateTemplates ? (
                  <Button type="button" size="sm" className="gap-1" onClick={() => setShowTemplateForm((current) => !current)}>
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {showTemplateForm ? 'Close' : 'New template'}
                  </Button>
                ) : undefined
              }
            >
              {templatesError ? <FormAlert variant="error" message={templatesError} /> : null}

              {showTemplateForm ? (
                <FormSection
                  title="Create managed form template"
                  description="Define the fillable schema, instructions, audience, and storage scope used by the in-app form vault."
                  className="border-blue-100 bg-blue-50 shadow-none"
                >
                  {templateFormError ? <FormAlert variant="error" message={templateFormError} /> : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Title" id="managed-form-template-title" required>
                      <input
                        type="text"
                        value={templateDraft.title}
                        onChange={(event) => handleTemplateDraftChange('title', event.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      />
                    </FormField>
                    <FormField label="Slug" id="managed-form-template-slug" required hint="Lowercase and hyphenated.">
                      <input
                        type="text"
                        value={templateDraft.slug}
                        onChange={(event) => handleTemplateDraftChange('slug', event.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      />
                    </FormField>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <FormField label="Audience" id="managed-form-template-audience">
                      <select
                        value={templateDraft.audience_scope}
                        onChange={(event) => handleTemplateDraftChange('audience_scope', event.target.value as FormTemplateAudience)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      >
                        {FORM_TEMPLATE_AUDIENCES.map((audience) => (
                          <option key={audience} value={audience}>{audience.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Storage scope" id="managed-form-template-storage">
                      <select
                        value={templateDraft.storage_scope}
                        onChange={(event) => handleTemplateDraftChange('storage_scope', event.target.value as FormStorageScope)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      >
                        {FORM_STORAGE_SCOPES.map((scope) => (
                          <option key={scope} value={scope}>{scope.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Default reviewer role" id="managed-form-template-recipient">
                      <select
                        value={templateDraft.default_target_role}
                        onChange={(event) => handleTemplateDraftChange('default_target_role', event.target.value as FormRecipientRole | '')}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">None</option>
                        {FORM_RECIPIENT_ROLES.map((role) => (
                          <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>

                  <FormField label="Category" id="managed-form-template-category">
                    <input
                      type="text"
                      value={templateDraft.category}
                      onChange={(event) => handleTemplateDraftChange('category', event.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    />
                  </FormField>

                  <FormField label="Description" id="managed-form-template-description">
                    <textarea
                      rows={3}
                      value={templateDraft.description}
                      onChange={(event) => handleTemplateDraftChange('description', event.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    />
                  </FormField>

                  <FormField label="Instructions" id="managed-form-template-instructions">
                    <textarea
                      rows={5}
                      value={templateDraft.instructions_markdown}
                      onChange={(event) => handleTemplateDraftChange('instructions_markdown', event.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                    />
                  </FormField>

                  <div className="grid gap-4 md:grid-cols-3">
                    <FormField label="Default priority" id="managed-form-template-priority" hint="Higher priority forms rise in reviewer queues.">
                      <select
                        value={templateDraft.default_priority}
                        onChange={(event) => handleTemplateDraftChange('default_priority', event.target.value as FormTemplateDraft['default_priority'])}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="0">Standard</option>
                        <option value="1">Elevated</option>
                        <option value="2">High</option>
                        <option value="3">Critical</option>
                      </select>
                    </FormField>
                    <FormField label="Review SLA hours" id="managed-form-template-sla" hint="Used when the form reaches review.">
                      <input
                        type="number"
                        min={1}
                        value={templateDraft.sla_review_hours}
                        onChange={(event) => handleTemplateDraftChange('sla_review_hours', event.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      />
                    </FormField>
                    <FormField label="Auto-assign reviewer user ID" id="managed-form-template-auto-assign" hint="Optional direct-to-person routing.">
                      <input
                        type="text"
                        value={templateDraft.auto_assign_user_id}
                        onChange={(event) => handleTemplateDraftChange('auto_assign_user_id', event.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      />
                    </FormField>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={templateDraft.auto_queue_for_review}
                        onChange={(event) => handleTemplateDraftChange('auto_queue_for_review', event.target.checked)}
                      />
                      Auto-queue for review
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={templateDraft.attachments_enabled}
                        onChange={(event) => handleTemplateDraftChange('attachments_enabled', event.target.checked)}
                      />
                      Attachments enabled
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={templateDraft.email_confirmation}
                        onChange={(event) => handleTemplateDraftChange('email_confirmation', event.target.checked)}
                      />
                      Email confirmation on submit
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Schema JSON" id="managed-form-template-schema" hint="Supports `fields` arrays or JSON Schema-like `properties`.">
                      <textarea
                        rows={12}
                        value={templateDraft.schemaJsonText}
                        onChange={(event) => handleTemplateDraftChange('schemaJsonText', event.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                      />
                    </FormField>
                    <FormField label="UI schema JSON" id="managed-form-template-ui-schema">
                      <textarea
                        rows={12}
                        value={templateDraft.uiSchemaJsonText}
                        onChange={(event) => handleTemplateDraftChange('uiSchemaJsonText', event.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                      />
                    </FormField>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={templateDraft.is_published}
                      onChange={(event) => handleTemplateDraftChange('is_published', event.target.checked)}
                    />
                    Publish immediately
                  </label>

                  <div className="flex items-center gap-2">
                    <Button type="button" onClick={() => void handleCreateTemplate()} disabled={templateFormPending} className="gap-1">
                      {templateFormPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                      Create template
                    </Button>
                    <Button type="button" variant="outline" onClick={() => {
                      setShowTemplateForm(false);
                      setTemplateFormError(null);
                    }}>
                      Cancel
                    </Button>
                  </div>
                </FormSection>
              ) : null}

              {showTemplates ? (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
                  <input
                    type="text"
                    placeholder="Search templates..."
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-300"
                  />
                </div>
              ) : null}

              {templatesLoading ? (
                <p className="text-sm text-gray-500">Loading form templates...</p>
              ) : templatesData?.templates.length ? (
                <div className="space-y-3">
                  {templatesData.templates.map((template) => {
                    const routing = extractRoutingConfig(readObject(template.schema_json), template);
                    const isSelected = template.id === selectedTemplateId;
                    return (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                          isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{template.title}</p>
                            <p className="mt-1 text-xs text-gray-500">{template.slug}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{template.category}</span>
                            {template.is_published ? (
                              <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-800">Published</span>
                            ) : (
                              <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-800">Draft</span>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 text-sm text-gray-600">{template.description ?? 'No operator description.'}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          <span>Audience: {template.audience_scope.replace(/_/g, ' ')}</span>
                          <span>Storage: {template.storage_scope.replace(/_/g, ' ')}</span>
                          {template.default_target_role ? <span>Reviewer: {template.default_target_role.replace(/_/g, ' ')}</span> : null}
                          <span>Priority: {FORM_PRIORITY_LABELS[routing.defaultPriority ?? 0]}</span>
                          {routing.slaReviewHours ? <span>SLA: {routing.slaReviewHours}h</span> : null}
                          {canCreateTemplates && (
                            <>
                              <span
                                role="button"
                                tabIndex={0}
                                className="ml-auto inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  startEditingTemplate(template);
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); startEditingTemplate(template); } }}
                              >
                                <Settings className="h-3 w-3" aria-hidden="true" />
                                Edit
                              </span>
                              <span
                                role="button"
                                tabIndex={0}
                                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 hover:bg-blue-100 transition-colors cursor-pointer"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleDuplicateTemplate(template.id, template.slug);
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void handleDuplicateTemplate(template.id, template.slug); } }}
                              >
                                {duplicatePending === template.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Copy className="h-3 w-3" aria-hidden="true" />}
                                Duplicate
                              </span>
                            </>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyPanel
                  title="No templates visible"
                  body={canCreateTemplates ? 'Create the first managed form template to activate the vault.' : 'No published templates are currently available for this portal scope.'}
                />
              )}

              {editingTemplateId && canCreateTemplates ? (
                <FormSection
                  title="Edit template"
                  description="Modify template properties. Schema changes bump the version number."
                  className="border-amber-100 bg-amber-50 shadow-none"
                >
                  {editError ? <FormAlert variant="error" message={editError} /> : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Title" id="edit-template-title" required>
                      <input type="text" value={editDraft.title} onChange={(e) => handleEditDraftChange('title', e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
                    </FormField>
                    <FormField label="Slug" id="edit-template-slug">
                      <input type="text" value={editDraft.slug} disabled className="w-full rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-500 cursor-not-allowed" />
                    </FormField>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <FormField label="Audience" id="edit-template-audience">
                      <select value={editDraft.audience_scope} onChange={(e) => handleEditDraftChange('audience_scope', e.target.value as FormTemplateAudience)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                        {FORM_TEMPLATE_AUDIENCES.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Storage scope" id="edit-template-storage">
                      <select value={editDraft.storage_scope} onChange={(e) => handleEditDraftChange('storage_scope', e.target.value as FormStorageScope)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                        {FORM_STORAGE_SCOPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Default reviewer role" id="edit-template-recipient">
                      <select value={editDraft.default_target_role} onChange={(e) => handleEditDraftChange('default_target_role', e.target.value as FormRecipientRole | '')} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                        <option value="">None</option>
                        {FORM_RECIPIENT_ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                      </select>
                    </FormField>
                  </div>

                  <FormField label="Category" id="edit-template-category">
                    <input type="text" value={editDraft.category} onChange={(e) => handleEditDraftChange('category', e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
                  </FormField>
                  <FormField label="Description" id="edit-template-description">
                    <textarea rows={3} value={editDraft.description} onChange={(e) => handleEditDraftChange('description', e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
                  </FormField>
                  <FormField label="Instructions" id="edit-template-instructions">
                    <textarea rows={5} value={editDraft.instructions_markdown} onChange={(e) => handleEditDraftChange('instructions_markdown', e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
                  </FormField>

                  <div className="grid gap-4 md:grid-cols-3">
                    <FormField label="Default priority" id="edit-template-priority">
                      <select value={editDraft.default_priority} onChange={(e) => handleEditDraftChange('default_priority', e.target.value as FormTemplateDraft['default_priority'])} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                        <option value="0">Standard</option>
                        <option value="1">Elevated</option>
                        <option value="2">High</option>
                        <option value="3">Critical</option>
                      </select>
                    </FormField>
                    <FormField label="Review SLA hours" id="edit-template-sla">
                      <input type="number" min={1} value={editDraft.sla_review_hours} onChange={(e) => handleEditDraftChange('sla_review_hours', e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
                    </FormField>
                    <FormField label="Auto-assign user ID" id="edit-template-auto-assign">
                      <input type="text" value={editDraft.auto_assign_user_id} onChange={(e) => handleEditDraftChange('auto_assign_user_id', e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" />
                    </FormField>
                  </div>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={editDraft.auto_queue_for_review} onChange={(e) => handleEditDraftChange('auto_queue_for_review', e.target.checked)} />
                      Auto-queue for review
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={editDraft.attachments_enabled} onChange={(e) => handleEditDraftChange('attachments_enabled', e.target.checked)} />
                      Attachments enabled
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-700">
                      <input type="checkbox" checked={editDraft.email_confirmation} onChange={(e) => handleEditDraftChange('email_confirmation', e.target.checked)} />
                      Email confirmation
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Schema JSON" id="edit-template-schema">
                      <textarea rows={12} value={editDraft.schemaJsonText} onChange={(e) => handleEditDraftChange('schemaJsonText', e.target.value)} className="w-full rounded-lg border border-gray-300 bg-slate-950 px-3 py-2 text-xs text-slate-100" />
                    </FormField>
                    <FormField label="UI schema JSON" id="edit-template-ui-schema">
                      <textarea rows={12} value={editDraft.uiSchemaJsonText} onChange={(e) => handleEditDraftChange('uiSchemaJsonText', e.target.value)} className="w-full rounded-lg border border-gray-300 bg-slate-950 px-3 py-2 text-xs text-slate-100" />
                    </FormField>
                  </div>

                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={editDraft.is_published} onChange={(e) => handleEditDraftChange('is_published', e.target.checked)} />
                    Published
                  </label>

                  <div className="flex items-center gap-2">
                    <Button type="button" onClick={() => void handleUpdateTemplate()} disabled={editPending} className="gap-1">
                      {editPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                      Save changes
                    </Button>
                    <Button type="button" variant="outline" onClick={() => { setEditingTemplateId(null); setEditError(null); }}>
                      Cancel
                    </Button>
                  </div>
                </FormSection>
              ) : null}
            </FormSection>
          ) : null}

          <FormSection
            title={canReview ? 'Form queue' : 'Your forms'}
            description={
              canReview
                ? 'Track the submission-backed forms currently routed through your review scope.'
                : 'Continue drafts, resubmit returned work, and monitor review outcomes.'
            }
            action={
              canReview ? (
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setShowAnalytics((v) => !v)}>
                    <BarChart3 className="h-4 w-4" aria-hidden="true" />
                    {showAnalytics ? 'Hide analytics' : 'Analytics'}
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1" disabled={exportPending} onClick={() => void handleExport('csv')}>
                    {exportPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                    CSV
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1" disabled={exportPending} onClick={() => void handleExport('json')}>
                    {exportPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                    JSON
                  </Button>
                </div>
              ) : undefined
            }
          >
            {/* ── Analytics Dashboard ────────────────── */}
            {showAnalytics && canReview && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">Form Analytics</p>
                  <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => void fetchAnalytics()}>
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    Refresh
                  </Button>
                </div>
                {analyticsLoading ? (
                  <p className="text-sm text-gray-500">Loading analytics...</p>
                ) : analytics ? (
                  <>
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                        <p className="text-xs font-medium text-gray-500">Total Instances</p>
                        <p className="text-lg font-bold text-gray-900">{analytics.totalInstances}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                        <p className="text-xs font-medium text-gray-500">Avg Review Time</p>
                        <p className="text-lg font-bold text-gray-900">{analytics.avgTimeToReview != null ? `${analytics.avgTimeToReview.toFixed(1)}h` : '—'}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                        <p className="text-xs font-medium text-gray-500">Avg Resolve Time</p>
                        <p className="text-lg font-bold text-gray-900">{analytics.avgTimeToResolve != null ? `${analytics.avgTimeToResolve.toFixed(1)}h` : '—'}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                        <p className="text-xs font-medium text-gray-500">SLA Compliance</p>
                        <p className={`text-lg font-bold ${analytics.slaComplianceRate != null && analytics.slaComplianceRate < 0.8 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {analytics.slaComplianceRate != null ? `${(analytics.slaComplianceRate * 100).toFixed(0)}%` : '—'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {Object.entries(analytics.byStatus).map(([status, count]) => (
                        <span key={status} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-800'}`}>
                          {status.replace(/_/g, ' ')} <span className="font-bold">{count}</span>
                        </span>
                      ))}
                    </div>
                    {analytics.overdueCount > 0 && (
                      <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                        <span className="font-bold">{analytics.overdueCount}</span> form{analytics.overdueCount === 1 ? '' : 's'} past SLA deadline
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-gray-500">No analytics data available.</p>
                )}
              </div>
            )}

            <div className="flex items-center gap-3">
              <FormField label="Status filter" id={`${portal}-form-status-filter`} className="flex-1">
                <select
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
              <FormField label="Priority" id={`${portal}-form-priority-filter`} className="flex-1">
                <select
                  value={priorityFilter}
                  onChange={(event) => setPriorityFilter(event.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                >
                  {PRIORITY_FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </FormField>
              <Button type="button" variant="outline" size="sm" className="gap-1 self-end" onClick={() => void fetchInstances()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Reload
              </Button>
            </div>

            {instancesError ? <FormAlert variant="error" message={instancesError} /> : null}

            {/* ── Bulk Actions Toolbar ────────────────── */}
            {canReview && selectedInstanceIds.size > 0 && (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-indigo-900">
                    {selectedInstanceIds.size} form{selectedInstanceIds.size === 1 ? '' : 's'} selected
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedInstanceIds(new Set())}>
                    Clear selection
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={bulkAction}
                    onChange={(e) => setBulkAction(e.target.value as typeof bulkAction)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
                  >
                    <option value="">Choose action...</option>
                    <option value="approve">Approve all</option>
                    <option value="deny">Deny all</option>
                    <option value="return">Return all</option>
                  </select>
                  {(bulkAction === 'deny' || bulkAction === 'return') && (
                    <input
                      type="text"
                      placeholder="Reviewer notes (required)"
                      value={bulkNotes}
                      onChange={(e) => setBulkNotes(e.target.value)}
                      className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
                    />
                  )}
                  <Button
                    type="button"
                    size="sm"
                    className="gap-1"
                    disabled={!bulkAction || bulkPending || ((bulkAction === 'deny' || bulkAction === 'return') && !bulkNotes.trim())}
                    onClick={() => void handleBulkAction()}
                  >
                    {bulkPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckSquare className="h-4 w-4" aria-hidden="true" />}
                    Apply
                  </Button>
                </div>
              </div>
            )}

            {instancesLoading ? (
              <p className="text-sm text-gray-500">Loading managed forms...</p>
            ) : filteredInstances.length ? (
              <div className="space-y-3">
                {canReview && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    {selectedInstanceIds.size > 0 && selectedInstanceIds.size === filteredInstances.filter((i) => ['needs_review', 'under_review'].includes(i.status)).length
                      ? <CheckSquare className="h-4 w-4 text-blue-600" aria-hidden="true" />
                      : <Square className="h-4 w-4" aria-hidden="true" />}
                    Select all reviewable
                  </button>
                )}
                {filteredInstances.map((instance) => {
                  const isSelected = instance.id === selectedInstanceId;
                  const isChecked = selectedInstanceIds.has(instance.id);
                  const isReviewable = ['needs_review', 'under_review'].includes(instance.status);
                  const instanceSla = formatSlaRemaining(instance.sla_deadline ?? null);
                  return (
                    <div key={instance.id} className="flex items-start gap-2">
                      {canReview && isReviewable && (
                        <button
                          type="button"
                          className="mt-3 flex-shrink-0"
                          onClick={() => toggleInstanceSelection(instance.id)}
                          aria-label={isChecked ? 'Deselect form' : 'Select form'}
                        >
                          {isChecked
                            ? <CheckSquare className="h-5 w-5 text-blue-600" aria-hidden="true" />
                            : <Square className="h-5 w-5 text-gray-400" aria-hidden="true" />}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSelectedInstanceId(instance.id)}
                        className={`flex-1 rounded-xl border px-4 py-3 text-left transition-colors ${
                          isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-200 hover:bg-gray-50'
                        }`}
                      >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{instance.title ?? instance.template_title}</p>
                          <p className="mt-1 text-xs text-gray-500">{instance.template_title}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {instance.priority > 0 && (
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${FORM_PRIORITY_STYLES[instance.priority]}`}>
                              {FORM_PRIORITY_LABELS[instance.priority]}
                            </span>
                          )}
                          {renderStatusBadge(instance.status)}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500">
                        <span>Updated {formatDateTime(instance.updated_at)}</span>
                        {instance.recipient_role ? <span>Recipient {instance.recipient_role.replace(/_/g, ' ')}</span> : null}
                        {instance.owner_organization_id ? <span>Org scoped</span> : null}
                        {instance.sla_deadline && !['approved', 'denied', 'withdrawn', 'archived'].includes(instance.status) && (
                          <span className={instanceSla.urgency === 'breached' ? 'font-semibold text-red-600' : instanceSla.urgency === 'warning' ? 'font-semibold text-amber-600' : ''}>
                            {instanceSla.label}
                          </span>
                        )}
                        <span className="font-mono text-gray-400">{generateFormReference(instance.submission_id)}</span>
                      </div>
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyPanel
                title="No forms in this view"
                body={canReview ? 'Nothing in the current review slice. Adjust the status filter or wait for new submissions.' : 'Start a form from the template library to create the first submission-backed draft.'}
              />
            )}
          </FormSection>

          <div className="space-y-6">
            {detailError ? <FormAlert variant="error" message={detailError} /> : null}

            {!selectedInstance && selectedTemplate && canCreateInstances ? (
              <FormSection
                title="Start managed form"
                description="Create a draft instance from this template. The draft will stay in app and can later be submitted into review."
              >
                <div className="space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{selectedTemplate.title}</p>
                    <p className="mt-1 text-sm text-gray-600">{selectedTemplate.description ?? 'No template description.'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                    <span>Audience: {selectedTemplate.audience_scope.replace(/_/g, ' ')}</span>
                    <span>Storage: {selectedTemplate.storage_scope.replace(/_/g, ' ')}</span>
                    {selectedTemplate.default_target_role ? <span>Default reviewer: {selectedTemplate.default_target_role.replace(/_/g, ' ')}</span> : null}
                    {selectedTemplateRouting ? <span>Priority: {FORM_PRIORITY_LABELS[selectedTemplateRouting.defaultPriority ?? 0]}</span> : null}
                    {selectedTemplateRouting?.slaReviewHours ? <span>Review target: {selectedTemplateRouting.slaReviewHours}h</span> : null}
                  </div>
                  {instructions ? (
                    <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-3 text-sm whitespace-pre-wrap text-blue-900">
                      {instructions}
                    </div>
                  ) : null}
                  {selectedTemplateRouting ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Who Receives It</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">
                          {selectedTemplateRouting.defaultRecipientRole.replace(/_/g, ' ')}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {selectedTemplateRouting.autoAssignUserId ? `Auto-assigned to ${selectedTemplateRouting.autoAssignUserId}` : 'Routed by role unless the submitter overrides it.'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Priority</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">
                          {FORM_PRIORITY_LABELS[selectedTemplateRouting.defaultPriority ?? 0]}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">Used to lift the form inside reviewer queues and escalation views.</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Timer</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">
                          {selectedTemplateRouting.slaReviewHours ? `${selectedTemplateRouting.slaReviewHours}h review target` : 'Platform SLA lookup'}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {selectedTemplateRouting.autoQueueForReview ? 'Queues directly into review after submit.' : 'Stops at submitted until a reviewer moves it forward.'}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {selectedTemplate.storage_scope === 'organization' ? (
                    <FormField label="Owning organization" id="managed-form-owner-organization" required>
                      <select
                        value={selectedOwnerOrganizationId}
                        onChange={(event) => setSelectedOwnerOrganizationId(event.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">Choose an organization</option>
                        {organizations.map((organization) => (
                          <option key={organization.id} value={organization.id}>{organization.name}</option>
                        ))}
                      </select>
                    </FormField>
                  ) : null}
                  {selectedTemplate.storage_scope === 'community' ? (
                    <>
                      <FormField label="Coverage zone" id="managed-form-coverage-zone" required>
                        <select
                          value={selectedCoverageZoneId}
                          onChange={(event) => setSelectedCoverageZoneId(event.target.value)}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                        >
                          <option value="">Choose a coverage zone</option>
                          {coverageZones.map((zone) => (
                            <option key={zone.id} value={zone.id}>{zone.name}</option>
                          ))}
                        </select>
                      </FormField>
                      {coverageZones.length === 0 ? (
                        <FormAlert
                          variant="warning"
                          message="No active coverage zones are available for community-scoped launches yet."
                        />
                      ) : null}
                    </>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      className="gap-1"
                      onClick={() => void handleStartInstance()}
                      disabled={instanceActionPending === 'create'}
                    >
                      {instanceActionPending === 'create' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                      Start draft
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setSelectedTemplateId(null)}>
                      Clear
                    </Button>
                  </div>
                </div>
              </FormSection>
            ) : null}

            {selectedInstance ? (
              <>
                <FormSection
                  title={selectedInstance.title ?? selectedInstance.template_title}
                  description="All managed-form content, routing metadata, and workflow state remain inside the ORAN form vault."
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${FORM_PRIORITY_STYLES[selectedInstance.priority]}`}>
                        {FORM_PRIORITY_LABELS[selectedInstance.priority]}
                      </span>
                      {renderStatusBadge(selectedInstance.status)}
                    </div>
                  }
                >
                  {detailLoading ? <p className="text-sm text-gray-500">Loading form details...</p> : null}

                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reference</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{formReference ?? 'Pending'}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">SLA</p>
                      <p className={`mt-1 text-sm font-semibold ${slaSummary.urgency === 'breached' ? 'text-red-700' : slaSummary.urgency === 'warning' ? 'text-amber-700' : 'text-gray-900'}`}>
                        {slaSummary.label}
                      </p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 md:col-span-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Next action</p>
                      <p className="mt-1 text-sm font-medium text-gray-900">{getNextActionSummary(selectedInstance)}</p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2 text-sm text-gray-700">
                      <p><span className="font-medium text-gray-900">Template:</span> {selectedInstance.template_title}</p>
                      <p><span className="font-medium text-gray-900">Storage scope:</span> {selectedInstance.storage_scope.replace(/_/g, ' ')}</p>
                      <p><span className="font-medium text-gray-900">Submitted by:</span> {selectedInstance.submitted_by_user_id}</p>
                      <p><span className="font-medium text-gray-900">Submitted at:</span> {formatDateTime(selectedInstance.submitted_at)}</p>
                      <p><span className="font-medium text-gray-900">Last updated:</span> {formatDateTime(selectedInstance.updated_at)}</p>
                    </div>
                    <div className="space-y-2 text-sm text-gray-700">
                      <p><span className="font-medium text-gray-900">Recipient role:</span> {selectedInstance.recipient_role ? selectedInstance.recipient_role.replace(/_/g, ' ') : 'Unassigned'}</p>
                      <p><span className="font-medium text-gray-900">Assigned reviewer:</span> {selectedInstance.assigned_to_user_id ?? 'Unassigned'}</p>
                      <p><span className="font-medium text-gray-900">Recipient user:</span> {selectedInstance.recipient_user_id ?? 'Unassigned'}</p>
                      <p><span className="font-medium text-gray-900">Recipient org:</span> {selectedInstance.recipient_organization_id ?? 'Unassigned'}</p>
                      <p><span className="font-medium text-gray-900">Blob prefix:</span> {selectedInstance.blob_storage_prefix ?? 'Not configured'}</p>
                    </div>
                  </div>

                  {selectedInstanceRouting ? (
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Routing default</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">{selectedInstanceRouting.defaultRecipientRole.replace(/_/g, ' ')}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Operational timer</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">
                          {selectedInstanceRouting.slaReviewHours ? `${selectedInstanceRouting.slaReviewHours}h target` : 'Platform SLA'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Queue behavior</p>
                        <p className="mt-1 text-sm font-medium text-gray-900">
                          {selectedInstanceRouting.autoQueueForReview ? 'Auto-queue on submit' : 'Manual queue step'}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {instructions ? (
                    <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm whitespace-pre-wrap text-blue-900">
                      {instructions}
                    </div>
                  ) : null}
                </FormSection>

                <FormSection
                  title={editable ? 'Edit form data' : 'Form payload'}
                  description={
                    editable
                      ? 'Draft edits stay inside the same managed-form instance until you submit for review.'
                      : 'This instance is no longer editable in its current workflow state.'
                  }
                >
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Display title" id="managed-form-instance-title">
                      <input
                        type="text"
                        value={draftTitle}
                        onChange={(event) => setDraftTitle(event.target.value)}
                        disabled={!editable}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
                      />
                    </FormField>
                    <FormField label="Recipient role" id="managed-form-instance-role">
                      <select
                        value={draftRecipientRole}
                        onChange={(event) => setDraftRecipientRole(event.target.value as FormRecipientRole | '')}
                        disabled={!editable}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
                      >
                        <option value="">Unassigned</option>
                        {FORM_RECIPIENT_ROLES.map((role) => (
                          <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    </FormField>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Recipient user ID" id="managed-form-instance-user-id">
                      <input
                        type="text"
                        value={draftRecipientUserId}
                        onChange={(event) => setDraftRecipientUserId(event.target.value)}
                        disabled={!editable}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
                      />
                    </FormField>
                    <FormField label="Recipient organization ID" id="managed-form-instance-org-id">
                      <input
                        type="text"
                        value={draftRecipientOrganizationId}
                        onChange={(event) => setDraftRecipientOrganizationId(event.target.value)}
                        disabled={!editable}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
                      />
                    </FormField>
                  </div>

                  <FormField label="Operator notes" id="managed-form-instance-notes">
                    <textarea
                      rows={3}
                      value={draftNotes}
                      onChange={(event) => setDraftNotes(event.target.value)}
                      disabled={!editable}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100"
                    />
                  </FormField>

                  {fieldSpecs.length > 0 ? (
                    <div className="space-y-6">
                      {sectionedFields.map((section, sectionIndex) => {
                        const sectionContent = (
                          <div className="grid gap-4 md:grid-cols-2">
                            {section.fields.map((field) => {
                              // Layout-only fields
                              if (field.type === 'heading') {
                                return (
                                  <div key={field.key} className="md:col-span-2 mt-2">
                                    <h4 className="text-sm font-bold text-gray-900">{field.label}</h4>
                                    {field.help && <p className="text-xs text-gray-500">{field.help}</p>}
                                  </div>
                                );
                              }
                              if (field.type === 'divider') {
                                return <hr key={field.key} className="md:col-span-2 border-gray-200" />;
                              }

                              const currentValue = draftFormData[field.key] ?? field.defaultValue ?? (field.type === 'checkbox' ? false : '');
                              const error = fieldErrors[field.key];
                              const colSpan = field.width === 'full' || field.type === 'textarea' ? 'md:col-span-2' : '';
                              const inputCls = `w-full rounded-lg border px-3 py-2 text-sm disabled:bg-gray-100 ${
                                error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'
                              }`;

                              if (field.type === 'checkbox') {
                                return (
                                  <FormField key={field.key} label={field.label} id={`managed-form-field-${field.key}`} hint={field.help} className={colSpan}>
                                    <label className={`flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm text-gray-700 ${error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'}`}>
                                      <input type="checkbox" checked={Boolean(currentValue)} onChange={(event) => updateDraftField(field.key, event.target.checked)} disabled={!editable} />
                                      {field.label}
                                    </label>
                                    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                                  </FormField>
                                );
                              }

                              if (field.type === 'select') {
                                return (
                                  <FormField key={field.key} label={field.label} id={`managed-form-field-${field.key}`} hint={field.help} className={colSpan}>
                                    <select value={typeof currentValue === 'string' ? currentValue : ''} onChange={(event) => updateDraftField(field.key, event.target.value)} disabled={!editable} className={inputCls}>
                                      <option value="">Select</option>
                                      {(field.options ?? []).map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                      ))}
                                    </select>
                                    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                                  </FormField>
                                );
                              }

                              if (field.type === 'multi_select') {
                                const selected = Array.isArray(currentValue) ? currentValue : [];
                                return (
                                  <FormField key={field.key} label={field.label} id={`managed-form-field-${field.key}`} hint={field.help} className={colSpan}>
                                    <div className={`rounded-lg border px-3 py-2 ${error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'}`}>
                                      {(field.options ?? []).map((option) => (
                                        <label key={option.value} className="flex items-center gap-2 py-1 text-sm text-gray-700">
                                          <input
                                            type="checkbox"
                                            checked={selected.includes(option.value)}
                                            disabled={!editable}
                                            onChange={(e) => {
                                              const next = e.target.checked ? [...selected, option.value] : selected.filter((v: unknown) => v !== option.value);
                                              updateDraftField(field.key, next);
                                            }}
                                          />
                                          {option.label}
                                        </label>
                                      ))}
                                    </div>
                                    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                                  </FormField>
                                );
                              }

                              if (field.type === 'radio') {
                                return (
                                  <FormField key={field.key} label={field.label} id={`managed-form-field-${field.key}`} hint={field.help} className={colSpan}>
                                    <div className={`rounded-lg border px-3 py-2 ${error ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white'}`}>
                                      {(field.options ?? []).map((option) => (
                                        <label key={option.value} className="flex items-center gap-2 py-1 text-sm text-gray-700">
                                          <input
                                            type="radio"
                                            name={`managed-form-field-${field.key}`}
                                            value={option.value}
                                            checked={currentValue === option.value}
                                            disabled={!editable}
                                            onChange={() => updateDraftField(field.key, option.value)}
                                          />
                                          {option.label}
                                        </label>
                                      ))}
                                    </div>
                                    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                                  </FormField>
                                );
                              }

                              if (field.type === 'textarea') {
                                return (
                                  <FormField key={field.key} label={field.label} id={`managed-form-field-${field.key}`} hint={field.help} className="md:col-span-2">
                                    <textarea rows={4} value={typeof currentValue === 'string' ? currentValue : JSON.stringify(currentValue, null, 2)} onChange={(event) => updateDraftField(field.key, event.target.value)} disabled={!editable} placeholder={field.placeholder} className={inputCls} />
                                    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                                  </FormField>
                                );
                              }

                              if (field.type === 'file') {
                                return (
                                  <FormField key={field.key} label={field.label} id={`managed-form-field-${field.key}`} hint={field.help ?? 'File uploads are handled by the ORAN blob storage layer.'} className={colSpan}>
                                    <input type="file" disabled={!editable} className="w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-blue-700" />
                                    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                                  </FormField>
                                );
                              }

                              // text, number, date, email, phone, url, currency → input with type
                              const htmlType: Record<string, string> = {
                                number: 'number', currency: 'number', date: 'date',
                                email: 'email', phone: 'tel', url: 'url', text: 'text',
                              };

                              return (
                                <FormField key={field.key} label={field.label} id={`managed-form-field-${field.key}`} hint={field.help} className={colSpan}>
                                  <input
                                    type={htmlType[field.type] ?? 'text'}
                                    value={field.type === 'number' || field.type === 'currency' ? String(currentValue ?? '') : typeof currentValue === 'string' ? currentValue : ''}
                                    onChange={(event) => updateDraftField(field.key, field.type === 'number' || field.type === 'currency' ? Number(event.target.value) : event.target.value)}
                                    disabled={!editable}
                                    placeholder={field.placeholder}
                                    className={inputCls}
                                  />
                                  {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
                                </FormField>
                              );
                            })}
                          </div>
                        );

                        if (section.name) {
                          return (
                            <div key={section.name} className="rounded-xl border border-gray-200 bg-gray-50/50 p-4 space-y-4">
                              <h3 className="text-sm font-bold text-gray-900 border-b border-gray-200 pb-2">{section.name}</h3>
                              {sectionContent}
                            </div>
                          );
                        }

                        return <React.Fragment key={`section-${String(sectionIndex)}`}>{sectionContent}</React.Fragment>;
                      })}
                    </div>
                  ) : (
                    <>
                      <FormField label="Form payload (JSON)" id="managed-form-json-payload" hint="Use JSON object syntax. This fallback editor is used when the template does not expose field metadata.">
                        <textarea
                          rows={12}
                          value={rawFormData}
                          onChange={(event) => handleRawFormDataChange(event.target.value)}
                          disabled={!editable}
                          className="w-full rounded-lg border border-gray-300 bg-slate-950 px-3 py-2 text-xs text-slate-100 disabled:bg-slate-800"
                        />
                      </FormField>
                      {rawFormDataError ? <FormAlert variant="error" message={rawFormDataError} /> : null}
                    </>
                  )}

                  {editable ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="gap-1"
                        onClick={() => void handleInstanceAction('save')}
                        disabled={Boolean(instanceActionPending)}
                      >
                        {instanceActionPending === 'save' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                        Save draft
                      </Button>
                      <Button
                        type="button"
                        className="gap-1"
                        onClick={() => void handleInstanceAction('submit')}
                        disabled={Boolean(instanceActionPending)}
                      >
                        {instanceActionPending === 'submit' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
                        Submit for review
                      </Button>
                    </div>
                  ) : null}
                </FormSection>

                {canReview ? (
                  <FormSection
                    title="Reviewer actions"
                    description="Reviewer notes stay on the same submission-backed record so approvals, denials, and returns remain auditable."
                  >
                    <FormField label="Reviewer notes" id="managed-form-reviewer-notes" hint="Required for deny and return actions.">
                      <textarea
                        rows={4}
                        value={reviewerNotes}
                        onChange={(event) => setReviewerNotes(event.target.value)}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                      />
                    </FormField>

                    <div className="flex flex-wrap items-center gap-2">
                      {['submitted', 'needs_review'].includes(selectedInstance.status) ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-1"
                          onClick={() => void handleInstanceAction('start_review')}
                          disabled={Boolean(instanceActionPending)}
                        >
                          {instanceActionPending === 'start_review' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PencilLine className="h-4 w-4" aria-hidden="true" />}
                          Start review
                        </Button>
                      ) : null}
                      {selectedInstance.status === 'under_review' ? (
                        <>
                          <Button
                            type="button"
                            className="gap-1"
                            onClick={() => void handleInstanceAction('approve')}
                            disabled={Boolean(instanceActionPending)}
                          >
                            {instanceActionPending === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                            Approve
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="gap-1"
                            onClick={() => void handleInstanceAction('return')}
                            disabled={Boolean(instanceActionPending)}
                          >
                            {instanceActionPending === 'return' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
                            Return
                          </Button>
                          <Button
                            type="button"
                            variant="destructive"
                            className="gap-1"
                            onClick={() => void handleInstanceAction('deny')}
                            disabled={Boolean(instanceActionPending)}
                          >
                            {instanceActionPending === 'deny' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldX className="h-4 w-4" aria-hidden="true" />}
                            Deny
                          </Button>
                        </>
                      ) : null}
                    </div>

                    {!['submitted', 'needs_review', 'under_review'].includes(selectedInstance.status) ? (
                      <FormAlert
                        variant="info"
                        message="This managed form is not currently in a reviewer-action state. Reviewer controls activate in submitted, needs_review, or under_review."
                      />
                    ) : null}
                  </FormSection>
                ) : null}

                {/* ── Lifecycle actions: archive / withdraw ── */}
                {selectedInstance && (
                  <>
                    {['draft', 'returned'].includes(selectedInstance.status) ? (
                      <FormSection
                        title="Withdraw form"
                        description="Withdraw this form to stop it from being reviewed. It can be archived afterwards."
                        className="border-gray-200 bg-gray-50 shadow-none"
                      >
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-1"
                          onClick={() => void handleInstanceAction('withdraw')}
                          disabled={Boolean(instanceActionPending)}
                        >
                          {instanceActionPending === 'withdraw' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <XCircle className="h-4 w-4" aria-hidden="true" />}
                          Withdraw
                        </Button>
                      </FormSection>
                    ) : null}

                    {['approved', 'denied', 'withdrawn', 'expired'].includes(selectedInstance.status) && canReview ? (
                      <FormSection
                        title="Archive form"
                        description="Move this completed form to the archive. Archived forms remain in the audit trail but are hidden from active queues."
                        className="border-gray-200 bg-gray-50 shadow-none"
                      >
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-1"
                          onClick={() => void handleInstanceAction('archive')}
                          disabled={Boolean(instanceActionPending)}
                        >
                          {instanceActionPending === 'archive' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
                          Archive
                        </Button>
                      </FormSection>
                    ) : null}
                  </>
                )}

                {/* ── Post-submit confirmation ─────────────── */}
                {showConfirmation && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                    <div className="flex items-start gap-3">
                      <ShieldCheck className="mt-0.5 h-5 w-5 text-emerald-600" aria-hidden="true" />
                      <div>
                        <p className="font-semibold text-emerald-900">Form submitted successfully</p>
                        <p className="mt-1 text-sm text-emerald-700">
                          Reference: <span className="font-mono font-semibold">{showConfirmation.reference}</span>.
                          {' '}
                          {showConfirmation.queuedForReview
                            ? 'Your form is now queued for review. You will be notified when a reviewer takes action.'
                            : 'Your form has been submitted and is awaiting reviewer pickup. You will be notified when a reviewer takes action.'}
                        </p>
                        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setShowConfirmation(null)}>
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Timeline / Audit trail ────────────────── */}
                <FormSection
                  title="Audit timeline"
                  description="Every status change is immutably recorded for compliance and operational visibility."
                >
                  {timelineLoading ? (
                    <p className="text-sm text-gray-500">Loading timeline...</p>
                  ) : timeline.length > 0 ? (
                    <ol className="relative border-l border-gray-200 ml-3 space-y-4">
                      {timeline.map((entry) => (
                        <li key={entry.id} className="ml-6">
                          <span className="absolute -left-2 flex h-4 w-4 items-center justify-center rounded-full bg-blue-100 ring-4 ring-white">
                            <span className="h-2 w-2 rounded-full bg-blue-600" />
                          </span>
                          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2">
                                {renderStatusBadge(entry.fromStatus)}
                                <span className="text-gray-400">→</span>
                                {renderStatusBadge(entry.toStatus)}
                              </div>
                              <time className="whitespace-nowrap text-gray-500">{formatDateTime(entry.timestamp)}</time>
                            </div>
                            {(entry.actorRole || entry.reason) && (
                              <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-600">
                                {entry.actorRole && <span>By: {entry.actorRole.replace(/_/g, ' ')}</span>}
                                {entry.reason && <span className="italic">{entry.reason}</span>}
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-sm text-gray-500">No status transitions recorded yet.</p>
                  )}
                </FormSection>
              </>
            ) : !selectedTemplate || !canCreateInstances ? (
              <EmptyPanel
                title="Select a managed form"
                body={
                  canCreateInstances
                    ? 'Choose a template or an existing instance to start working in the form vault.'
                    : 'Choose an accessible form instance from the queue to inspect its payload and workflow history.'
                }
              />
            ) : null}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}
