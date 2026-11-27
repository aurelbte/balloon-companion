import { canonical, freeze, parseObstacleManifest, parseObstacleTile, ObstacleTileError, OBSTACLE_SAFETY_WARNING, type ErrorCode, type ObstacleManifest, type TileData, type TileEntry, type TileFeature } from "./contract.ts";
import { selectObstacleTiles, type Selection, type Viewport } from "./viewport.ts";
export type RuntimeOptions = { baseUrl: string; manifestSha256?: string; fetchImpl?: typeof fetch; timeoutMs?: number; concurrency?: number;
  maxCacheEntries?: number; maxCacheBytes?: number; maxTilesPerView?: number };
export type TileState = Readonly<{ key: string; status: "NOT_LOADED" | "LOADING" | "LOADED" | "EMPTY" | ErrorCode; httpStatus?: number; data?: TileData; reason?: string }>;
export type ObstacleSnapshot = Readonly<{ generation: number; sourceZoom: 9 | 12 | null; coverage: "UNKNOWN" | "OUTSIDE_COVERAGE" | "PARTIAL" | "INDEXED_STUDY_AREA";
  exhaustive: false; safetyWarning: string; outsideTileCount: number; tiles: TileState[]; features: TileFeature[];
  loadedObservationCount: number | null; physicalObjectCount: null; completeForIndexedSelection: boolean; manifestError?: ErrorCode; manifestHttpStatus?: number; integrityError?: "IDENTITY_CONFLICT";
  conflicts: string[]; conflictingFeatures: TileFeature[]; warnings: string[] }>;
type CacheEntry = { value: unknown; bytes: number };
type Job = { key: string; consumers: Set<symbol>; controller: AbortController; started: boolean; done: boolean; timeout: boolean;
  promise: Promise<unknown>; finish(value?: unknown, error?: ObstacleTileError): void; start(): void };
const errorOf = (error: unknown) => error instanceof ObstacleTileError ? error : new ObstacleTileError("NETWORK_ERROR");

