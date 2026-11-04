import type { Position } from "geojson";
import type {
  AirspaceFeatureCollection,
  AirspaceGeoJsonProperties,
  AirspaceGeometry,
} from "./openaip.ts";
import type { WeatherAnalysisTrace } from "./trajectory/weatherAnalysisStorage.ts";
import { normalizeOpenAipAltitudeLimit } from "./airspaceAltitude.ts";

type Ring = Position[];
type PolygonCoordinates = Ring[];

const EPSILON = 1e-10;

function orientation(a: Position, b: Position, c: Position): number {
  return (b[1] - a[1]) * (c[0] - b[0]) -
    (b[0] - a[0]) * (c[1] - b[1]);
}

function isOnSegment(a: Position, point: Position, b: Position): boolean {
  return (
    point[0] <= Math.max(a[0], b[0]) + EPSILON &&
    point[0] + EPSILON >= Math.min(a[0], b[0]) &&
    point[1] <= Math.max(a[1], b[1]) + EPSILON &&
    point[1] + EPSILON >= Math.min(a[1], b[1])
  );
}

function segmentsIntersect(
  firstStart: Position,
  firstEnd: Position,
  secondStart: Position,
  secondEnd: Position,
): boolean {
  const o1 = orientation(firstStart, firstEnd, secondStart);
  const o2 = orientation(firstStart, firstEnd, secondEnd);
  const o3 = orientation(secondStart, secondEnd, firstStart);
  const o4 = orientation(secondStart, secondEnd, firstEnd);

  if ((o1 > EPSILON && o2 < -EPSILON || o1 < -EPSILON && o2 > EPSILON) &&
      (o3 > EPSILON && o4 < -EPSILON || o3 < -EPSILON && o4 > EPSILON)) {
    return true;
  }
  return (
    (Math.abs(o1) <= EPSILON && isOnSegment(firstStart, secondStart, firstEnd)) ||
    (Math.abs(o2) <= EPSILON && isOnSegment(firstStart, secondEnd, firstEnd)) ||
    (Math.abs(o3) <= EPSILON && isOnSegment(secondStart, firstStart, secondEnd)) ||
    (Math.abs(o4) <= EPSILON && isOnSegment(secondStart, firstEnd, secondEnd))
  );
}

function pointInRing(point: Position, ring: Ring): boolean {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const a = ring[index];
    const b = ring[previous];
    if (!a || !b) continue;
    if (Math.abs(orientation(a, b, point)) <= EPSILON && isOnSegment(a, point, b)) {
      return true;
    }
    const crosses =
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Position, polygon: PolygonCoordinates): boolean {
  const outer = polygon[0];
  if (!outer || !pointInRing(point, outer)) return false;
  return !polygon.slice(1).some((hole) => pointInRing(point, hole));
}

