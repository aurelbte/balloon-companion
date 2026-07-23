import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRSPACE_CACHE_FRESH_MS,
  AIRSPACE_CACHE_SCHEMA_VERSION,
  MemoryAirspaceCache,
  getAirspaceCacheFreshness,
  getNationalAirspaceCacheProgress,
  getNationalTilesNeedingUpdate,
} from "./airspaceCache.ts";
import { getFranceAirspaceTiles } from "./airspaceTiles.ts";

function cachedTile(fetchedAt) {
  return {
    tileId: "tile",
    bounds: { west: 0, south: 0, east: 1, north: 1 },
    fetchedAt,
    sourceUpdatedAt: null,
    schemaVersion: AIRSPACE_CACHE_SCHEMA_VERSION,
    airspaces: [],
  };
}

test("distingue cache frais, ancien utilisable et absent", async () => {
  const now = 1_000_000_000;
  assert.equal(getAirspaceCacheFreshness(cachedTile(now), now), "FRESH");
  assert.equal(
    getAirspaceCacheFreshness(cachedTile(now - AIRSPACE_CACHE_FRESH_MS - 1), now),
    "STALE_USABLE",
  );
  assert.equal(getAirspaceCacheFreshness(null, now), "MISSING");

  const cache = new MemoryAirspaceCache();
  await cache.put(cachedTile(now));
  assert.equal((await cache.get("tile"))?.fetchedAt, now);
});

test("calcule la progression nationale et les tuiles à reprendre", () => {
  const now = 1_000_000_000;
  const firstNationalTile = getFranceAirspaceTiles()[0];
  const first = {
    ...cachedTile(now),
    tileId: firstNationalTile.tileId,
    bounds: firstNationalTile.bounds,
  };
  const progress = getNationalAirspaceCacheProgress([first]);
  assert.equal(progress.downloaded, 1);
  assert.equal(progress.total, 547);
  assert.equal(getNationalTilesNeedingUpdate([first], now).length, 546);
});
