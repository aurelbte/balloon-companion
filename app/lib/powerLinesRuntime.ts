import { getPowerLineQueryBounds, powerLineBoundsContain, powerLineBoundsKey, validatePowerLineResult, type PowerLineBounds, type PowerLineResult } from "./powerLines.ts";
export type PowerLineStatus = "LOADING" | "AVAILABLE" | "EMPTY_CONFIRMED" | "UNAVAILABLE" | "INCOMPLETE" | "UNKNOWN_COVERAGE";
export type PowerLineState = { status: PowerLineStatus; loading: boolean; covered: boolean; offline: boolean; data: GeoJSON.FeatureCollection; fetchedAt?: string; retained: boolean };
export class PowerLineMemoryStore {
  readonly results = new Map<string, PowerLineResult>();
  readonly partialResults = new Map<string, PowerLineResult>();
  private requests = new Map<string, Promise<PowerLineResult>>();
  private fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = (...args) => fetch(...args)) { this.fetcher = fetcher; }
  async load(bounds: PowerLineBounds): Promise<PowerLineResult> {
    const key = powerLineBoundsKey(bounds);
    const existing = this.requests.get(key);
    if (existing) return existing;
    const request = (async () => {
      const params = new URLSearchParams(Object.entries(bounds).map(([name, value]) => [name, String(value)]));
      const response = await this.fetcher(`/api/osm/power-lines?${params}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error("Données de lignes indisponibles");
      const result = validatePowerLineResult(await response.json(), bounds);
      if (result.complete) {
        this.results.set(key, result);
        const partial = this.partialResults.get(key);
        if (partial && Date.parse(result.fetchedAt) >= Date.parse(partial.fetchedAt)) this.partialResults.delete(key);
      }
      else this.partialResults.set(key, result);
      return result;
    })();
    this.requests.set(key, request);
    try { return await request; } finally { if (this.requests.get(key) === request) this.requests.delete(key); }
  }
}
export const powerLineMemoryStore = new PowerLineMemoryStore();
/** Segment/rectangle intersection, including the boundary. */
export function powerLineFeatureIntersectsViewport(feature: GeoJSON.Feature, viewport: PowerLineBounds): boolean {
  if (feature.geometry.type !== "LineString") return false;
  const points = feature.geometry.coordinates;
  for (let index = 1; index < points.length; index++) {
    const [x, y] = points[index - 1], [endX, endY] = points[index];
    const dx = endX - x, dy = endY - y;
    let enter = 0, leave = 1;
    let intersects = true;
    for (const [direction, distance] of [[-dx, x - viewport.west], [dx, viewport.east - x], [-dy, y - viewport.south], [dy, viewport.north - y]]) {
      if (direction === 0) { if (distance < 0) { intersects = false; break; } }
      else {
        const boundary = distance / direction;
        if (direction < 0) enter = Math.max(enter, boundary);
        else leave = Math.min(leave, boundary);
        if (enter > leave) { intersects = false; break; }
      }
    }
    if (intersects) return true;
  }
  return false;
}
export class PowerLineRuntime {
  private generation = 0;
  private publish: (state: PowerLineState) => void;
  private store: PowerLineMemoryStore;
  constructor(publish: (state: PowerLineState) => void, store = powerLineMemoryStore) { this.publish = publish; this.store = store; }
  stop() { this.generation++; }
  private snapshot(viewport: PowerLineBounds, offline: boolean): PowerLineState {
    const results = [...this.store.results.values()];
    const covering = results.filter(result => result.complete && powerLineBoundsContain(result.bounds, viewport));
    const partials = [...this.store.partialResults.values()].filter(partial => !results.some(result =>
      powerLineBoundsContain(result.bounds, partial.bounds) && Date.parse(result.fetchedAt) > Date.parse(partial.fetchedAt),
    ));
    const features = new Map<number | string, GeoJSON.Feature>();
    for (const partial of partials) for (const feature of partial.features) features.set(feature.id!, feature);
    for (const result of results) for (const feature of result.features) features.set(feature.id!, feature);
    const data = { type: "FeatureCollection" as const, features: [...features.values()] };
    const relevantPartials = partials.filter(result =>
      (result.bounds.west <= viewport.east && result.bounds.east >= viewport.west && result.bounds.south <= viewport.north && result.bounds.north >= viewport.south) ||
      result.features.some(feature => powerLineFeatureIntersectsViewport(feature, viewport)),
    );
    const hasRelevantFeatures = data.features.some(feature => powerLineFeatureIntersectsViewport(feature, viewport));
    const references = [...results, ...partials];
    const relevantReferences = references.filter(result => covering.includes(result) || relevantPartials.includes(result) || result.features.some(feature => powerLineFeatureIntersectsViewport(feature, viewport)));
    const datedReferences = relevantReferences.length ? relevantReferences : references;
    const fetchedAt = datedReferences.length ? new Date(Math.min(...datedReferences.map(result => Date.parse(result.fetchedAt)))).toISOString() : undefined;
    const covered = covering.length > 0 && relevantPartials.length === 0;
    const status = relevantPartials.length ? "INCOMPLETE" : covered ? hasRelevantFeatures || covering.some(result => !result.emptyConfirmed) ? "AVAILABLE" : "EMPTY_CONFIRMED" : references.length ? "UNKNOWN_COVERAGE" : "UNAVAILABLE";
    return { status, covered, loading: false, offline, data, fetchedAt, retained: references.length > 0 };
  }
  async update(viewport: PowerLineBounds, online: boolean): Promise<void> {
    const generation = ++this.generation;
    const previous = this.snapshot(viewport, !online);
    this.publish(previous);
    if (previous.covered || !online || (previous.status === "INCOMPLETE" && [...this.store.results.values()].some(result => powerLineBoundsContain(result.bounds, viewport)))) return;
    this.publish({ ...previous, status: previous.retained ? "UNKNOWN_COVERAGE" : "LOADING", loading: true });
    try {
      const bounds = getPowerLineQueryBounds(viewport);
      const cached = [...this.store.results.values()].find(result => result.complete && powerLineBoundsContain(result.bounds, bounds));
      const result = cached ?? await this.store.load(bounds);
      if (generation !== this.generation) return;
      const next = this.snapshot(viewport, !online);
      this.publish({ ...next, status: !result.complete ? "INCOMPLETE" : next.covered ? next.status : "UNKNOWN_COVERAGE" });
    } catch {
      if (generation !== this.generation) return;
      const retained = this.snapshot(viewport, !online);
      this.publish({ ...retained, status: retained.retained ? "UNKNOWN_COVERAGE" : "UNAVAILABLE" });
    }
  }
}
export function powerLineStatusLabel(state: PowerLineState): string {
  const label = { LOADING: "Chargement des lignes…", AVAILABLE: "", EMPTY_CONFIRMED: "Aucune ligne connue dans la zone chargée", UNAVAILABLE: "Lignes : données indisponibles", INCOMPLETE: "Lignes : données incomplètes", UNKNOWN_COVERAGE: "Couverture des lignes non vérifiée" }[state.status];
  const retained = state.retained && (state.offline || ["UNAVAILABLE", "INCOMPLETE", "UNKNOWN_COVERAGE"].includes(state.status)) ? state.offline ? "Hors ligne — dernières données conservées" : "Dernières données de lignes conservées" : "";
  const date = state.fetchedAt && (label || retained) ? `Récupérées le ${new Date(state.fetchedAt).toLocaleString("fr-FR")}` : "";
  return [label, state.loading && state.status !== "LOADING" ? "Chargement…" : "", retained, date].filter(Boolean).join(" · ");
}
