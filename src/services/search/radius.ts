export const DEFAULT_DISCOVERY_RADIUS_MILES = 10;
export const MIN_DISCOVERY_RADIUS_MILES = 1;
export const MAX_DISCOVERY_RADIUS_MILES = 50;
export const METERS_PER_MILE = 1609.344;

export function milesToMeters(miles: number): number {
  return Math.round(miles * METERS_PER_MILE);
}

export function clampDiscoveryRadiusMiles(miles: number): number {
  return Math.min(MAX_DISCOVERY_RADIUS_MILES, Math.max(MIN_DISCOVERY_RADIUS_MILES, Math.round(miles)));
}
