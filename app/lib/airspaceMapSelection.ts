import {
  getAirspaceVisualCategory,
  getAirspaceZoomContext,
  type AirspaceVisualCategory,
  type AirspaceZoomContext,
} from "./airspaceMapStyle.ts";
import type {
  AirspaceGeoJsonProperties,
  AirspaceGeometry,
} from "./openaip.ts";

export interface MapClickAirspaceCandidate {
  airspace: AirspaceGeoJsonProperties;
  geometry: AirspaceGeometry;
}

const PRIORITY_BY_CONTEXT: Readonly<
  Record<AirspaceZoomContext, Readonly<Record<AirspaceVisualCategory, number>>>
> = {
  NATIONAL: {
    INFORMATION_SERVICE: 0,
    UPPER_AIRSPACE: 1,
    RESTRICTED: 2,
    CONTROLLED_TERMINAL: 3,
    CONTROLLED_LOCAL: 4,
    UNKNOWN: 5,
  },
  REGIONAL: {
    RESTRICTED: 0,
    CONTROLLED_TERMINAL: 1,
    INFORMATION_SERVICE: 2,
    CONTROLLED_LOCAL: 3,
    UPPER_AIRSPACE: 4,
    UNKNOWN: 5,
  },
  LOCAL: {
    RESTRICTED: 0,
    CONTROLLED_LOCAL: 1,
    CONTROLLED_TERMINAL: 2,
    INFORMATION_SERVICE: 3,
    UPPER_AIRSPACE: 4,
    UNKNOWN: 5,
  },
};

function ringArea(coordinates: number[][]): number {
  let sum = 0;
  for (let index = 0; index < coordinates.length; index += 1) {
    const current = coordinates[index];
    const next = coordinates[(index + 1) % coordinates.length];
    if (!current || !next) continue;
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(sum) / 2;
}

function polygonArea(coordinates: number[][][]): number {
  const [outer, ...holes] = coordinates;
  if (!outer) return 0;
  return Math.max(
    0,
    ringArea(outer) -
      holes.reduce((total, hole) => total + ringArea(hole), 0),
  );
}

export function getAirspaceGeometryArea(geometry: AirspaceGeometry): number {
  return geometry.type === "Polygon"
    ? polygonArea(geometry.coordinates)
    : geometry.coordinates.reduce(
        (total, polygon) => total + polygonArea(polygon),
        0,
      );
}

export function sortAirspacesForMapClick({
  candidates,
  zoom,
}: {
  candidates: MapClickAirspaceCandidate[];
  zoom: number;
}): MapClickAirspaceCandidate[] {
  const context = getAirspaceZoomContext(zoom);
  const priorities = PRIORITY_BY_CONTEXT[context];

  return [...candidates].sort((left, right) => {
    const leftCategory = getAirspaceVisualCategory(left.airspace);
    const rightCategory = getAirspaceVisualCategory(right.airspace);
    return (
      priorities[leftCategory] - priorities[rightCategory] ||
      getAirspaceGeometryArea(left.geometry) -
        getAirspaceGeometryArea(right.geometry) ||
      left.airspace.airspaceId.localeCompare(right.airspace.airspaceId)
    );
  });
}

export function selectAirspaceForMapClick({
  candidates,
  zoom,
}: {
  candidates: MapClickAirspaceCandidate[];
  zoom: number;
}): MapClickAirspaceCandidate | null {
  return sortAirspacesForMapClick({ candidates, zoom })[0] ?? null;
}
