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
import { AirspaceTimeoutError } from "./airspaceLoadState.ts";
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
    sleep: async () => {},
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
    sleep: async () => {},
    fetchTile: async () => {
      throw new TypeError("offline");
    },
  });
  assert.equal((await loader.requestTile(tile, "GPS")).status, "ERROR");
});

test("hors ligne réel sans cache n'appelle pas le réseau", async () => {
  let calls = 0;
  let failure;
  const loader = new AirspaceTileLoader({
    cache: new MemoryAirspaceCache(),
    isOnline: () => false,
    onLoadError: (_tileId, nextFailure) => {
      failure = nextFailure;
    },
    fetchTile: async () => {
      calls += 1;
      return emptyCollection;
    },
  });
  assert.equal((await loader.requestTile(tile, "GPS")).status, "ERROR");
  assert.equal(calls, 0);
  assert.equal(failure.category, "OFFLINE");
});

test("hors ligne avec cache conserve les données sans appel réseau", async () => {
  const cache = new MemoryAirspaceCache();
  await cache.put(cached(0));
  let calls = 0;
  const loader = new AirspaceTileLoader({
    cache,
    now: () => 100_000_000,
    isOnline: () => false,
    fetchTile: async () => {
      calls += 1;
      return emptyCollection;
    },
  });
  const result = await loader.requestTile(tile, "GPS");
  assert.equal(result.status, "STALE_USABLE");
  assert.ok(result.tile);
  assert.equal(calls, 0);
});

test("un cache frais est affiché puis actualisé une seule fois en arrière-plan", async () => {
  const cache = new MemoryAirspaceCache();
  await cache.put(cached(100));
  let calls = 0;
  const loader = new AirspaceTileLoader({
    cache,
    now: () => 100,
    isOnline: () => true,
    fetchTile: async () => {
      calls += 1;
      return emptyCollection;
    },
  });
  assert.equal((await loader.requestTile(tile, "GPS")).source, "CACHE");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await loader.requestTile(tile, "GPS");
  assert.equal(calls, 1);
});

test("connecté, classe timeout, HTTP et parsing sans faux hors ligne", async () => {
  for (const [error, expectedCategory] of [
    [new AirspaceTimeoutError(), "TIMEOUT"],
    [new AirspaceHttpError(503), "HTTP_ERROR"],
    [new SyntaxError("invalid JSON"), "PARSE_ERROR"],
  ]) {
    let failure;
    const loader = new AirspaceTileLoader({
      cache: new MemoryAirspaceCache(),
      isOnline: () => true,
      onLoadError: (_tileId, nextFailure) => {
        failure = nextFailure;
      },
      sleep: async () => {},
      fetchTile: async () => {
        throw error;
      },
    });
    assert.equal((await loader.requestTile(tile, "GPS")).status, "ERROR");
    assert.equal(failure.category, expectedCategory);
  }
});

test("une réponse valide avec données est mise en cache", async () => {
  const feature = {
    type: "Feature",
    id: "ctr",
    properties: { airspaceId: "ctr" },
    geometry: {
      type: "Polygon",
      coordinates: [[[3, 50], [4, 50], [4, 51], [3, 50]]],
    },
  };
  const loader = new AirspaceTileLoader({
    cache: new MemoryAirspaceCache(),
    fetchTile: async () => ({
      type: "FeatureCollection",
      features: [feature],
    }),
  });
  const result = await loader.requestTile(tile, "GPS");
  assert.equal(result.status, "FRESH");
  assert.equal(result.tile.airspaces.length, 1);
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
