import assert from "node:assert/strict";
import test from "node:test";
import {
  AIRSPACE_CACHE_SCHEMA_VERSION,
  MemoryAirspaceCache,
} from "./airspaceCache.ts";
import {
  AirspaceHttpError,
  AirspaceTileLoader,
  aggregateAirspaceCoverageStatus,
} from "../services/airspaceTileLoader.ts";
import { getAirspaceTileForPosition } from "./airspaceTiles.ts";

const emptyCollection = { type: "FeatureCollection", features: [] };
const tile = getAirspaceTileForPosition(50.631, 3.058);
const cached = (fetchedAt) => ({
  tileId: tile.tileId,
  bounds: tile.bounds,
  fetchedAt,
  sourceUpdatedAt: null,
  schemaVersion: AIRSPACE_CACHE_SCHEMA_VERSION,
  airspaces: [],
});

test("un échec réseau conserve un cache ancien", async () => {
  const cache = new MemoryAirspaceCache();
  await cache.put(cached(0));
  const loader = new AirspaceTileLoader({
    cache,
    now: () => 100_000_000,
    fetchTile: async () => {
      throw new TypeError("offline");
    },
  });
  const result = await loader.requestTile(tile, "GPS");
  assert.equal(result.status, "STALE_USABLE");
  assert.ok(result.tile);
});

test("un échec réseau sans cache retourne ERROR", async () => {
  const loader = new AirspaceTileLoader({
    cache: new MemoryAirspaceCache(),
    fetchTile: async () => {
      throw new TypeError("offline");
    },
  });
  assert.equal((await loader.requestTile(tile, "GPS")).status, "ERROR");
});

test("HTTP 400 n’est pas retenté", async () => {
  let calls = 0;
  const loader = new AirspaceTileLoader({
    cache: new MemoryAirspaceCache(),
    fetchTile: async () => {
      calls += 1;
      throw new AirspaceHttpError(400);
    },
    sleep: async () => {},
  });
  await loader.requestTile(tile, "GPS");
  assert.equal(calls, 1);
});

test("HTTP 429 est retenté avec backoff borné", async () => {
  let calls = 0;
  const waits = [];
  const loader = new AirspaceTileLoader({
    cache: new MemoryAirspaceCache(),
    fetchTile: async () => {
      calls += 1;
      if (calls < 3) throw new AirspaceHttpError(429, 2_500);
      return emptyCollection;
    },
    sleep: async (milliseconds) => waits.push(milliseconds),
  });
  assert.equal((await loader.requestTile(tile, "GPS")).status, "FRESH");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2_500, 2_500]);
});

test("deux requêtes simultanées d’une même tuile sont dédupliquées", async () => {
  let calls = 0;
  const loader = new AirspaceTileLoader({
    cache: new MemoryAirspaceCache(),
    fetchTile: async () => {
      calls += 1;
      return emptyCollection;
    },
  });
  await Promise.all([
    loader.requestTile(tile, "GPS"),
    loader.requestTile(tile, "EXPLORATION"),
  ]);
  assert.equal(calls, 1);
});

test("une requête GPS en attente passe avant l’exploration", async () => {
  const first = getAirspaceTileForPosition(50, 1);
  const exploration = getAirspaceTileForPosition(50, 2);
  const gps = getAirspaceTileForPosition(50, 3);
  const order = [];
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const loader = new AirspaceTileLoader({
    cache: new MemoryAirspaceCache(),
    maxConcurrency: 1,
    fetchTile: async (requestedTile) => {
      order.push(requestedTile.tileId);
      if (requestedTile.tileId === first.tileId) await firstGate;
      return emptyCollection;
    },
  });

  const firstRequest = loader.requestTile(first, "EXPLORATION");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const explorationRequest = loader.requestTile(exploration, "EXPLORATION");
  const gpsRequest = loader.requestTile(gps, "GPS");
  releaseFirst();
  await Promise.all([firstRequest, explorationRequest, gpsRequest]);

  assert.deepEqual(order, [first.tileId, gps.tileId, exploration.tileId]);
});

test("les états agrégés distinguent couverture partielle et complète", () => {
  assert.equal(
    aggregateAirspaceCoverageStatus(
      ["a", "b"],
      new Map([["a", "FRESH"], ["b", "ERROR"]]),
    ).status,
    "PARTIAL",
  );
  assert.equal(
    aggregateAirspaceCoverageStatus(
      ["a", "b"],
      new Map([["a", "FRESH"], ["b", "STALE_USABLE"]]),
    ).status,
    "COMPLETE",
  );
});
