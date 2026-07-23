import type { AirspaceFeatureCollection } from "./openaip.ts";
import type { GeographicBounds } from "./airspaceTiles.ts";
import { getFranceAirspaceTiles } from "./airspaceTiles.ts";

export const AIRSPACE_CACHE_SCHEMA_VERSION = 1;
export const AIRSPACE_CACHE_FRESH_MS = 24 * 60 * 60 * 1000;

export type AirspaceCacheFreshness = "FRESH" | "STALE_USABLE" | "MISSING";

export interface CachedAirspaceTile {
  tileId: string;
  bounds: GeographicBounds;
  fetchedAt: number;
  sourceUpdatedAt: number | null;
  schemaVersion: number;
  airspaces: AirspaceFeatureCollection["features"];
}

export interface AirspaceCacheAdapter {
  get(tileId: string): Promise<CachedAirspaceTile | null>;
  put(tile: CachedAirspaceTile): Promise<void>;
  list(): Promise<CachedAirspaceTile[]>;
}

export function getAirspaceCacheFreshness(
  tile: CachedAirspaceTile | null,
  now = Date.now(),
): AirspaceCacheFreshness {
  if (!tile || tile.schemaVersion !== AIRSPACE_CACHE_SCHEMA_VERSION) {
    return "MISSING";
  }
  return now - tile.fetchedAt <= AIRSPACE_CACHE_FRESH_MS
    ? "FRESH"
    : "STALE_USABLE";
}

export function getNationalAirspaceCacheProgress(
  cachedTiles: CachedAirspaceTile[],
): { downloaded: number; total: number } {
  const nationalIds = new Set(
    getFranceAirspaceTiles().map((tile) => tile.tileId),
  );
  return {
    downloaded: new Set(
      cachedTiles
        .filter((tile) => nationalIds.has(tile.tileId))
        .map((tile) => tile.tileId),
    ).size,
    total: nationalIds.size,
  };
}

export function getNationalTilesNeedingUpdate(
  cachedTiles: CachedAirspaceTile[],
  now = Date.now(),
): string[] {
  const cachedById = new Map(cachedTiles.map((tile) => [tile.tileId, tile]));
  return getFranceAirspaceTiles()
    .filter(
      (tile) =>
        getAirspaceCacheFreshness(cachedById.get(tile.tileId) ?? null, now) !==
        "FRESH",
    )
    .map((tile) => tile.tileId);
}

export class MemoryAirspaceCache implements AirspaceCacheAdapter {
  private readonly tiles = new Map<string, CachedAirspaceTile>();
  async get(tileId: string) {
    return this.tiles.get(tileId) ?? null;
  }
  async put(tile: CachedAirspaceTile) {
    this.tiles.set(tile.tileId, tile);
  }
  async list() {
    return [...this.tiles.values()];
  }
}

export class IndexedDbAirspaceCache implements AirspaceCacheAdapter {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB unavailable"));
    }
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open("balloon-companion-airspaces", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("tiles")) {
          request.result.createObjectStore("tiles", { keyPath: "tileId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.databasePromise;
  }

  async get(tileId: string): Promise<CachedAirspaceTile | null> {
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const request = database.transaction("tiles").objectStore("tiles").get(tileId);
      request.onsuccess = () => resolve((request.result as CachedAirspaceTile) ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async put(tile: CachedAirspaceTile): Promise<void> {
    const database = await this.database();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("tiles", "readwrite");
      transaction.objectStore("tiles").put(tile);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async list(): Promise<CachedAirspaceTile[]> {
    const database = await this.database();
    return new Promise((resolve, reject) => {
      const request = database.transaction("tiles").objectStore("tiles").getAll();
      request.onsuccess = () => resolve(request.result as CachedAirspaceTile[]);
      request.onerror = () => reject(request.error);
    });
  }
}
