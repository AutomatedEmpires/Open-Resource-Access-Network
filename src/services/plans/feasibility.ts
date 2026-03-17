import type { SeekerPlanItem } from '@/domain/execution';
import type { EnrichedService, Schedule, Weekday } from '@/domain/types';

export interface SeekerPlanFeasibilitySignal {
  itemId: string;
  title: string;
  detail: string;
}

const PROXIMITY_THRESHOLD_METERS = 1600;
const CLOSES_SOON_THRESHOLD_MINUTES = 120;
const GOOD_FIRST_STOP_OPEN_WINDOW_MINUTES = 90;
const WEEKDAY_BY_INDEX: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parseClockToLocalDate(now: Date, value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  const hours = Number.parseInt(match[1], 10);
  const minutes = Number.parseInt(match[2], 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }

  const next = new Date(now);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

function getTodaySchedules(service: EnrichedService, now: Date): Schedule[] {
  const weekday = WEEKDAY_BY_INDEX[now.getDay()];
  return service.schedules.filter((schedule) => {
    if (schedule.days && schedule.days.length > 0 && !schedule.days.includes(weekday)) {
      return false;
    }

    if (schedule.validFrom && schedule.validFrom > now) {
      return false;
    }

    if (schedule.validTo && schedule.validTo < now) {
      return false;
    }

    return true;
  });
}

function hasUsableLocation(service: EnrichedService): boolean {
  return Boolean(
    service.location && service.location.latitude != null && service.location.longitude != null,
  ) || Boolean(service.address?.address1 || service.address?.city);
}

function haversineMeters(left: EnrichedService, right: EnrichedService): number | null {
  const leftLat = left.location?.latitude;
  const leftLng = left.location?.longitude;
  const rightLat = right.location?.latitude;
  const rightLng = right.location?.longitude;

  if ([leftLat, leftLng, rightLat, rightLng].some((value) => value == null)) {
    return null;
  }

  const toRadians = (value: number) => (value * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = toRadians((rightLat ?? 0) - (leftLat ?? 0));
  const dLng = toRadians((rightLng ?? 0) - (leftLng ?? 0));
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(leftLat ?? 0)) * Math.cos(toRadians(rightLat ?? 0)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadius * c;
}

export function buildSeekerPlanFeasibilitySignals(
  items: SeekerPlanItem[],
  services: EnrichedService[],
  now: Date = new Date(),
): SeekerPlanFeasibilitySignal[] {
  const serviceById = new Map(services.map((service) => [service.service.id, service]));
  const signals: SeekerPlanFeasibilitySignal[] = [];

  for (const item of items) {
    if (!item.linkedService || item.status === 'done') {
      continue;
    }

    const service = serviceById.get(item.linkedService.serviceId);
    if (!service) {
      continue;
    }

    const todaySchedules = getTodaySchedules(service, now);
    const hasLocation = hasUsableLocation(service);
    const closingSchedule = todaySchedules.find((schedule) => schedule.closesAt);
    const closesAt = parseClockToLocalDate(now, closingSchedule?.closesAt);
    const opensAt = parseClockToLocalDate(now, todaySchedules.find((schedule) => schedule.opensAt)?.opensAt);
    const minutesUntilClose = closesAt ? Math.round((closesAt.getTime() - now.getTime()) / 60_000) : null;
    const minutesUntilOpen = opensAt ? Math.round((opensAt.getTime() - now.getTime()) / 60_000) : null;

    if (hasLocation && minutesUntilClose != null && minutesUntilClose > 0 && minutesUntilClose <= CLOSES_SOON_THRESHOLD_MINUTES) {
      signals.push({
        itemId: item.id,
        title: `${item.title}: closes soon`,
        detail: `Approximate timing from current stored hours suggests this stop closes in about ${minutesUntilClose} minutes. Confirm before you travel.`,
      });
    }

    if (
      item.urgency === 'today'
      && hasLocation
      && service.service.capacityStatus !== 'closed'
      && todaySchedules.length > 0
      && ((minutesUntilClose != null && minutesUntilClose > 0) || (minutesUntilOpen != null && minutesUntilOpen >= 0 && minutesUntilOpen <= GOOD_FIRST_STOP_OPEN_WINDOW_MINUTES))
    ) {
      signals.push({
        itemId: item.id,
        title: `${item.title}: good first stop today`,
        detail: 'This linked stop has usable location and timing detail in current records, so it is a reasonable first stop today. Timing remains approximate.',
      });
    }

    const nearbyItem = items.find((candidate) => {
      if (candidate.id === item.id || !candidate.linkedService || candidate.status === 'done') {
        return false;
      }

      const candidateService = serviceById.get(candidate.linkedService.serviceId);
      if (!candidateService) {
        return false;
      }

      const distance = haversineMeters(service, candidateService);
      return distance != null && distance <= PROXIMITY_THRESHOLD_METERS;
    });

    if (nearbyItem?.linkedService) {
      signals.push({
        itemId: item.id,
        title: `${item.title}: combine with nearby stop`,
        detail: `Stored coordinates place this stop within about ${Math.round(PROXIMITY_THRESHOLD_METERS / 1609)} mile of ${nearbyItem.linkedService.serviceName}. Treat this as an approximate grouping cue.`,
      });
    }

    if (item.urgency === 'backup' || item.fallback) {
      signals.push({
        itemId: item.id,
        title: `${item.title}: keep as backup if missed`,
        detail: 'This step is already marked as a backup or carries fallback notes, so it should stay in reserve if your first stop fails.',
      });
    }

    if (!hasLocation || todaySchedules.length === 0) {
      signals.push({
        itemId: item.id,
        title: `${item.title}: call ahead before you go`,
        detail: 'ORAN does not have enough location or current hours detail to label this stop as feasible right now, so the safe guidance is to call ahead or keep it for manual planning.',
      });
    }
  }

  return signals.slice(0, 6);
}
