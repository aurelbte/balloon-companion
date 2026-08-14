import type { Position } from "geojson";
import type {
  AirspaceFeatureCollection,
  AirspaceGeoJsonProperties,
  AirspaceGeometry,
} from "./openaip.ts";
import type { WeatherAnalysisTrace } from "./trajectory/weatherAnalysisStorage.ts";
import { calculateAirspaceVerticalContext, normalizeOpenAipAltitudeLimit } from "./airspaceAltitude.ts";

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
      if (!lineIntersectsGeometry([[previous.longitude, previous.latitude], [current.longitude, current.latitude]], feature.geometry)) continue;
      const altitude = (previous.altitudeAmslM + current.altitudeAmslM) / 2;
      const vertical = calculateAirspaceVerticalContext(
        normalizeOpenAipAltitudeLimit(feature.properties.lowerLimit),
        normalizeOpenAipAltitudeLimit(feature.properties.upperLimit),
        altitude,
      );
      if (vertical.state === "BELOW" || vertical.state === "ABOVE") continue;
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
