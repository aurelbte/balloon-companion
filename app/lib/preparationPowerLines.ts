import manifest from "../../public/osm-power/lfqo/6b46a77294ac1b41/manifest.json" with { type: "json" };
import { PowerLineRuntime, powerLineMemoryStore, powerLineStatusLabel, type PowerLineMemoryStore, type PowerLineState } from "./powerLinesRuntime.ts";
import { ObstacleRuntime, type ObstacleState } from "./obstacleRuntime.ts";
import type { PowerLineBounds } from "./powerLines.ts";

const BASE = `/osm-power/lfqo/${manifest.dataset_sha256.slice(0, 16)}/`;
type Line = GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString>;
type Collection = GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString>;
export type PreparationPowerLineState = PowerLineState & { coverageLabel: string; localCoverage?: "FULL" | "PARTIAL"; tileDiagnostics?: LFQOTileDiagnostic[] };
const R = 6371008.8, RAD = Math.PI / 180;
const lon0 = manifest.center.longitude, lat0 = manifest.center.latitude;
export function lfqoDistanceM(lon: number, lat: number): number {
  const a = Math.sin((lat - lat0) * RAD / 2) ** 2 + Math.cos(lat * RAD) * Math.cos(lat0 * RAD) * Math.sin((lon - lon0) * RAD / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(Math.min(1, a)));
}
export function lfqoCoverage(view: PowerLineBounds): "FULL" | "PARTIAL" | "OUTSIDE" {
  const clampLat = (lat: number) => Math.max(view.south, Math.min(view.north, lat));
  const clampLon = (lon: number) => Math.max(view.west, Math.min(view.east, lon));
  const corners = [view.west, view.east].flatMap(lon => [view.south, view.north].map(lat => [lon, lat]));
  if (corners.every(([lon, lat]) => lfqoDistanceM(lon, lat) <= manifest.radius_m)) return "FULL";
  const candidates = [[clampLon(lon0), clampLat(lat0)], ...[view.south, view.north].map(lat => [clampLon(lon0), lat]),
    ...[view.west, view.east].map(lon => [lon, clampLat(Math.atan2(Math.sin(lat0 * RAD), Math.cos(lat0 * RAD) * Math.cos((lon - lon0) * RAD)) / RAD)])];
  return candidates.some(([lon, lat]) => lfqoDistanceM(lon, lat) <= manifest.radius_m) ? "PARTIAL" : "OUTSIDE";
}

/** Merge all fragments of each OSM way, including continuations, without drawing shared segments twice. */
export function mergeLocalPowerLines(features: Line[]): Collection {
  const groups = new Map<string, { feature: Line; edges: Map<string, [number[], number[]]> }>();
  const key = (p: number[]) => p.map(n => n.toFixed(8)).join(",");
  for (const feature of features) {
    const id = String(feature.id);
    const group = groups.get(id) ?? { feature, edges: new Map() };
    groups.set(id, group);
    const parts = feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    for (const points of parts) for (let i = 1; i < points.length; i++) {
      const a = key(points[i - 1]), b = key(points[i]);
      if (a !== b) group.edges.set([a, b].sort().join("|"), [points[i - 1], points[i]]);
    }
  }
  const merged: Line[] = [];
  for (const { feature, edges } of groups.values()) {
    const values = [...edges.values()], adjacency = new Map<string, number[]>(), unused = new Set(values.map((_, i) => i));
    values.forEach(([a, b], i) => { for (const p of [a, b]) adjacency.set(key(p), [...(adjacency.get(key(p)) ?? []), i]); });
    const chains: number[][][] = [];
    const walk = (start: number[], edge: number) => {
      const chain = [start]; let p = start, current: number | undefined = edge;
      while (current !== undefined && unused.has(current)) {
        unused.delete(current);
        const [a, b] = values[current]; p = key(p) === key(a) ? b : a; chain.push(p);
        const next = adjacency.get(key(p))!;
        current = next.length === 2 ? next.find(index => unused.has(index)) : undefined;
      }
      chains.push(chain);
    };
    for (const [point, indexes] of adjacency) if (indexes.length !== 2) for (const i of indexes) if (unused.has(i)) walk(point.split(",").map(Number), i);
    while (unused.size) { const edge = unused.values().next().value!; walk(values[edge][0], edge); }
    if (chains.length) merged.push({ ...feature, geometry: chains.length === 1 ? { type: "LineString", coordinates: chains[0] } : { type: "MultiLineString", coordinates: chains } });
  }
  return { type: "FeatureCollection", features: merged };
}

