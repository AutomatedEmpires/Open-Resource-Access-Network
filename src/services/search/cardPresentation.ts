import type { Eligibility, Phone, Schedule } from '@/domain/types';

/** The first regional ORAN release serves the inland Pacific Northwest. */
export const ORAN_REGIONAL_TIME_ZONE = 'America/Los_Angeles';

const regionalDateFormatters = new Map<string, Intl.DateTimeFormat>();

export function getRegionalDateKey(
  value: Date = new Date(),
  timeZone: string = ORAN_REGIONAL_TIME_ZONE,
): string {
  let formatter = regionalDateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    regionalDateFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((entry) => entry.type === type)?.value
  );
  const year = part('year');
  const month = part('month');
  const day = part('day');

  if (!year || !month || !day) {
    return value.toISOString().slice(0, 10);
  }

  return `${year}-${month}-${day}`;
}

export function isCallablePhone(phone: Phone): boolean {
  return phone.type == null || phone.type === 'voice' || phone.type === 'hotline';
}

export function selectCallablePhone(phones: Phone[]): Phone | undefined {
  return phones.find(isCallablePhone);
}

/** Formats stored eligibility facts without deciding whether a person qualifies. */
export function formatStoredEligibilityCriterion(rule: Eligibility): string | null {
  const details: string[] = [];
  const description = rule.description?.trim();

  if (description) details.push(description);

  if (rule.minimumAge != null && rule.maximumAge != null) {
    details.push(`Ages ${rule.minimumAge}–${rule.maximumAge}`);
  } else if (rule.minimumAge != null) {
    details.push(`Age ${rule.minimumAge} or older`);
  } else if (rule.maximumAge != null) {
    details.push(`Age ${rule.maximumAge} or younger`);
  }

  if (rule.householdSizeMin != null && rule.householdSizeMax != null) {
    details.push(`Household of ${rule.householdSizeMin}–${rule.householdSizeMax}`);
  } else if (rule.householdSizeMin != null) {
    details.push(`Household of ${rule.householdSizeMin} or more`);
  } else if (rule.householdSizeMax != null) {
    details.push(`Household of up to ${rule.householdSizeMax}`);
  }

  const listedGroups = rule.eligibleValues
    ?.map((value) => value.trim())
    .filter(Boolean);
  if (listedGroups && listedGroups.length > 0) {
    details.push(`Listed groups: ${listedGroups.join(', ')}`);
  }

  return details.length > 0 ? details.join(' · ') : null;
}

const SCHEDULE_DAY_LABELS: Record<string, string> = {
  MO: 'Mon', MON: 'Mon', MONDAY: 'Mon',
  TU: 'Tue', TUE: 'Tue', TUES: 'Tue', TUESDAY: 'Tue',
  WE: 'Wed', WED: 'Wed', WEDNESDAY: 'Wed',
  TH: 'Thu', THU: 'Thu', THUR: 'Thu', THURS: 'Thu', THURSDAY: 'Thu',
  FR: 'Fri', FRI: 'Fri', FRIDAY: 'Fri',
  SA: 'Sat', SAT: 'Sat', SATURDAY: 'Sat',
  SU: 'Sun', SUN: 'Sun', SUNDAY: 'Sun',
};

const SCHEDULE_DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const SCHEDULE_DAY_RANK = new Map<string, number>(
  SCHEDULE_DAY_ORDER.map((day, index) => [day, index]),
);

function formatStoredClock(value: string | null | undefined): string | null {
  const stored = value?.trim();
  if (!stored) return null;

  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(stored);
  if (!match) return stored;

  const hour = Number(match[1]);
  const minute = match[2];
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
}

function normalizeScheduleDay(day: string): string | null {
  const stored = day.trim();
  return stored ? (SCHEDULE_DAY_LABELS[stored.toUpperCase()] ?? stored) : null;
}

function sortScheduleDays(days: Iterable<string>): string[] {
  return [...days].sort((left, right) => {
    const leftRank = SCHEDULE_DAY_RANK.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = SCHEDULE_DAY_RANK.get(right) ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank || left.localeCompare(right);
  });
}

function formatStoredTimes(schedule: Schedule): string | null {
  const opensAt = formatStoredClock(schedule.opensAt);
  const closesAt = formatStoredClock(schedule.closesAt);
  return opensAt && closesAt
    ? `${opensAt}–${closesAt}`
    : opensAt
      ? `From ${opensAt}`
      : closesAt
        ? `Until ${closesAt}`
        : null;
}

function formatStoredDate(value: unknown): string | null {
  if (value == null) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function isScheduleCurrent(schedule: Schedule, today: string): boolean {
  const validFrom = formatStoredDate(schedule.validFrom);
  const validTo = formatStoredDate(schedule.validTo);
  if (schedule.validFrom != null && !validFrom) return false;
  if (schedule.validTo != null && !validTo) return false;

  return (!validFrom || validFrom <= today) && (!validTo || validTo >= today);
}

/** Formats only stored schedule fields; it never infers current availability. */
export function formatScheduleSummaries(
  schedules: Schedule[],
  currentDate: Date = new Date(),
): string | null {
  const descriptions = new Map<string, string>();
  const structuredGroups = new Map<string, { times: string | null; days: Set<string> }>();
  const today = getRegionalDateKey(currentDate);

  for (const schedule of schedules) {
    if (!isScheduleCurrent(schedule, today)) continue;

    const description = schedule.description?.trim().replace(/\s+/g, ' ');
    if (description) {
      const key = description.toLowerCase();
      if (!descriptions.has(key)) descriptions.set(key, description);
      continue;
    }

    const times = formatStoredTimes(schedule);
    const days = (schedule.days ?? [])
      .map(normalizeScheduleDay)
      .filter((day): day is string => Boolean(day));
    if (!times && days.length === 0) continue;

    const key = `${days.length > 0 ? 'day-scoped' : 'dayless'}:${times ?? ''}`;
    const group = structuredGroups.get(key) ?? { times, days: new Set<string>() };
    days.forEach((day) => group.days.add(day));
    structuredGroups.set(key, group);
  }

  const structured = [...structuredGroups.values()].map(({ times, days }) => {
    const daySummary = sortScheduleDays(days).join(', ') || null;
    return [daySummary, times].filter((part): part is string => Boolean(part)).join(' · ');
  });

  const segments = [...descriptions.values(), ...structured].filter(Boolean);
  return segments.join('; ') || null;
}

export function formatScheduleSummary(
  schedule: Schedule | undefined,
  currentDate: Date = new Date(),
): string | null {
  return formatScheduleSummaries(schedule ? [schedule] : [], currentDate);
}
