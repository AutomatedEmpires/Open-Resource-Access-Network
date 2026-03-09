export const DISCOVERY_NEED_IDS = [
  'food_assistance',
  'housing',
  'mental_health',
  'healthcare',
  'employment',
  'childcare',
  'transportation',
  'legal_aid',
  'utility_assistance',
  'substance_use',
  'domestic_violence',
  'education',
] as const;

export type DiscoveryNeedId = (typeof DISCOVERY_NEED_IDS)[number];

export interface DiscoveryNeedDefinition {
  id: DiscoveryNeedId;
  label: string;
  queryText: string;
  icon: string;
  profileColorClass: string;
  quickChip: boolean;
  aliases?: readonly string[];
}

const DISCOVERY_NEED_DEFINITIONS: Record<DiscoveryNeedId, Omit<DiscoveryNeedDefinition, 'id'>> = {
  food_assistance: {
    label: 'Food',
    queryText: 'food',
    icon: '🍎',
    profileColorClass: 'bg-green-50 border-green-200 text-green-800',
    quickChip: true,
    aliases: ['food assistance', 'food pantry', 'pantry'],
  },
  housing: {
    label: 'Housing',
    queryText: 'housing',
    icon: '🏠',
    profileColorClass: 'bg-blue-50 border-blue-200 text-blue-800',
    quickChip: true,
  },
  mental_health: {
    label: 'Mental Health',
    queryText: 'mental health',
    icon: '🧠',
    profileColorClass: 'bg-purple-50 border-purple-200 text-purple-800',
    quickChip: true,
    aliases: ['behavioral health'],
  },
  healthcare: {
    label: 'Healthcare',
    queryText: 'healthcare',
    icon: '🏥',
    profileColorClass: 'bg-red-50 border-red-200 text-red-800',
    quickChip: true,
    aliases: ['health care', 'medical'],
  },
  employment: {
    label: 'Employment',
    queryText: 'employment',
    icon: '💼',
    profileColorClass: 'bg-amber-50 border-amber-200 text-amber-800',
    quickChip: true,
    aliases: ['jobs', 'job training'],
  },
  childcare: {
    label: 'Childcare',
    queryText: 'childcare',
    icon: '👶',
    profileColorClass: 'bg-pink-50 border-pink-200 text-pink-800',
    quickChip: true,
    aliases: ['child care'],
  },
  transportation: {
    label: 'Transportation',
    queryText: 'transportation',
    icon: '🚌',
    profileColorClass: 'bg-cyan-50 border-cyan-200 text-cyan-800',
    quickChip: true,
    aliases: ['transit', 'ride'],
  },
  legal_aid: {
    label: 'Legal Aid',
    queryText: 'legal aid',
    icon: '⚖️',
    profileColorClass: 'bg-indigo-50 border-indigo-200 text-indigo-800',
    quickChip: true,
    aliases: ['legal', 'lawyer', 'attorney'],
  },
  utility_assistance: {
    label: 'Utilities',
    queryText: 'utility assistance',
    icon: '💡',
    profileColorClass: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    quickChip: false,
    aliases: ['utilities', 'energy assistance'],
  },
  substance_use: {
    label: 'Substance Use',
    queryText: 'substance use',
    icon: '🤝',
    profileColorClass: 'bg-teal-50 border-teal-200 text-teal-800',
    quickChip: false,
    aliases: ['addiction', 'recovery'],
  },
  domestic_violence: {
    label: 'Safety / DV',
    queryText: 'domestic violence',
    icon: '🛡️',
    profileColorClass: 'bg-orange-50 border-orange-200 text-orange-800',
    quickChip: false,
    aliases: ['dv', 'safety'],
  },
  education: {
    label: 'Education',
    queryText: 'education',
    icon: '📚',
    profileColorClass: 'bg-lime-50 border-lime-200 text-lime-800',
    quickChip: false,
    aliases: ['school', 'training'],
  },
};

export const DISCOVERY_NEEDS: readonly DiscoveryNeedDefinition[] = DISCOVERY_NEED_IDS.map((id) => ({
  id,
  ...DISCOVERY_NEED_DEFINITIONS[id],
}));

export const QUICK_DISCOVERY_NEEDS = DISCOVERY_NEEDS.filter((need) => need.quickChip);

function normalizeNeedKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
}

const DISCOVERY_NEED_BY_ID = new Map(
  DISCOVERY_NEEDS.map((need) => [need.id, need] as const),
);

const DISCOVERY_NEED_ALIAS_MAP = new Map<string, DiscoveryNeedId>();

for (const need of DISCOVERY_NEEDS) {
  const aliases = [
    need.id,
    need.label,
    need.queryText,
    ...(need.aliases ?? []),
  ];
  for (const alias of aliases) {
    DISCOVERY_NEED_ALIAS_MAP.set(normalizeNeedKey(alias), need.id);
  }
}

export function getDiscoveryNeed(id: DiscoveryNeedId | null | undefined): DiscoveryNeedDefinition | undefined {
  if (!id) return undefined;
  return DISCOVERY_NEED_BY_ID.get(id);
}

export function resolveDiscoveryNeedId(value: string | null | undefined): DiscoveryNeedId | null {
  if (!value) return null;
  return DISCOVERY_NEED_ALIAS_MAP.get(normalizeNeedKey(value)) ?? null;
}

export function getPrimaryDiscoveryNeedId(
  values: readonly (string | null | undefined)[] | null | undefined,
): DiscoveryNeedId | null {
  if (!values) return null;
  for (const value of values) {
    const resolved = resolveDiscoveryNeedId(value);
    if (resolved) return resolved;
  }
  return null;
}

export function getDiscoveryNeedSearchText(value: DiscoveryNeedId | string | null | undefined): string | undefined {
  const id = typeof value === 'string' ? resolveDiscoveryNeedId(value) ?? (DISCOVERY_NEED_BY_ID.has(value as DiscoveryNeedId) ? value as DiscoveryNeedId : null) : value;
  return id ? DISCOVERY_NEED_BY_ID.get(id)?.queryText : undefined;
}

export function getDiscoveryNeedLabel(value: DiscoveryNeedId | string | null | undefined): string | undefined {
  const id = typeof value === 'string' ? resolveDiscoveryNeedId(value) ?? (DISCOVERY_NEED_BY_ID.has(value as DiscoveryNeedId) ? value as DiscoveryNeedId : null) : value;
  return id ? DISCOVERY_NEED_BY_ID.get(id)?.label : undefined;
}

export function isDiscoveryNeedSearchText(
  needId: DiscoveryNeedId | null | undefined,
  query: string | null | undefined,
): boolean {
  if (!needId || !query) return false;
  return normalizeNeedKey(query) === normalizeNeedKey(getDiscoveryNeedSearchText(needId) ?? '');
}
