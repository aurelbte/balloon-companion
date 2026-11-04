import { normalizePowerLineBounds, type PowerLineBounds } from "./powerLines.ts";

export const OBSTACLE_MIN_ZOOM = 11;
export type ObstacleKind = "pylon" | "mast" | "wind";
export type ObstacleResult = GeoJSON.FeatureCollection<GeoJSON.Point, { kind: ObstacleKind; heightM: number | null; name: string }> & {
  bounds: PowerLineBounds; fetchedAt: string; complete: boolean; emptyConfirmed: boolean; rejectedElements: number;
};
export function obstacleKind(tags: Record<string, unknown> | undefined): ObstacleKind | null {
  if (tags?.power === "tower") return "pylon";
  if (tags?.power === "generator" && tags["generator:source"] === "wind") return "wind";
  if (["mast", "tower", "antenna", "communications_tower"].includes(String(tags?.man_made))) return "mast";
  return null;
}
/** Bound obstacle density without ever claiming that this covers a wider viewport. */
export function obstacleQueryBounds(bounds: PowerLineBounds): PowerLineBounds {
  const lon = (bounds.west + bounds.east) / 2, lat = (bounds.south + bounds.north) / 2;
  const width = Math.min(bounds.east - bounds.west, 0.2), height = Math.min(bounds.north - bounds.south, 0.2);
  return normalizePowerLineBounds({ west: lon - width / 2, east: lon + width / 2, south: lat - height / 2, north: lat + height / 2 });
}
export function buildObstaclesQuery(bounds: PowerLineBounds): string {
  const b = obstacleQueryBounds(bounds), box = `(${b.south},${b.west},${b.north},${b.east})`;
  // body keeps node coordinates; center adds representative points for ways/relations.
  return `(nwr["power"="tower"]${box};nwr["man_made"~"^(mast|tower|antenna|communications_tower)$"]${box};nwr["power"="generator"]["generator:source"="wind"]${box};);out body center;`;
}
export function obstacleHeight(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(m|ft|')?$/i);
  if (!match) return null;
  const height = Number(match[1]) * (match[2] && match[2].toLowerCase() !== 'm' ? 0.3048 : 1);
  return height > 0 && height <= 1500 ? Math.round(height * 10) / 10 : null;
}
export function parseObstacles(value: unknown) {
  const root = value as { elements?: Record<string, unknown>[]; remark?: unknown; error?: unknown };
  if (!root || !Array.isArray(root.elements)) throw new Error("Réponse obstacles invalide");
  const features = new Map<string, ObstacleResult["features"][number]>();
  let rejectedElements = 0;
  for (const item of root.elements) {
    const tags = item?.tags as Record<string, unknown> | undefined;
    if (tags?.power === "line") continue;
    const kind = obstacleKind(tags);
    const point = (item?.type === "node" ? item : item?.center) as { lon?: number; lat?: number } | undefined;
    if (!kind || !["node", "way", "relation"].includes(String(item?.type)) || !Number.isSafeInteger(item?.id) || Number(item?.id) <= 0 ||
        typeof point?.lon !== "number" || !Number.isFinite(point.lon) || Math.abs(point.lon) > 180 || typeof point.lat !== "number" || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || features.size >= 5000) { rejectedElements++; continue; }
    const id = `${item.type}/${item.id}`;
    features.set(id, { type: "Feature", id, properties: { kind, heightM: obstacleHeight(tags?.height), name: typeof tags?.name === "string" ? tags.name.slice(0, 120) : "" }, geometry: { type: "Point", coordinates: [point.lon, point.lat] } });
  }
  const complete = !(root.remark !== undefined && root.remark !== "") && root.error === undefined && rejectedElements === 0;
  return { type: "FeatureCollection" as const, features: [...features.values()], complete, rejectedElements, emptyConfirmed: complete && features.size === 0 };
}
export function validateObstacleResult(value: unknown, bounds: PowerLineBounds): ObstacleResult {
  const r = value as ObstacleResult;
  if (!r || r.type !== "FeatureCollection" || !r.bounds || Object.entries(bounds).some(([k, v]) => r.bounds[k as keyof PowerLineBounds] !== v) || !Array.isArray(r.features) || r.features.length > 5000 ||
      typeof r.fetchedAt !== "string" || !/(Z|[+-]\d{2}:?\d{2})$/.test(r.fetchedAt) || !Number.isFinite(Date.parse(r.fetchedAt)) || typeof r.complete !== "boolean" || !Number.isSafeInteger(r.rejectedElements) || r.rejectedElements < 0 || (r.complete && r.rejectedElements > 0) || r.emptyConfirmed !== (r.complete && r.features.length === 0)) throw new Error("Données obstacles invalides");
  const ids = new Set();
  for (const f of r.features) {
    const p = f?.properties, c = f?.geometry?.coordinates;
    if (f?.type !== "Feature" || typeof f.id !== "string" || !/^(node|way|relation)\/[1-9]\d*$/.test(f.id) || ids.has(f.id) || f.geometry?.type !== "Point" || !Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite) || Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90 || !p || !["pylon", "mast", "wind"].includes(p.kind) || typeof p.name !== "string" || !(p.heightM === null || (typeof p.heightM === "number" && Number.isFinite(p.heightM) && p.heightM > 0 && p.heightM <= 1500))) throw new Error("Obstacle invalide");
    ids.add(f.id);
  }
  return r;
}
