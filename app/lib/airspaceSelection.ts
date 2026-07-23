import {
  createAirspaceCompositeKey,
  type AirspaceFeatureCollection,
  type AirspaceGeoJsonProperties,
  type OpenAipAltitudeLimit,
} from "./openaip.ts";

export interface RenderedAirspaceFeature {
  id?: string | number;
  properties?: Record<string, unknown> | null;
}

export interface AirspaceSelectionIndex {
  byId: Map<string, AirspaceGeoJsonProperties>;
  byCompositeKey: Map<string, AirspaceGeoJsonProperties[]>;
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function parseAltitudeLimit(value: unknown): OpenAipAltitudeLimit | undefined {
  let candidate = value;

  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate) as unknown;
    } catch {
      return undefined;
    }
  }

  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const limit = candidate as Partial<OpenAipAltitudeLimit>;
  if (
    typeof limit.value !== "number" ||
    typeof limit.unit !== "number" ||
    typeof limit.referenceDatum !== "number"
  ) {
    return undefined;
  }

  return {
    value: limit.value,
    unit: limit.unit,
    referenceDatum: limit.referenceDatum,
  };
}

export function getRenderedAirspaceId(
  feature: RenderedAirspaceFeature,
): string | null {
  return normalizeId(feature.properties?.airspaceId) ?? normalizeId(feature.id);
}

function getRenderedCompositeKey(
  feature: RenderedAirspaceFeature,
): string | null {
  const storedKey = normalizeId(feature.properties?.airspaceCompositeKey);
  if (storedKey) {
    return storedKey;
  }

  const name = feature.properties?.name;
  const rawType = feature.properties?.type;
  const type =
    typeof rawType === "number"
      ? rawType
      : typeof rawType === "string" && rawType.trim() !== ""
        ? Number(rawType)
        : Number.NaN;

  if (typeof name !== "string" || name.trim() === "" || !Number.isFinite(type)) {
    return null;
  }

  return createAirspaceCompositeKey({
    name,
    type,
    lowerLimit: parseAltitudeLimit(feature.properties?.lowerLimit),
    upperLimit: parseAltitudeLimit(feature.properties?.upperLimit),
  });
}

export function createAirspaceSelectionIndex(
  airspaces: AirspaceFeatureCollection,
): AirspaceSelectionIndex {
  const byId = new Map<string, AirspaceGeoJsonProperties>();
  const byCompositeKey = new Map<string, AirspaceGeoJsonProperties[]>();

  for (const feature of airspaces.features) {
    const properties = feature.properties;
    const id = normalizeId(properties.airspaceId);
    if (!id) {
      continue;
    }

    byId.set(id, properties);

    const compositeKey =
      properties.airspaceCompositeKey || createAirspaceCompositeKey(properties);
    const matches = byCompositeKey.get(compositeKey) ?? [];
    matches.push(properties);
    byCompositeKey.set(compositeKey, matches);
  }

  return { byId, byCompositeKey };
}

export function resolveRenderedAirspaces(
  renderedFeatures: RenderedAirspaceFeature[],
  index: AirspaceSelectionIndex,
): AirspaceGeoJsonProperties[] {
  const resolved: AirspaceGeoJsonProperties[] = [];
  const seenIds = new Set<string>();

  for (const feature of renderedFeatures) {
    const renderedId = getRenderedAirspaceId(feature);
    const directMatch = renderedId ? index.byId.get(renderedId) : undefined;
    const matches = directMatch
      ? [directMatch]
      : (index.byCompositeKey.get(getRenderedCompositeKey(feature) ?? "") ?? []);

    for (const match of matches) {
      const matchId = normalizeId(match.airspaceId);
      if (matchId && !seenIds.has(matchId)) {
        seenIds.add(matchId);
        resolved.push(match);
      }
    }
  }

  return resolved;
}