export type LFQOTileStatus = "OUTSIDE_COVERAGE" | "EMPTY" | "AVAILABLE" | "LOADING" | "NOT_LOADED" | "NOT_FOUND" | "HTTP_ERROR" | "NETWORK_ERROR" | "TIMEOUT" | "HASH_MISMATCH" | "INVALID_DATA" | "VERIFICATION_UNAVAILABLE";
export type LFQOTileDiagnostic = { key: string; status: LFQOTileStatus; url?: string; httpStatus?: number };
class LocalTileError extends Error {
  status: LFQOTileStatus;
  httpStatus?: number;
  constructor(status: LFQOTileStatus, message: string, httpStatus?: number) { super(message); this.status = status; this.httpStatus = httpStatus; }
}
function xyzBounds(x: number, y: number): [number, number, number, number] {
  const n = 2 ** manifest.tiling.zoom;
  const lat = (row: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * row / n))) / RAD;
  return [x / n * 360 - 180, lat(y + 1), (x + 1) / n * 360 - 180, lat(y)];
}

export class LFQOPowerLineTiles {
  private cache = new Map<string, Collection>();
  private pending = new Map<string, Promise<Collection>>();
  private failures = new Map<string, { status: LFQOTileStatus; httpStatus?: number }>();
  private fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = (...args) => fetch(...args)) { this.fetcher = fetcher; }
  diagnostics(view: PowerLineBounds): LFQOTileDiagnostic[] {
    // Enumerate only the small LFQO envelope, at the manifest's fixed XYZ zoom (not the map zoom).
    if (lfqoCoverage(view) === "OUTSIDE") return [];
    const delta = manifest.radius_m / R, dlon = Math.asin(Math.sin(delta) / Math.cos(lat0 * RAD)) / RAD;
    const west = Math.max(view.west, lon0 - dlon), east = Math.min(view.east, lon0 + dlon);
    const south = Math.max(view.south, lat0 - delta / RAD), north = Math.min(view.north, lat0 + delta / RAD);
    const n = 2 ** manifest.tiling.zoom;
    const x = (lon: number) => Math.floor((lon + 180) / 360 * n);
    const y = (lat: number) => Math.floor((1 - Math.asinh(Math.tan(lat * RAD)) / Math.PI) / 2 * n);
    const entries = new Map(manifest.tiling.tiles.map(tile => [tile.key, tile]));
    const results: LFQOTileDiagnostic[] = [];
    for (let col = x(west); col <= x(east); col++) for (let row = y(north); row <= y(south); row++) {
      const key = `tiles/${manifest.tiling.zoom}/${col}/${row}.geojson`, bounds = xyzBounds(col, row);
      const intersection = { west: Math.max(view.west, bounds[0]), south: Math.max(view.south, bounds[1]), east: Math.min(view.east, bounds[2]), north: Math.min(view.north, bounds[3]) };
      if (intersection.east <= intersection.west || intersection.north <= intersection.south) continue;
      if (lfqoCoverage(intersection) === "OUTSIDE") { results.push({ key, status: "OUTSIDE_COVERAGE" }); continue; }
      // The generated manifest indexes nonempty files only. Unlisted cells inside its disk are intentionally empty.
      if (!entries.has(key)) { results.push({ key, status: "EMPTY" }); continue; }
      if (this.cache.has(key)) results.push({ key, url: BASE + key, status: "AVAILABLE" });
      else if (this.pending.has(key)) results.push({ key, url: BASE + key, status: "LOADING" });
      else results.push({ key, url: BASE + key, ...(this.failures.get(key) ?? { status: "NOT_LOADED" as const }) });
    }
    return results;
  }
  tiles(view: PowerLineBounds) {
    const relevant = new Set(this.diagnostics(view).filter(t => t.url).map(t => t.key));
    return manifest.tiling.tiles.filter(t => relevant.has(t.key));
  }
  data(view: PowerLineBounds): Collection {
    return mergeLocalPowerLines(this.tiles(view).flatMap(t => this.cache.get(t.key)?.features ?? []));
  }
  missing(view: PowerLineBounds): number { return this.tiles(view).filter(t => !this.cache.has(t.key)).length; }
  async load(view: PowerLineBounds): Promise<void> {
    await Promise.allSettled(this.tiles(view).map(async tile => {
      if (this.cache.has(tile.key)) return;
      let request = this.pending.get(tile.key);
      if (!request) {
        request = (async () => {
          let phase: LFQOTileStatus = "NETWORK_ERROR";
          try {
            // Retry failed assets with HTTP revalidation instead of replaying a cached error or wrong body.
            const response = await this.fetcher(BASE + tile.key, { cache: this.failures.has(tile.key) ? "reload" : "force-cache", signal: AbortSignal.timeout(10_000) });
            if (!response.ok) throw new LocalTileError(response.status === 404 || response.status === 410 ? "NOT_FOUND" : "HTTP_ERROR", "Réponse HTTP de tuile LFQO", response.status);
            const bytes = await response.arrayBuffer();
            phase = "VERIFICATION_UNAVAILABLE";
            if (!globalThis.crypto?.subtle) throw new LocalTileError(phase, "Vérification SHA-256 indisponible (contexte sécurisé requis).");
            const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
            if (digest !== tile.sha256) throw new LocalTileError("HASH_MISMATCH", "Empreinte de tuile LFQO différente du manifeste.");
            phase = "INVALID_DATA";
            const data = JSON.parse(new TextDecoder().decode(bytes)) as Collection;
            if (data.type !== "FeatureCollection" || !Array.isArray(data.features) || data.features.length !== tile.features || data.features.some(f =>
              !/^way\/\d+$/.test(String(f.id)) || !["line", "minor_line"].includes(f.properties?.power) || !["LineString", "MultiLineString"].includes(f.geometry?.type))) throw new LocalTileError(phase, "Tuile LFQO invalide.");
            this.cache.set(tile.key, data); this.failures.delete(tile.key); return data;
          } catch (error) {
            const failure = error instanceof LocalTileError ? { status: error.status, httpStatus: error.httpStatus } : {
              status: error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "TIMEOUT" as const : phase,
            };
            this.failures.set(tile.key, failure); throw error;
          }
        })();
        this.pending.set(tile.key, request);
      }
      try { await request; } finally { if (this.pending.get(tile.key) === request) this.pending.delete(tile.key); }
    }));
  }
}
function localTileIssueLabel(diagnostics: LFQOTileDiagnostic[]): string {
  const count = (status: LFQOTileStatus) => diagnostics.filter(t => t.status === status).length;
  const messages = [
    ...[...new Set(diagnostics.filter(t => t.status === "NOT_FOUND").map(t => t.httpStatus))].map(status => `${diagnostics.filter(t => t.status === "NOT_FOUND" && t.httpStatus === status).length} fichier(s) local(aux) introuvable(s) (HTTP ${status})`),
    ...[...new Set(diagnostics.filter(t => t.status === "HTTP_ERROR").map(t => t.httpStatus))].map(status => `${diagnostics.filter(t => t.status === "HTTP_ERROR" && t.httpStatus === status).length} erreur(s) HTTP ${status}`),
    count("NETWORK_ERROR") ? `${count("NETWORK_ERROR")} erreur(s) réseau` : "",
    count("TIMEOUT") ? `${count("TIMEOUT")} délai(s) de chargement dépassé(s)` : "",
    count("HASH_MISMATCH") ? `${count("HASH_MISMATCH")} empreinte(s) SHA-256 différente(s) du manifeste` : "",
    count("INVALID_DATA") ? `${count("INVALID_DATA")} tuile(s) invalide(s)` : "",
    count("VERIFICATION_UNAVAILABLE") ? "Vérification SHA-256 indisponible (HTTPS requis)" : "",
    count("NOT_LOADED") ? `${count("NOT_LOADED")} tuile(s) non chargée(s)` : "",
  ];
  return messages.filter(Boolean).join(" · ");
}

