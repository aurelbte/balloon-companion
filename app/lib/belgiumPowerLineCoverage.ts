import footprint from "./data/belgiumPowerLinesCoverage.json" with { type: "json" };
import { powerLineFeatureIntersectsViewport } from "./powerLinesRuntime.ts";
import type { PowerLineBounds } from "./powerLines.ts";
export type TileCoverage = "FULL" | "PARTIAL" | "OUTSIDE";
const polygons = footprint.geometry.coordinates;
function inRing(point: number[], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** Exact extraction footprint, including holes; never claim the entire XYZ envelope is covered. */
export function belgiumPowerLineCoverage(view: PowerLineBounds): TileCoverage {
  const corners = [view.west, view.east].flatMap(lon => [view.south, view.north].map(lat => [lon, lat]));
  const contains = (point: number[]) => polygons.some(p => inRing(point, p[0]) && !p.slice(1).some(hole => inRing(point, hole)));
  const boundary = polygons.some(p => p.some(ring => powerLineFeatureIntersectsViewport({ type: "Feature", properties: {},
    geometry: { type: "LineString", coordinates: ring } }, view)));
  if (!boundary && corners.every(contains)) return "FULL";
  return boundary || corners.some(contains) ? "PARTIAL" : "OUTSIDE";
}
