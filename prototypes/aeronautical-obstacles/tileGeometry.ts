/** XYZ geometry utilities, independent of the electrical pipeline. Coordinates remain 2D WGS84. */
export type Position = [number, number];
export type Bounds = [number, number, number, number];
const RAD = Math.PI / 180;
const MAX_LAT = 85.0511287798066;
const snap = (v: number) => Math.abs(v - Math.round(v)) < 1e-10 ? Math.round(v) : v;
export function tileXY(lon: number, lat: number, zoom: number): [number, number] {
  if (!Number.isInteger(zoom) || zoom < 0 || zoom > 20 || !Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lon) > 180 || Math.abs(lat) > MAX_LAT) throw new Error("UNSUPPORTED_XYZ_COORDINATES");
  const n = 2 ** zoom;
  return [Math.min(n - 1, Math.max(0, Math.floor(snap((lon + 180) / 360 * n)))),
    Math.min(n - 1, Math.max(0, Math.floor(snap((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2 * n))))];
}
export function tileBounds(z: number, x: number, y: number): Bounds {
  const n = 2 ** z, latitude = (row: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * row / n))) / RAD;
  return [x / n * 360 - 180, latitude(y + 1), (x + 1) / n * 360 - 180, latitude(y)];
}
export function boundsRing([w, s, e, n]: Bounds): Position[] { return [[w, s], [e, s], [e, n], [w, n], [w, s]]; }
export function circleRing(centre: Position, radiusM: number, steps = 256): Position[] {
  if (!Number.isFinite(radiusM) || radiusM <= 0 || radiusM > 100_000 || steps < 16) throw new Error("UNSUPPORTED_STUDY_RADIUS");
  const [lon, lat] = centre.map(v => v * RAD), d = radiusM / 6371008.8;
  const ring: Position[] = [];
  for (let i = 0; i < steps; i++) {
    const bearing = -i * 2 * Math.PI / steps;
    const phi = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(bearing));
    const lambda = lon + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(phi));
    ring.push([lambda / RAD, phi / RAD]);
  }
  ring.push([...ring[0]]);
  return ring;
}
export function geometryBounds(points: number[][]): Bounds {
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
}
export function cellsForBounds(bounds: Bounds, z: number): [number, number][] {
  const [west, north] = tileXY(bounds[0], bounds[3], z), [east, south] = tileXY(bounds[2], bounds[1], z);
  if ((east - west + 1) * (south - north + 1) > 100_000) throw new Error("TILE_BUDGET_EXCEEDED");
  const cells: [number, number][] = [];
  for (let x = west; x <= east; x++) for (let y = north; y <= south; y++) cells.push([x, y]);
  return cells;
}
/** Convex study polygon / rectangle intersection. A tangency is not a covered area. */
export function polygonTileIntersection(ring: Position[], bounds: Bounds): Position[] {
  let polygon = ring.slice(0, -1);
  for (const [axis, edge, lower] of [[0, bounds[0], true], [0, bounds[2], false], [1, bounds[1], true], [1, bounds[3], false]] as const) {
    const result: Position[] = [];
    const inside = (p: Position) => lower ? p[axis] >= edge : p[axis] <= edge;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length], ia = inside(a), ib = inside(b);
      if (ia) result.push(a);
      if (ia !== ib) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        const point: Position = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        point[axis] = edge; result.push(point);
      }
    }
    polygon = result;
  }
  if (polygon.length < 3) return [];
  // Translation reduces cancellation for small polygons at distant longitudes.
  const [ox, oy] = polygon[0];
  const area2 = polygon.reduce((sum, p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    return sum + (p[0] - ox) * (q[1] - oy) - (q[0] - ox) * (p[1] - oy);
  }, 0);
  return Math.abs(area2) > 1e-18 ? [...polygon, polygon[0]] : [];
}
/** Liang–Barsky clipping, preserving native interior vertices and adding boundary intersections only. */
function clipSegment(a: number[], b: number[], box: Bounds): [Position, Position] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return null;
  let lo = 0, hi = 1;
  const p = [-dx, dx, -dy, dy], q = [a[0] - box[0], box[2] - a[0], a[1] - box[1], box[3] - a[1]];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const t = q[i] / p[i];
    if (p[i] < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo >= hi) return null;
  }
  const at = (t: number): Position => {
    if (t === 0) return [a[0], a[1]];
    if (t === 1) return [b[0], b[1]];
    return [Math.max(box[0], Math.min(box[2], a[0] + t * dx)), Math.max(box[1], Math.min(box[3], a[1] + t * dy))];
  };
  return [at(lo), at(hi)];
}
export function clipLineToTile(lines: number[][][], z: number, x: number, y: number): Position[][] {
  const box = tileBounds(z, x, y), parts: Position[][] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    let current: Position[] | null = null;
    for (let i = 1; i < line.length; i++) {
      const segment = clipSegment(line[i - 1], line[i], box);
      if (!segment) { current = null; continue; }
      const [a, b] = segment;
      // Exactly boundary-aligned segments belong east/south, like points. No double segment.
      if ((a[0] === b[0] && (a[0] === box[0] || a[0] === box[2])) ||
          (a[1] === b[1] && (a[1] === box[1] || a[1] === box[3]))) {
        const owner = tileXY((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z);
        if (owner[0] !== x || owner[1] !== y) { current = null; continue; }
      }
      const key = [JSON.stringify(a), JSON.stringify(b)].sort().join("|");
      if (seen.has(key)) { current = null; continue; }
      seen.add(key);
      const last = current?.[current.length - 1];
      if (current && last?.[0] === a[0] && last?.[1] === a[1]) current.push(b);
      else { current = [a, b]; parts.push(current); }
    }
  }
  return parts;
}