const localTiles = new LFQOPowerLineTiles();

/** PreparationMap only. Crossing views stay explicitly partial rather than querying Overpass in LFQO. */
export class PreparationPowerLineRuntime {
  private generation = 0;
  private local = false;
  private fallback: PowerLineRuntime;
  private obstacles?: ObstacleRuntime;
  private publish: (state: PreparationPowerLineState) => void;
  private tiles: LFQOPowerLineTiles;
  constructor(publish: (state: PreparationPowerLineState) => void, store: PowerLineMemoryStore = powerLineMemoryStore, publishObstacles?: (state: ObstacleState) => void, tiles = localTiles) {
    this.publish = publish; this.tiles = tiles;
    this.fallback = new PowerLineRuntime(state => { if (!this.local) publish({ ...state, coverageLabel: "Hors extrait local LFQO — lignes Overpass" }); }, store);
    // Preserve the obstacle layer's acquisition and cache independently of the line source.
    if (publishObstacles) this.obstacles = new ObstacleRuntime(publishObstacles, store.obstacles, bounds => store.load(bounds, true));
  }
  stop() { this.generation++; this.fallback.stop(); this.obstacles?.stop(); }
  async update(view: PowerLineBounds, online: boolean, includeObstacles = false): Promise<void> {
    const generation = ++this.generation, coverage = lfqoCoverage(view);
    this.local = coverage !== "OUTSIDE";
    if (!this.local) {
      await Promise.all([this.fallback.update(view, online, includeObstacles), this.obstacles?.update(view, online, includeObstacles)]); return;
    }
    this.fallback.stop();
    const publish = (loading: boolean) => {
      const missing = this.tiles.missing(view), data = this.tiles.data(view), diagnostics = this.tiles.diagnostics(view);
      const covered = coverage === "FULL" && missing === 0;
      const snapshots = manifest.sources.map(s => s.snapshot_at_utc).filter(Boolean).sort();
      this.publish({ data, tileDiagnostics: diagnostics, covered, offline: !online, loading, retained: data.features.length > 0,
        status: missing ? loading ? "LOADING" : data.features.length ? "INCOMPLETE" : "UNAVAILABLE" : covered ? data.features.length ? "AVAILABLE" : "EMPTY_CONFIRMED" : "UNKNOWN_COVERAGE",
        fetchedAt: snapshots[0], localCoverage: coverage === "FULL" ? "FULL" : "PARTIAL", coverageLabel: `Extrait local LFQO · rayon 20 km · ${coverage === "FULL" ? missing ? "couverture incomplète" : "vue couverte" : "couverture partielle : extérieur du disque non chargé"} · OSM du ${snapshots[0]?.slice(0, 10) ?? "date inconnue"} · non exhaustif${!loading && missing ? ` · ${localTileIssueLabel(diagnostics)}` : covered && !data.features.length ? " · extrait vide pour ce filtre" : ""}` });
    };
    publish(online && this.tiles.missing(view) > 0);
    await Promise.all([online ? this.tiles.load(view) : undefined, this.obstacles?.update(view, online, includeObstacles)]);
    if (generation === this.generation) publish(false);
  }
}
export function preparationPowerLineStatusLabel(state: PreparationPowerLineState): string {
  // Local dates describe the source snapshot, never the time of a browser request.
  if (state.localCoverage) return [state.coverageLabel, state.loading ? "Chargement local…" : "", state.offline ? "Hors ligne" : ""].filter(Boolean).join(" · ");
  return [state.coverageLabel, powerLineStatusLabel(state)].filter(Boolean).join(" · ");
}
