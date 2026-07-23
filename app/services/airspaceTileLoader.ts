import {
  AIRSPACE_CACHE_SCHEMA_VERSION,
  getAirspaceCacheFreshness,
  type AirspaceCacheAdapter,
  type CachedAirspaceTile,
} from "../lib/airspaceCache.ts";
import type { AirspaceFeatureCollection } from "../lib/openaip.ts";
import type { AirspaceTile } from "../lib/airspaceTiles.ts";

export type AirspaceTileStatus =
  | "NOT_REQUESTED"
  | "QUEUED"
  | "LOADING"
  | "FRESH"
  | "STALE_USABLE"
  | "ERROR";

export type AirspaceLoadPriority = "GPS" | "EXPLORATION";

export interface AirspaceTileLoadResult {
  tile: CachedAirspaceTile | null;
  status: AirspaceTileStatus;
  source: "NETWORK" | "CACHE" | null;
}

export class AirspaceHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(
    status: number,
    retryAfterMs: number | null = null,
  ) {
    super(`OpenAIP HTTP ${status}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

interface QueueItem {
  tile: AirspaceTile;
  priority: number;
  signal?: AbortSignal;
  fallback: CachedAirspaceTile | null;
  resolve: (result: AirspaceTileLoadResult) => void;
}

interface AirspaceTileLoaderOptions {
  cache: AirspaceCacheAdapter;
  fetchTile: (
    tile: AirspaceTile,
    signal?: AbortSignal,
  ) => Promise<AirspaceFeatureCollection>;
  onTileUpdate?: (
    tile: CachedAirspaceTile,
    status: AirspaceTileStatus,
    source: "CACHE" | "NETWORK",
  ) => void;
  onStatusChange?: (tileId: string, status: AirspaceTileStatus) => void;
  maxConcurrency?: number;
  maxAttempts?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class AirspaceTileLoader {
  private readonly queue: QueueItem[] = [];
  private readonly cacheRequests = new Map<string, Promise<AirspaceTileLoadResult>>();
  private readonly networkRequests = new Map<string, Promise<AirspaceTileLoadResult>>();
  private activeRequests = 0;
  private sequence = 0;
  private readonly options: AirspaceTileLoaderOptions;

  constructor(options: AirspaceTileLoaderOptions) {
    this.options = options;
  }

  requestTile(
    tile: AirspaceTile,
    priority: AirspaceLoadPriority,
    signal?: AbortSignal,
  ): Promise<AirspaceTileLoadResult> {
    const existing =
      this.cacheRequests.get(tile.tileId) ??
      this.networkRequests.get(tile.tileId);
    if (existing) return existing;

    const request = this.loadCacheFirst(tile, priority, signal).finally(() => {
      this.cacheRequests.delete(tile.tileId);
    });
    this.cacheRequests.set(tile.tileId, request);
    return request;
  }

  private async loadCacheFirst(
    tile: AirspaceTile,
    priority: AirspaceLoadPriority,
    signal?: AbortSignal,
  ): Promise<AirspaceTileLoadResult> {
    let cached: CachedAirspaceTile | null = null;
    try {
      cached = await this.options.cache.get(tile.tileId);
    } catch {
      cached = null;
    }
    const freshness = getAirspaceCacheFreshness(
      cached,
      (this.options.now ?? Date.now)(),
    );

    if (cached && freshness !== "MISSING") {
      const status = freshness === "FRESH" ? "FRESH" : "STALE_USABLE";
      this.options.onTileUpdate?.(cached, status, "CACHE");
      this.options.onStatusChange?.(tile.tileId, status);
      if (freshness === "FRESH") {
        return { tile: cached, status, source: "CACHE" };
      }
      void this.enqueueNetwork(tile, priority, signal, cached);
      return { tile: cached, status, source: "CACHE" };
    }

    return this.enqueueNetwork(tile, priority, signal, null);
  }

  private enqueueNetwork(
    tile: AirspaceTile,
    priority: AirspaceLoadPriority,
    signal: AbortSignal | undefined,
    fallback: CachedAirspaceTile | null,
  ): Promise<AirspaceTileLoadResult> {
    const existing = this.networkRequests.get(tile.tileId);
    if (existing) return existing;

    const promise = new Promise<AirspaceTileLoadResult>((resolve) => {
      this.sequence += 1;
      this.queue.push({
        tile,
        priority: (priority === "GPS" ? 0 : 10) * 1_000_000 + this.sequence,
        signal,
        fallback,
        resolve,
      });
      this.queue.sort((left, right) => left.priority - right.priority);
      this.options.onStatusChange?.(tile.tileId, "QUEUED");
      this.processQueue();
    }).finally(() => {
      this.networkRequests.delete(tile.tileId);
    });
    this.networkRequests.set(tile.tileId, promise);
    return promise;
  }

  private processQueue(): void {
    const maxConcurrency = this.options.maxConcurrency ?? 2;
    while (this.activeRequests < maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) return;
      if (item.signal?.aborted) {
        item.resolve({
          tile: item.fallback,
          status: item.fallback ? "STALE_USABLE" : "ERROR",
          source: item.fallback ? "CACHE" : null,
        });
        continue;
      }
      this.activeRequests += 1;
      void this.executeNetwork(item, item.fallback).finally(() => {
        this.activeRequests -= 1;
        this.processQueue();
      });
    }
  }

  private async executeNetwork(
    item: QueueItem,
    fallback: CachedAirspaceTile | null,
  ): Promise<void> {
    this.options.onStatusChange?.(item.tile.tileId, "LOADING");
    const maxAttempts = this.options.maxAttempts ?? 3;
    const sleep =
      this.options.sleep ??
      ((milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const airspaces = await this.options.fetchTile(item.tile, item.signal);
        const cachedTile: CachedAirspaceTile = {
          tileId: item.tile.tileId,
          bounds: item.tile.bounds,
          fetchedAt: (this.options.now ?? Date.now)(),
          sourceUpdatedAt: null,
          schemaVersion: AIRSPACE_CACHE_SCHEMA_VERSION,
          airspaces: airspaces.features,
        };
        await this.options.cache.put(cachedTile);
        this.options.onTileUpdate?.(cachedTile, "FRESH", "NETWORK");
        this.options.onStatusChange?.(item.tile.tileId, "FRESH");
        item.resolve({ tile: cachedTile, status: "FRESH", source: "NETWORK" });
        return;
      } catch (error) {
        const canRetry =
          error instanceof AirspaceHttpError &&
          error.status === 429 &&
          attempt < maxAttempts &&
          !item.signal?.aborted;
        if (canRetry) {
          const exponentialBackoff = 1_000 * 2 ** (attempt - 1);
          await sleep(Math.max(exponentialBackoff, error.retryAfterMs ?? 0));
          continue;
        }

        const status = fallback ? "STALE_USABLE" : "ERROR";
        if (fallback) this.options.onTileUpdate?.(fallback, status, "CACHE");
        this.options.onStatusChange?.(item.tile.tileId, status);
        item.resolve({
          tile: fallback,
          status,
          source: fallback ? "CACHE" : null,
        });
        return;
      }
    }
  }
}

export interface AirspaceCoverageStatus {
  status: "COMPLETE" | "LOADING" | "PARTIAL" | "UNAVAILABLE";
  fromCache: boolean;
}

export function aggregateAirspaceCoverageStatus(
  tileIds: string[],
  statuses: ReadonlyMap<string, AirspaceTileStatus>,
): AirspaceCoverageStatus {
  if (tileIds.length === 0) return { status: "UNAVAILABLE", fromCache: false };
  const values = tileIds.map((tileId) => statuses.get(tileId) ?? "NOT_REQUESTED");
  const usable = values.filter(
    (status) => status === "FRESH" || status === "STALE_USABLE",
  );
  const loading = values.some(
    (status) => status === "QUEUED" || status === "LOADING",
  );
  return {
    status:
      usable.length === values.length
        ? "COMPLETE"
        : loading && usable.length === 0
          ? "LOADING"
          : usable.length > 0
            ? "PARTIAL"
            : loading
              ? "LOADING"
              : "UNAVAILABLE",
    fromCache: values.some((status) => status === "STALE_USABLE"),
  };
}