/** One immutable dataset namespace. Multiple independent views share requests and a bounded LRU. */
export class AeronauticalObstacleTileRuntime {
  readonly baseUrl: string;
  private readonly options: Required<Pick<RuntimeOptions, "timeoutMs" | "concurrency" | "maxCacheEntries" | "maxCacheBytes" | "maxTilesPerView">>;
  private readonly fetchImpl: typeof fetch;
  private readonly jobs = new Map<string, Job>();
  private readonly queue: Job[] = [];
  private readonly cache = new Map<string, CacheEntry>();
  private cacheBytes = 0;
  private active = 0;
  private manifestValue: ObstacleManifest | null = null;
  private disposed = false;
  private readonly views = new Set<ObstacleTileView>();
  private readonly config: RuntimeOptions;
  constructor(config: RuntimeOptions) {
    this.config = { ...config };
    const url = new URL(config.baseUrl);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("INVALID_DATASET_URL");
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    this.baseUrl = url.href;
    this.options = { timeoutMs: config.timeoutMs ?? 8_000, concurrency: config.concurrency ?? 4, maxCacheEntries: config.maxCacheEntries ?? 64, maxCacheBytes: config.maxCacheBytes ?? 24 * 1024 * 1024, maxTilesPerView: config.maxTilesPerView ?? 256 };
    for (const [key, value] of Object.entries(this.options)) if (!Number.isSafeInteger(value) || value < (key.startsWith("maxCache") ? 0 : 1)) throw new Error("INVALID_RUNTIME_LIMIT");
    if (this.options.concurrency > 16) throw new Error("INVALID_RUNTIME_LIMIT");
    this.fetchImpl = config.fetchImpl ?? ((...args) => fetch(...args));
  }
  get stats() { return { cacheEntries: this.cache.size, cacheBytes: this.cacheBytes, active: this.active, pending: this.jobs.size }; }
  private cached(key: string): unknown {
    const entry = this.cache.get(key);
    if (entry) { this.cache.delete(key); this.cache.set(key, entry); }
    return entry?.value;
  }
  private remember(key: string, value: unknown, bytes: number) {
    if (!this.options.maxCacheEntries || bytes > this.options.maxCacheBytes) return;
    const previous = this.cache.get(key);
    if (previous) this.cacheBytes -= previous.bytes;
    this.cache.delete(key); this.cache.set(key, { value, bytes }); this.cacheBytes += bytes;
    while (this.cache.size > this.options.maxCacheEntries || this.cacheBytes > this.options.maxCacheBytes) {
      const oldest = this.cache.keys().next().value!; this.cacheBytes -= this.cache.get(oldest)!.bytes; this.cache.delete(oldest);
    }
  }
  private pump() {
    while (!this.disposed && this.active < this.options.concurrency && this.queue.length) {
      const job = this.queue.shift()!;
      if (!job.done) job.start();
    }
  }
  private request<T>(key: string, token: symbol, load: (signal: AbortSignal) => Promise<{ value: T; bytes: number }>): Promise<T> {
    if (this.disposed) return Promise.reject(new ObstacleTileError("CANCELLED"));
    const cached = this.cached(key); if (cached !== undefined) return Promise.resolve(cached as T);
    const existing = this.jobs.get(key);
    if (existing) { existing.consumers.add(token); return existing.promise as Promise<T>; }
    let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const job: Job = { key, promise, consumers: new Set([token]), controller: new AbortController(), started: false, done: false, timeout: false,
      finish: (value, error) => {
        if (job.done) return;
        job.done = true; if (timer !== undefined) clearTimeout(timer);
        job.controller.signal.removeEventListener("abort", abort);
        if (this.jobs.get(key) === job) this.jobs.delete(key);
        if (job.started) this.active--;
        if (error) reject(error); else resolve(value);
        // A completed/cancelled queue entry must not accumulate when the network is stalled.
        const queued = this.queue.indexOf(job); if (queued >= 0) this.queue.splice(queued, 1);
        this.pump();
      },
      start: () => {
        if (job.done) return;
        job.started = true; this.active++;
        const startedAt = globalThis.performance?.now() ?? Date.now();
        timer = setTimeout(() => { job.timeout = true; job.controller.abort(); }, this.options.timeoutMs);
        void Promise.resolve().then(() => { if (job.done || job.controller.signal.aborted) throw new ObstacleTileError("CANCELLED"); return load(job.controller.signal); }).then(result => {
          if (job.done || job.controller.signal.aborted || !job.consumers.size) return;
          if ((globalThis.performance?.now() ?? Date.now()) - startedAt >= this.options.timeoutMs) { job.timeout = true; job.controller.abort(); return; }
          this.remember(key, result.value, result.bytes); job.finish(result.value);
        }, error => job.finish(undefined, errorOf(error)));
      },
    };
    const abort = () => job.finish(undefined, new ObstacleTileError(job.timeout ? "TIMEOUT" : "CANCELLED"));
    job.controller.signal.addEventListener("abort", abort, { once: true });
    this.jobs.set(key, job); this.queue.push(job); this.pump();
    return promise as Promise<T>;
  }
  /** Release only this consumer; another view may still need the same request. */
  release(token: symbol, keep = new Set<string>()) {
    for (const job of [...this.jobs.values()]) if (!keep.has(job.key) && job.consumers.delete(token) && !job.consumers.size) job.controller.abort();
  }
  private async bytes(path: string, signal: AbortSignal, maxBytes: number): Promise<Uint8Array> {
    const response = await this.fetchImpl(new URL(path, this.baseUrl).href, { signal, credentials: "omit", cache: "no-store", redirect: "error" });
    if (!response.ok) throw new ObstacleTileError(response.status === 404 ? "HTTP_404" : response.status === 410 ? "HTTP_410" : "HTTP_ERROR", response.status);
    // Fetch exposes decoded bytes; compressed Content-Length is not the decoded size.
    const reader = response.body?.getReader();
    if (!reader) { const result = new Uint8Array(await response.arrayBuffer()); if (result.byteLength > maxBytes) throw new ObstacleTileError("BODY_TOO_LARGE"); return result; }
    const chunks: Uint8Array[] = []; let size = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        const chunk = await reader.read();
        if (signal.aborted) throw new ObstacleTileError("CANCELLED");
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxBytes) { cancel(); throw new ObstacleTileError("BODY_TOO_LARGE"); }
        chunks.push(chunk.value);
      }
    } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  }
  async readManifest(signal?: AbortSignal): Promise<ObstacleManifest> {
    if (this.disposed || signal?.aborted) throw new ObstacleTileError("CANCELLED");
    if (this.manifestValue) return this.manifestValue;
    const token = Symbol("manifest");
    const pending = this.request("manifest.json", token, async controller => {
      const bytes = await this.bytes("manifest.json", controller, 16 * 1024 * 1024);
      return { value: await parseObstacleManifest(bytes, this.config.manifestSha256), bytes: bytes.byteLength };
    });
    let abort!: () => void;
    const cancelled = new Promise<never>((_, no) => { abort = () => { this.release(token); no(new ObstacleTileError("CANCELLED")); }; signal?.addEventListener("abort", abort, { once: true }); });
    try {
      const manifest = await Promise.race([pending, cancelled]);
      if (signal?.aborted || this.disposed) throw new ObstacleTileError("CANCELLED");
      this.manifestValue = manifest; return manifest;
    } finally { signal?.removeEventListener("abort", abort); this.release(token); }
  }
  tileKey(manifest: ObstacleManifest, entry: TileEntry) { return `${manifest.version}:${entry.key}:${entry.sha256}`; }
  peek(manifest: ObstacleManifest, entry: TileEntry) { return this.cached(this.tileKey(manifest, entry)) as TileData | undefined; }
  state(manifest: ObstacleManifest, entry: TileEntry): "LOADING" | "NOT_LOADED" { return this.jobs.get(this.tileKey(manifest, entry))?.started ? "LOADING" : "NOT_LOADED"; }
  loadTile(manifest: ObstacleManifest, entry: TileEntry, token: symbol) {
    return this.request(this.tileKey(manifest, entry), token, async signal => {
      const bytes = await this.bytes(entry.key, signal, 8 * 1024 * 1024);
      return { value: await parseObstacleTile(bytes, entry, manifest), bytes: bytes.byteLength };
    });
  }
  createView(onChange?: (snapshot: ObstacleSnapshot) => void) {
    if (this.disposed) throw new Error("RUNTIME_DISPOSED");
    const view = new ObstacleTileView(this, this.options.maxTilesPerView, onChange, () => this.views.delete(view)); this.views.add(view); return view;
  }
  dispose() { this.disposed = true; for (const view of [...this.views]) view.close(); for (const job of [...this.jobs.values()]) job.controller.abort(); this.cache.clear(); this.cacheBytes = 0; this.manifestValue = null; }
}

