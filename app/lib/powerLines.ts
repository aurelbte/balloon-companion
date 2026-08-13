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

export function powerLineBoundsKey(bounds: PowerLineBounds): string {
  return [bounds.south, bounds.west, bounds.north, bounds.east]
    .map((value) => value.toFixed(2))
    .join(",");
}

export function buildPowerLinesQuery(bounds: PowerLineBounds): string {
  return `[out:json][timeout:15];way["power"="line"](${bounds.south},${bounds.west},${bounds.north},${bounds.east});out geom;`;
}

export function toPowerLineGeoJson(
  response: OverpassPowerLineResponse,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: "FeatureCollection",
    features: (response.elements ?? []).flatMap((way) =>
      way.tags?.power === "line" && (way.geometry?.length ?? 0) > 1
        ? [{
            type: "Feature" as const,
            id: way.id,
            properties: { power: "line" },
            geometry: {
              type: "LineString" as const,
              coordinates: way.geometry!.map(({ lon, lat }) => [lon, lat]),
            },
          }]
        : [],
    ),
  };
}
