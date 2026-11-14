import { powerLineMemoryStore, type PowerLineMemoryStore } from "./powerLinesRuntime.ts";
import { ObstacleRuntime, type ObstacleState } from "./obstacleRuntime.ts";
import type { PowerLineBounds } from "./powerLines.ts";
import type { PreparationPowerLineRuntime, PreparationPowerLineState } from "./preparationPowerLines.ts";

export const FLIGHT_POWER_LINE_MIN_ZOOM = 8;

type TileModule = Pick<typeof import("./preparationPowerLines.ts"), "PreparationPowerLineRuntime">;
/** Lazy adapter only: all line acquisition, validation and country routing remain in the shared reader. */
export class FlightPowerLineRuntime {
  private runtime: PreparationPowerLineRuntime | null = null;
  private pending: Promise<PreparationPowerLineRuntime | null> | null = null;
  private disposed = false;
  private generation = 0;
  private publish: (state: PreparationPowerLineState) => void;
  private load: () => Promise<TileModule>;
  private store: PowerLineMemoryStore;
  private obstacles?: ObstacleRuntime;
  constructor(publish: (state: PreparationPowerLineState) => void, publishObstacles?: (state: ObstacleState) => void,
    options: { store?: PowerLineMemoryStore; load?: () => Promise<TileModule> } = {}) {
    this.publish = publish;
    this.store = options.store ?? powerLineMemoryStore;
    this.load = options.load ?? (() => import("./preparationPowerLines.ts"));
    // Obstacles work independently without loading the large country indexes or querying electric lines.
    if (publishObstacles) this.obstacles = new ObstacleRuntime(publishObstacles, this.store.obstacles, bounds => this.store.loadObstaclesOnly(bounds));
  }
  private reader(): Promise<PreparationPowerLineRuntime | null> {
    if (this.runtime) return Promise.resolve(this.runtime);
    if (!this.pending) this.pending = this.load().then(module => {
      if (this.disposed) return null;
      this.runtime = new module.PreparationPowerLineRuntime(state => { if (!this.disposed) this.publish(state); },
        this.store, undefined, undefined, undefined, undefined, { allowOverpassFallback: false });
      return this.runtime;
    }).catch(error => { this.pending = null; throw error; });
    return this.pending;
  }
  stopLines() { this.generation++; this.runtime?.stopLines(); }
  stop() { this.disposed = true; this.stopLines(); this.runtime?.stop(); this.obstacles?.stop(); }
  async update(view: PowerLineBounds, online: boolean, includeObstacles = false, linesEnabled = true, zoom = Infinity): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    const obstacles = this.obstacles?.update(view, online, includeObstacles);
    if (!linesEnabled) { this.stopLines(); await obstacles; return; }
    if (zoom < FLIGHT_POWER_LINE_MIN_ZOOM) {
      this.stopLines();
      this.publish({ data: { type: "FeatureCollection", features: [] }, status: "UNKNOWN_COVERAGE", covered: false,
        loading: false, offline: !online, retained: false,
        coverageLabel: "Lignes électriques non chargées à ce zoom — zoomez pour consulter la couverture" });
      await obstacles; return;
    }
    const lines = async () => {
      if (!this.runtime) this.publish({ data: { type: "FeatureCollection", features: [] }, status: "LOADING", covered: false,
        loading: true, offline: !online, retained: false, coverageLabel: "Lignes électriques ≥ 63 kV · couverture non vérifiée" });
      let reader: PreparationPowerLineRuntime | null;
      try { reader = await this.reader(); }
      catch {
        if (!this.disposed && generation === this.generation) this.publish({ data: { type: "FeatureCollection", features: [] }, status: "UNAVAILABLE", covered: false,
          loading: false, offline: !online, retained: false, coverageLabel: "Lignes électriques : chargeur indisponible · couverture non vérifiée" });
        return;
      }
      if (!this.disposed && generation === this.generation) await reader?.update(view, online, false, true);
    };
    await Promise.all([lines(), obstacles]);
  }
}
