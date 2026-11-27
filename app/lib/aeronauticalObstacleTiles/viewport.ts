import { tileXY, tileBounds, type Bounds } from "../../../prototypes/aeronautical-obstacles/tileGeometry.ts";
import type { ObstacleManifest, TileEntry } from "./contract.ts";
export type Viewport = Readonly<{ west: number; south: number; east: number; north: number }>;
export type Selection = Readonly<{ zoom: 9 | 12; tiles: TileEntry[]; outsideTileCount: number; partial: boolean }>;
/** No world-sized grid allocation. Wrapped longitudes and antimeridian are accepted. */
export function selectObstacleTiles(manifest: ObstacleManifest, viewport: Viewport, displayZoom: number): Selection {
  const { west, south, east, north } = viewport;
  if (![west, south, east, north, displayZoom].every(Number.isFinite) || displayZoom < 0 || south >= north || south < -90 || north > 90) throw new RangeError("INVALID_VIEWPORT");
  const z = displayZoom < 11 ? 9 : 12, max = 85.0511287798066;
  if (south >= max || north <= -max) return { zoom: z, tiles: [], outsideTileCount: 1, partial: true };
  const s = Math.max(south, -max), n = Math.min(north, max);
  const longitude = (v: number) => ((v + 180) % 360 + 360) % 360 - 180;
  let width = east - west;
  if (Math.abs(width) >= 360) width = 360;
  else if (width < 0) width += 360;
  if (width <= 0) throw new RangeError("INVALID_VIEWPORT");
  const w = longitude(west), end = w + width;
  const bounds: Bounds[] = width === 360 ? [[-180, s, 180, n]] : end <= 180 ? [[w, s, end, n]] : [[w, s, 180, n], [-180, s, end - 360, n]];
  const ranges = bounds.map(b => {
    const [left, top] = tileXY(b[0], b[3], z), [right, bottom] = tileXY(b[2], b[1], z);
    // Upper bounds are exclusive: touching a neighbour at an edge is not an area.
    return { left, top, right: right - (Math.abs(tileBounds(z, right, top)[0] - b[2]) < 1e-11 ? 1 : 0),
      bottom: bottom - (Math.abs(tileBounds(z, left, bottom)[3] - b[1]) < 1e-11 ? 1 : 0) };
  });
  ranges.sort((a,b) => a.left - b.left);
  for (let i = ranges.length - 1; i > 0; i--) if (ranges[i - 1].right >= ranges[i].left - 1) {
    ranges[i - 1].right = Math.max(ranges[i - 1].right, ranges[i].right); ranges.splice(i, 1);
  }
  const tiles = manifest.tiling.tiles.filter(t => t.z === z && ranges.some(r => t.x >= r.left && t.x <= r.right && t.y >= r.top && t.y <= r.bottom));
  const total = ranges.reduce((n, r) => n + Math.max(0, r.right - r.left + 1) * Math.max(0, r.bottom - r.top + 1), 0);
  const outsideTileCount = total - tiles.length;
  return { zoom: z, tiles, outsideTileCount, partial: outsideTileCount > 0 || south < -max || north > max || tiles.some(t => t.coverage !== "study_full") };
}
