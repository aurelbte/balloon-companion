import { getPowerLineQueryBounds, powerLineBoundsContain, powerLineBoundsKey, type PowerLineBounds } from "./powerLines.ts";
import { obstacleQueryBounds, type ObstacleResult } from "./obstacles.ts";
import type { PowerLineStatus } from "./powerLinesRuntime.ts";
export type ObstacleState = { status: PowerLineStatus; data: GeoJSON.FeatureCollection; loading: boolean; covered: boolean; offline: boolean; fetchedAt?: string };
export class ObstacleMemoryStore {
  readonly results = new Map<string, ObstacleResult>();
  readonly partials = new Map<string, ObstacleResult>();
  readonly retryAfter = new Map<string, number>();
  put(result: ObstacleResult) {
    const key = powerLineBoundsKey(result.bounds);
    if (result.complete) { this.results.set(key, result); this.partials.delete(key); }
    else this.partials.set(key, result);
  }
}
export class ObstacleRuntime {
  private generation = 0;
  private publish: (state: ObstacleState) => void;
  private store: ObstacleMemoryStore;
  private load: (bounds: PowerLineBounds) => Promise<unknown>;
  constructor(publish: (state: ObstacleState) => void, store: ObstacleMemoryStore, load: (bounds: PowerLineBounds) => Promise<unknown>) { this.publish = publish; this.store = store; this.load = load; }
  stop() { this.generation++; }
  private snapshot(viewport: PowerLineBounds, online: boolean): ObstacleState {
    const references = [...this.store.results.values(), ...this.store.partials.values()];
    const overlaps = (b: PowerLineBounds) => b.west <= viewport.east && b.east >= viewport.west && b.south <= viewport.north && b.north >= viewport.south;
    const incomplete = [...this.store.partials.values()].some(r => overlaps(r.bounds));
    const covered = !incomplete && [...this.store.results.values()].some(r => powerLineBoundsContain(r.bounds, viewport));
    const features = new Map();
    for (const result of references) for (const f of result.features) features.set(f.id, f);
    const relevant = [...features.values()].some(f => { const [x, y] = f.geometry.coordinates; return x >= viewport.west && x <= viewport.east && y >= viewport.south && y <= viewport.north; });
    const status = incomplete ? "INCOMPLETE" : covered ? relevant ? "AVAILABLE" : "EMPTY_CONFIRMED" : references.length ? "UNKNOWN_COVERAGE" : "UNAVAILABLE";
    return { status, data: { type: "FeatureCollection", features: [...features.values()] }, loading: false, covered, offline: !online, fetchedAt: references.length ? new Date(Math.min(...references.map(r => Date.parse(r.fetchedAt)))).toISOString() : undefined };
  }
  async update(viewport: PowerLineBounds, online: boolean, enabled: boolean) {
    const generation = ++this.generation;
    if (!enabled) return;
    const previous = this.snapshot(viewport, online);
    this.publish(previous);
    if (previous.covered || !online) return;
    const bounds = getPowerLineQueryBounds(viewport), requested = obstacleQueryBounds(bounds);
    // Do not retry an already downloaded capped area on every movement/refresh.
    if (previous.status !== "INCOMPLETE" && [...this.store.results.values()].some(r => powerLineBoundsContain(r.bounds, requested))) return;
    const key = powerLineBoundsKey(requested);
    if (Date.now() < (this.store.retryAfter.get(key) ?? 0)) return;
    this.publish({ ...previous, loading: true, status: previous.data.features.length ? "UNKNOWN_COVERAGE" : "LOADING" });
    try { await this.load(bounds); } catch { /* Each collection keeps its own validated cache. */ }
    // No timer/retry loop: another viewport event may retry after this cooldown.
    this.store.retryAfter.set(key, Date.now() + 30_000);
    if (generation === this.generation) this.publish(this.snapshot(viewport, online));
  }
}
export function obstacleStatusLabel(state: ObstacleState) {
  const label = { LOADING: "Chargement des obstacles…", AVAILABLE: "", EMPTY_CONFIRMED: "Aucun obstacle OSM dans la zone chargée", UNAVAILABLE: "Obstacles : données indisponibles", INCOMPLETE: "Obstacles : données incomplètes", UNKNOWN_COVERAGE: "Obstacles : couverture non vérifiée" }[state.status];
  return [label, state.offline ? "Hors ligne" : "", state.fetchedAt && (state.offline || (label && state.data.features.length > 0)) ? `Données conservées du ${new Date(state.fetchedAt).toLocaleString("fr-FR")}` : ""].filter(Boolean).join(" · ");
}