function lineIntersectsPolygon(
  line: Position[],
  polygon: PolygonCoordinates,
): boolean {
  if (line.some((point) => pointInPolygon(point, polygon))) return true;

  for (let lineIndex = 1; lineIndex < line.length; lineIndex += 1) {
    const lineStart = line[lineIndex - 1];
    const lineEnd = line[lineIndex];
    if (!lineStart || !lineEnd) continue;
    for (const ring of polygon) {
      for (let ringIndex = 1; ringIndex < ring.length; ringIndex += 1) {
        const ringStart = ring[ringIndex - 1];
        const ringEnd = ring[ringIndex];
        if (
          ringStart &&
          ringEnd &&
          segmentsIntersect(lineStart, lineEnd, ringStart, ringEnd)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function lineIntersectsGeometry(
  line: Position[],
  geometry: AirspaceGeometry,
): boolean {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => lineIntersectsPolygon(line, polygon));
}

function stableAirspaceKey(properties: AirspaceGeoJsonProperties): string {
  return (
    properties.airspaceId ||
    properties.id ||
    properties.airspaceCompositeKey ||
    [
      properties.name,
      properties.type,
      JSON.stringify(properties.lowerLimit),
      JSON.stringify(properties.upperLimit),
    ].join("|")
  );
}

/**
 * Intersection horizontale 2D uniquement. Les limites verticales et les
 * périodes d'activation seront ajoutées ultérieurement sans changer la sortie.
 */
export function selectIntersectedAirspaces(
  traces: readonly WeatherAnalysisTrace[],
  airspaces: AirspaceFeatureCollection,
): AirspaceGeoJsonProperties[] {
  const lines = traces
    .map((trace) =>
      trace.projection.points.map((point) => [
        point.longitude,
        point.latitude,
      ] as Position),
    )
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const selected = new Map<string, AirspaceGeoJsonProperties>();
  for (const feature of airspaces.features) {
    if (lines.some((line) => lineIntersectsGeometry(line, feature.geometry))) {
      selected.set(stableAirspaceKey(feature.properties), feature.properties);
    }
  }
  return [...selected.values()];
}

export function selectTrajectoryAirspaces(
  trace: WeatherAnalysisTrace,
  airspaces: AirspaceFeatureCollection,
): AirspaceGeoJsonProperties[] {
  const matches: Array<{ index: number; airspace: AirspaceGeoJsonProperties }> = [];
  for (const feature of airspaces.features) {
    let firstIndex = -1;
    for (let index = 1; index < trace.projection.points.length; index += 1) {
      const previous = trace.projection.points[index - 1];
      const current = trace.projection.points[index];
      const lower = normalizeOpenAipAltitudeLimit(feature.properties.lowerLimit);
      const upper = normalizeOpenAipAltitudeLimit(feature.properties.upperLimit);
      // The existing map list retains potential zones with unresolved references.
      // Detailed dossier classification below distinguishes these from 3D matches.
      if (lower.metersAMSL === null || upper.metersAMSL === null) {
        if (!lineIntersectsGeometry([[previous.longitude, previous.latitude], [current.longitude, current.latitude]], feature.geometry)) continue;
      } else if (!intersectPlannedAirspaceSegment(previous, current, feature.geometry, feature.properties).length) continue;
      firstIndex = index;
      break;
    }
    if (firstIndex >= 0) matches.push({ index: firstIndex, airspace: feature.properties });
  }
  const unique = new Map<string, { index: number; airspace: AirspaceGeoJsonProperties }>();
  for (const match of matches) {
    const key = stableAirspaceKey(match.airspace);
    const existing = unique.get(key);
    if (!existing || match.index < existing.index) unique.set(key, match);
  }
  return [...unique.values()].sort((left, right) => left.index - right.index).map(({ airspace }) => airspace);
}

export type PlannedAirspaceInterval = {
  entryFraction: number;
  exitFraction: number;
  verticalStatus: "INTERSECTS" | "UNCERTAIN";
  reasons: string[];
};

/** Exact clipping in the same lon/lat segment model as the planned trace. */
function horizontalIntervals(start: Position, end: Position, geometry: AirspaceGeometry): Array<{ from: number; to: number; boundary: boolean }> {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const at = (t: number): Position => [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
  const contains = (point: Position) => polygons.some((polygon) => pointInPolygon(point, polygon));
  const boundary = (point: Position) => polygons.some((polygon) => polygon.some((ring) => ring.slice(1).some((b, index) => Math.abs(orientation(ring[index], b, point)) <= EPSILON && isOnSegment(ring[index], point, b))));
  const cuts = [0, 1];
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  for (const polygon of polygons) for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const ax = a[0] - start[0], ay = a[1] - start[1];
    const determinant = dx * ey - dy * ex;
    if (Math.abs(determinant) > Number.EPSILON * Math.max(Math.abs(dx * ey), Math.abs(dy * ex), Number.MIN_VALUE) * 8) {
      const t = (ax * ey - ay * ex) / determinant;
      const u = (ax * dy - ay * dx) / determinant;
      if (t >= -EPSILON && t <= 1 + EPSILON && u >= -EPSILON && u <= 1 + EPSILON) cuts.push(Math.max(0, Math.min(1, t)));
    } else if (lengthSquared > 0 && Math.abs(ax * dy - ay * dx) <= EPSILON) {
      for (const point of [a, b]) {
        const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
        if (t >= 0 && t <= 1) cuts.push(t);
      }
    }
  }
  const sorted = cuts.sort((a, b) => a - b).filter((value, i, all) => i === 0 || value - all[i - 1] > EPSILON);
  const intervals: Array<{ from: number; to: number; boundary: boolean }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const from = sorted[i - 1], to = sorted[i], middle = at((from + to) / 2);
    if (contains(middle) || boundary(middle)) intervals.push({ from, to, boundary: boundary(middle) });
  }
  // Tangencies are retained as uncertain contact, not a confirmed traversal.
  for (const t of sorted) if ((contains(at(t)) || boundary(at(t))) && !intervals.some((item) => t >= item.from - EPSILON && t <= item.to + EPSILON)) intervals.push({ from: t, to: t, boundary: true });
  return intervals.sort((a, b) => a.from - b.from);
}

/**
 * Piecewise-linear planned geometry/altitudes, not a GPS accuracy assessment.
 * Unknown vertical references are never converted with an assumed terrain/QNH.
 */
export function intersectPlannedAirspaceSegment(
  previous: { latitude: number; longitude: number; altitudeAmslM: number },
  current: { latitude: number; longitude: number; altitudeAmslM: number },
  geometry: AirspaceGeometry,
  properties: Pick<AirspaceGeoJsonProperties, "lowerLimit" | "upperLimit"> & Partial<Pick<AirspaceGeoJsonProperties, "lowerLimitMin" | "upperLimitMax">>,
): PlannedAirspaceInterval[] {
  const sameLimit = (a: typeof properties.lowerLimit, b: typeof properties.lowerLimit) => a?.value === b?.value && a?.unit === b?.unit && a?.referenceDatum === b?.referenceDatum;
  const variableFloor = !!properties.lowerLimitMin && !sameLimit(properties.lowerLimitMin, properties.lowerLimit);
  const variableCeiling = !!properties.upperLimitMax && !sameLimit(properties.upperLimitMax, properties.upperLimit);
  const lower = normalizeOpenAipAltitudeLimit(variableFloor ? null : properties.lowerLimit);
  const upper = normalizeOpenAipAltitudeLimit(variableCeiling ? null : properties.upperLimit);
  const baseReasons: string[] = [];
  if (variableFloor) baseReasons.push("VARIABLE_FLOOR_UNRESOLVED");
  if (variableCeiling) baseReasons.push("VARIABLE_CEILING_UNRESOLVED");
  if (Math.abs(previous.longitude - current.longitude) > 180 || (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates).some((polygon) => polygon.some((ring) => ring.some((point, index) => index > 0 && Math.abs(point[0] - ring[index - 1][0]) > 180)))) baseReasons.push("ANTIMERIDIAN_UNRESOLVED");
  for (const [role, limit] of [["FLOOR", lower], ["CEILING", upper]] as const) {
    if (limit.metersAMSL === null) baseReasons.push(`${role}_${limit.reference === "FL" ? "FL_REQUIRES_PRESSURE" : limit.reference === "AGL" || limit.reference === "SFC" ? "REQUIRES_LOCAL_TERRAIN" : "REFERENCE_UNKNOWN"}`);
  }
  const z0 = previous.altitudeAmslM, dz = current.altitudeAmslM - z0;
  if (!Number.isFinite(z0) || !Number.isFinite(dz)) baseReasons.push("TRACE_ALTITUDE_INVALID");
  if (lower.metersAMSL !== null && upper.metersAMSL !== null && lower.metersAMSL > upper.metersAMSL) baseReasons.push("INVALID_VERTICAL_LIMITS");
  return horizontalIntervals([previous.longitude, previous.latitude], [current.longitude, current.latitude], geometry).flatMap((horizontal) => {
    let from = horizontal.from, to = horizontal.to;
    if (!baseReasons.includes("TRACE_ALTITUDE_INVALID") && !baseReasons.includes("INVALID_VERTICAL_LIMITS")) {
      for (const [limit, floor] of [[lower.metersAMSL, true], [upper.metersAMSL, false]] as const) {
        if (limit === null) continue;
        if (dz === 0) {
          if (floor ? z0 < limit : z0 > limit) return [];
        } else {
          const crossing = (limit - z0) / dz;
          if (floor === (dz > 0)) from = Math.max(from, crossing);
          else to = Math.min(to, crossing);
        }
      }
    }
    if (from > to + EPSILON) return [];
    from = Math.min(from, to);
    const reasons = [...baseReasons];
    if (horizontal.boundary) reasons.push("HORIZONTAL_BOUNDARY_CONTACT");
    if (to - from <= EPSILON || dz === 0 && (z0 === lower.metersAMSL || z0 === upper.metersAMSL)) reasons.push("VERTICAL_BOUNDARY_CONTACT");
    return [{ entryFraction: from, exitFraction: to, verticalStatus: reasons.length ? "UNCERTAIN" as const : "INTERSECTS" as const, reasons }];
  });
}
