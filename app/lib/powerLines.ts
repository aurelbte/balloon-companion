export interface PowerLineBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

interface OverpassWay {
  id: number;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
}

export interface OverpassPowerLineResponse {
  elements?: OverpassWay[];
}

export function normalizePowerLineBounds(bounds: PowerLineBounds): PowerLineBounds {
  const step = 0.05;
  return {
    west: Math.floor(bounds.west / step) * step,
    south: Math.floor(bounds.south / step) * step,
    east: Math.ceil(bounds.east / step) * step,
    north: Math.ceil(bounds.north / step) * step,
  };
}

export function getPowerLineQueryBounds(bounds: PowerLineBounds): PowerLineBounds {
  const centerLongitude = (bounds.west + bounds.east) / 2;
  const centerLatitude = (bounds.south + bounds.north) / 2;
  const width = Math.min((bounds.east - bounds.west) * 1.3, 1.8);
  const height = Math.min((bounds.north - bounds.south) * 1.3, 1.8);
  return normalizePowerLineBounds({
    west: centerLongitude - width / 2,
    east: centerLongitude + width / 2,
    south: centerLatitude - height / 2,
    north: centerLatitude + height / 2,
  });
}

export function powerLineBoundsContain(
  coverage: PowerLineBounds,
  viewport: PowerLineBounds,
): boolean {
  return coverage.west <= viewport.west && coverage.south <= viewport.south && coverage.east >= viewport.east && coverage.north >= viewport.north;
}

export function powerLineBoundsKey(bounds: PowerLineBounds): string {
  return [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => value.toFixed(2))
    .join(",");
}

export function buildPowerLinesQuery(bounds: PowerLineBounds): string {
  return `[out:json][timeout:15];way["power"="line"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});out geom;`;
}

export interface PowerLineResult extends GeoJSON.FeatureCollection<GeoJSON.LineString> {
  bounds: PowerLineBounds;
  fetchedAt: string;
  complete: boolean;
  rejectedElements: number;
  emptyConfirmed: boolean;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function validGeometry(value: unknown): value is Array<{ lat: number; lon: number }> {
  return Array.isArray(value) && value.length >= 2 && value.some(point => {
    const first = record(value[0]), item = record(point);
    return first && item && (first.lat !== item.lat || first.lon !== item.lon);
  }) && value.every(point => {
    const item = record(point);
    return item && typeof item.lat === "number" && Number.isFinite(item.lat) && Math.abs(item.lat) <= 90 && typeof item.lon === "number" && Number.isFinite(item.lon) && Math.abs(item.lon) <= 180;
  });
}

export function parsePowerLines(response: unknown) {
  const root = record(response);
  if (!root || !Array.isArray(root.elements)) throw new Error("Réponse Overpass invalide");
  let rejectedElements = 0;
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  for (const element of root.elements) {
    const way = record(element), tags = record(way?.tags);
    // Other explicitly tagged power types do not belong to this layer.
    if (tags && typeof tags.power === "string" && tags.power !== "line") continue;
    if (!way || !Number.isSafeInteger(way.id) || typeof way.id !== "number" || way.id <= 0 || tags?.power !== "line" || !validGeometry(way.geometry)) { rejectedElements++; continue; }
    features.push({ type: "Feature", id: way.id, properties: { power: "line" }, geometry: { type: "LineString", coordinates: way.geometry.map(({ lon, lat }) => [lon, lat]) } });
  }
  // A supplier remark is not proof of a complete successful result.
  const supplierIssue = (root.remark !== undefined && root.remark !== "") || root.error !== undefined;
  const complete = !supplierIssue && rejectedElements === 0 && (root.elements.length === 0 || features.length > 0);
  return { type: "FeatureCollection" as const, features, complete, rejectedElements, emptyConfirmed: complete && root.elements.length === 0 };
}

export function toPowerLineGeoJson(response: OverpassPowerLineResponse): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const parsed = parsePowerLines(response);
  return { type: "FeatureCollection", features: parsed.features };
}

/** Validate the entire client envelope before it can enter the success cache. */
export function validatePowerLineResult(value: unknown, bounds: PowerLineBounds): PowerLineResult {
  const root = record(value), actualBounds = record(root?.bounds);
  if (!root || root.type !== "FeatureCollection" || !Array.isArray(root.features) || !actualBounds ||
      Object.entries(bounds).some(([key, number]) => actualBounds[key] !== number) ||
      typeof root.fetchedAt !== "string" || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(root.fetchedAt) || !Number.isFinite(Date.parse(root.fetchedAt)) ||
      typeof root.complete !== "boolean" || !Number.isSafeInteger(root.rejectedElements) || typeof root.rejectedElements !== "number" || root.rejectedElements < 0 ||
      root.emptyConfirmed !== (root.complete && root.features.length === 0) || (root.complete && root.rejectedElements !== 0)) throw new Error("Données de lignes invalides");
  for (const item of root.features) {
    const feature = record(item), geometry = record(feature?.geometry), properties = record(feature?.properties);
    if (feature?.type !== "Feature" || typeof feature.id !== "number" || !Number.isSafeInteger(feature.id) || feature.id <= 0 || properties?.power !== "line" || geometry?.type !== "LineString" || !Array.isArray(geometry.coordinates) ||
        !validGeometry(geometry.coordinates.map(point => Array.isArray(point) && point.length === 2 ? { lon: point[0], lat: point[1] } : null))) throw new Error("Géométrie de ligne invalide");
  }
  return value as PowerLineResult;
}