export class ObstacleTileView {
  private generation = 0;
  private readonly token = Symbol("view");
  private closed = false;
  private selection: Selection | null = null;
  private states: TileState[] = [];
  private failure: ErrorCode | undefined;
  private failureHttpStatus: number | undefined;
  private manifestAbort: AbortController | null = null;
  private readonly runtime: AeronauticalObstacleTileRuntime; private readonly budget: number; private readonly onChange?: (snapshot: ObstacleSnapshot) => void; private readonly onClose?: () => void;
  constructor(runtime: AeronauticalObstacleTileRuntime, budget: number, onChange?: (snapshot: ObstacleSnapshot) => void, onClose?: () => void) { this.runtime = runtime; this.budget = budget; this.onChange = onChange; this.onClose = onClose; }
  get snapshot(): ObstacleSnapshot {
    const features = new Map<string, TileFeature>(), observations = new Map<string, string>(), conflicts = new Set<string>(), variants: TileFeature[] = [];
    for (const tile of this.states) for (const feature of tile.data?.features ?? []) {
      const old = features.get(feature.id);
      if (old && canonical(old) !== canonical(feature)) { conflicts.add(feature.id); variants.push(old, feature); }
      else features.set(feature.id, feature);
      for (const observation of feature.properties.observations) {
        const previous = observations.get(observation.observationId), text = canonical(observation);
        if (previous !== undefined && previous !== text) conflicts.add(observation.observationId);
        observations.set(observation.observationId, text);
      }
    }
    const safe: TileFeature[] = [];
    for (const feature of features.values()) {
      if (conflicts.has(feature.id) || feature.properties.memberObservationIds.some(id => conflicts.has(id))) variants.push(feature);
      else safe.push(feature);
    }
    const outside = this.selection?.outsideTileCount ?? 0, complete = this.states.length > 0 && this.states.every(t => t.status === "LOADED" || t.status === "EMPTY") && !conflicts.size;
    return freeze({ generation: this.generation, sourceZoom: this.selection?.zoom ?? null,
      coverage: !this.selection ? "UNKNOWN" : !this.selection.tiles.length ? "OUTSIDE_COVERAGE" : this.selection.partial ? "PARTIAL" : "INDEXED_STUDY_AREA",
      exhaustive: false, safetyWarning: OBSTACLE_SAFETY_WARNING, outsideTileCount: outside, tiles: [...this.states], features: safe,
      loadedObservationCount: this.states.some(t => t.data) ? new Set(safe.flatMap(f => f.properties.memberObservationIds)).size : null, physicalObjectCount: null,
      completeForIndexedSelection: complete, ...(this.failure ? { manifestError: this.failure, ...(this.failureHttpStatus ? { manifestHttpStatus: this.failureHttpStatus } : {}) } : {}), ...(conflicts.size ? { integrityError: "IDENTITY_CONFLICT" as const } : {}), conflicts: [...conflicts], conflictingFeatures: variants,
      warnings: [...(outside || this.selection?.partial ? ["Couverture partielle — liste non exhaustive."] : []), ...(!complete ? ["Données non chargées ou en erreur : absence d’obstacles non établie."] : []), ...(conflicts.size ? ["Identifiants contradictoires : aucune fusion ni sélection arbitraire."] : [])] });
  }
  private publish() { if (!this.closed) { try { this.onChange?.(this.snapshot); } catch { /* Consumer errors must not corrupt loader state. */ } } }
  async update(viewport: Viewport, zoom: number): Promise<{ obsolete: boolean; snapshot: ObstacleSnapshot }> {
    if (this.closed) throw new Error("VIEW_CLOSED");
    const generation = ++this.generation, controller = new AbortController(), old = this.manifestAbort;
    this.manifestAbort = controller; this.failure = undefined; this.failureHttpStatus = undefined; this.selection = null; this.states = []; this.publish();
    const pending = this.runtime.readManifest(controller.signal); old?.abort();
    let manifest: ObstacleManifest;
    try { manifest = await pending; }
    catch (error) {
      if (this.generation === generation && !this.closed) { const issue = errorOf(error); this.failure = issue.code; this.failureHttpStatus = issue.httpStatus; this.selection = null; this.states = []; this.runtime.release(this.token); this.publish(); }
      return { obsolete: this.generation !== generation || this.closed, snapshot: this.snapshot };
    }
    if (this.generation !== generation || this.closed) return { obsolete: true, snapshot: this.snapshot };
    let selection: Selection;
    try { selection = selectObstacleTiles(manifest, viewport, zoom); }
    catch (error) { this.runtime.release(this.token); this.selection = null; this.states = []; this.publish(); throw error; }
    this.selection = selection;
    const keys = new Set(selection.tiles.slice(0, this.budget).map(e => this.runtime.tileKey(manifest, e)));
    this.states = selection.tiles.map((entry, i) => {
      const data = this.runtime.peek(manifest, entry);
      return data ? { key: entry.key, status: data.features.length ? "LOADED" : "EMPTY", data } : { key: entry.key, status: "NOT_LOADED", reason: i >= this.budget ? "VIEW_TILE_BUDGET_EXCEEDED" : "QUEUED" };
    });
    const work = selection.tiles.slice(0, this.budget).map((entry, index) => {
      const request = this.runtime.loadTile(manifest, entry, this.token);
      if (!this.states[index].data) this.states[index] = { key: entry.key, status: this.runtime.state(manifest, entry) };
      return request.then(data => {
        if (this.generation !== generation || this.closed) return;
        this.states[index] = { key: entry.key, status: data.features.length ? "LOADED" : "EMPTY", data }; this.publish();
      }, error => {
        if (this.generation !== generation || this.closed) return;
        const issue = errorOf(error); this.states[index] = { key: entry.key, status: issue.code, ...(issue.httpStatus ? { httpStatus: issue.httpStatus } : {}) }; this.publish();
      });
    });
    this.runtime.release(this.token, keys); this.publish(); await Promise.all(work);
    return { obsolete: this.generation !== generation || this.closed, snapshot: this.snapshot };
  }
  close() { if (this.closed) return; this.closed = true; this.generation++; this.manifestAbort?.abort(); this.runtime.release(this.token); this.selection = null; this.states = []; this.onClose?.(); }
}
