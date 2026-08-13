import type { AirspaceGeoJsonProperties } from "./openaip.ts";

export function uniqueSelectedAirspaces(
  airspaces: readonly AirspaceGeoJsonProperties[],
): AirspaceGeoJsonProperties[] {
  const seen = new Set<string>();
  return airspaces.filter(({ airspaceId }) => {
    if (seen.has(airspaceId)) return false;
    seen.add(airspaceId);
    return true;
  });
}

export function adjacentAirspaceIndex(current: number, count: number, direction: -1 | 1): number {
  return count > 0 ? (current + direction + count) % count : 0;
}
