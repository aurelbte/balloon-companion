import test from "node:test";
import assert from "node:assert/strict";
import {
  combineLocalDateAndTime,
  durationMinutesToSeconds,
  optionalVerticalRate,
  trajectoryErrorMessage,
  trajectoryModeLabel,
  validateTrajectoryProjectionRequest,
} from "./trajectory/integration.ts";
import {
  buildTrajectoryTimeMarkers,
  interpolateTrajectoryPoint,
  isTrajectoryRenderable,
  trajectoryBounds,
  trajectoryToGeoJson,
} from "./trajectory/mapProjection.ts";
import { orchestrateTrajectoryProjection } from "./trajectory/projectionServer.ts";
import {
  getTrajectoryProjection,
  getTrajectoryAnalysisRequest,
  saveTrajectoryAnalysisRequest,
  saveTrajectoryProjection,
} from "./trajectory/projectionStorage.ts";
import { TrajectoryDomainError } from "./trajectory/types.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";

function request(overrides = {}) {
  return {
    launchSite: {
      name: "Bondues",
      latitude: 50.631,
      longitude: 3.058,
    },
    launchDateTimeIso: "2026-07-27T04:00:00.000Z",
    durationSeconds: 3_600,
    targetAltitudeAmslM: 600,
    weatherModel: "arome_seamless",
    ...overrides,
  };
}

function windSample(query) {
  return {
    query,
    wind: { speedMps: 5, directionFromDeg: 270 },
    sourceModel: query.weatherModel,
    sourceLatitude: query.latitude,
    sourceLongitude: query.longitude,
    sourceSlices: [
      {
        validAt: query.validAt,
        wind: { speedMps: 5, directionFromDeg: 270 },
        lowerLevel: {
          geopotentialHeightAmslM: 0,
          windSpeedMps: 5,
          windDirectionFromDeg: 270,
        },
        upperLevel: {
          geopotentialHeightAmslM: 2_000,
          windSpeedMps: 5,
          windDirectionFromDeg: 270,
        },
        verticalInterpolationRatio: query.altitudeAmslM / 2_000,
      },
    ],
    warnings: [],
  };
}

function dependencies(elevation = 100) {
  let preparations = 0;
  return {
    get preparations() {
      return preparations;
    },
    async getTerrainAltitude() {
      if (elevation instanceof Error) throw elevation;
      return elevation;
    },
    createWindProvider() {
      return {
        async getWind(query) {
          return windSample(query);
        },
        async prepareProjection() {
          preparations += 1;
          return {
            async getWind(query) {
              return windSample(query);
            },
          };
        },
      };
    },
  };
}

test("valide une requête complète et conserve seulement les taux présents", () => {
  const result = validateTrajectoryProjectionRequest(
    request({ climbRateMps: 3, descentRateMps: 2 }),
  );
  assert.equal(result.launchSite.latitude, 50.631);
  assert.equal(result.climbRateMps, 3);
  assert.equal(result.descentRateMps, 2);
});

test("refuse point, durée, altitude et taux invalides", () => {
  assert.throws(
    () =>
      validateTrajectoryProjectionRequest(
        request({ launchSite: { name: "Texte seul" } }),
      ),
    { message: "INVALID_COORDINATES" },
  );
  assert.throws(
    () => validateTrajectoryProjectionRequest(request({ durationSeconds: 0 })),
    { message: "INVALID_DURATION" },
  );
  assert.throws(
    () =>
      validateTrajectoryProjectionRequest(
        request({ targetAltitudeAmslM: Number.NaN }),
      ),
    { message: "INVALID_TARGET_ALTITUDE" },
  );
  assert.throws(
    () => validateTrajectoryProjectionRequest(request({ climbRateMps: 0 })),
    { message: "INVALID_CLIMB_RATE" },
  );
});

test("convertit les minutes en secondes", () => {
  assert.equal(durationMinutesToSeconds(45), 2_700);
  assert.equal(optionalVerticalRate(0), undefined);
  assert.equal(optionalVerticalRate(2.5), 2.5);
  assert.equal(optionalVerticalRate(7), 7);
});

test("combine date et heure selon le fuseau local sans décalage involontaire", () => {
  const iso = combineLocalDateAndTime("2026-07-27", "06:15");
  assert.ok(iso);
  const local = new Date(iso);
  assert.equal(local.getFullYear(), 2026);
  assert.equal(local.getMonth(), 6);
  assert.equal(local.getDate(), 27);
  assert.equal(local.getHours(), 6);
  assert.equal(local.getMinutes(), 15);
  assert.equal(combineLocalDateAndTime("2026-02-31", "06:15"), null);
});

for (const [label, rates, mode] of [
  ["constante", {}, "constant-altitude"],
  ["montée", { climbRateMps: 3 }, "climb-then-level"],
  ["descente", { descentRateMps: 2 }, "level-then-descent"],
  [
    "montée et descente",
    { climbRateMps: 3, descentRateMps: 2 },
    "climb-level-descent",
  ],
]) {
  test(`orchestre une projection ${label}`, async () => {
    const deps = dependencies();
    const result = await orchestrateTrajectoryProjection(
      request(rates),
      deps,
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.projection.mode, mode);
    assert.ok(result.body.projection.points.length > 1);
    assert.equal(result.body.metadata.terrainAltitudeAmslM, 100);
    assert.equal(result.body.metadata.launchSite.terrainAltitudeAmslM, 100);
    assert.equal(deps.preparations, 1);
  });
}

test("ne remplace jamais une élévation indisponible par zéro", async () => {
  const withoutRate = await orchestrateTrajectoryProjection(
    request(),
    dependencies(new Error("offline")),
  );
  assert.equal(withoutRate.body.ok, true);
  assert.equal(
    "terrainAltitudeAmslM" in withoutRate.body.metadata,
    false,
  );

  const withRate = await orchestrateTrajectoryProjection(
    request({ climbRateMps: 2 }),
    dependencies(new Error("offline")),
  );
  assert.equal(withRate.status, 503);
  assert.equal(withRate.body.ok, false);
  assert.equal(withRate.body.error.code, "TERRAIN_ALTITUDE_REQUIRED");
});

test("traduit les principales erreurs métier", () => {
  for (const code of [
    "TARGET_BELOW_TERRAIN",
    "TERRAIN_ALTITUDE_REQUIRED",
    "INSUFFICIENT_DURATION_FOR_VERTICAL_PROFILE",
    "ALTITUDE_NOT_BRACKETED",
  ]) {
    assert.notEqual(
      trajectoryErrorMessage(code),
      trajectoryErrorMessage("UNKNOWN"),
    );
  }
  assert.equal(
    trajectoryModeLabel("climb-level-descent"),
    "Montée, palier et descente",
  );
});

test("propage une altitude météo non encadrée sans projection partielle", async () => {
  const result = await orchestrateTrajectoryProjection(request(), {
    async getTerrainAltitude() {
      return 100;
    },
    createWindProvider() {
      return {
        async getWind() {
          throw new TrajectoryDomainError(
            "ALTITUDE_NOT_BRACKETED",
            "non encadrée",
          );
        },
      };
    },
  });
  assert.equal(result.status, 422);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.error.code, "ALTITUDE_NOT_BRACKETED");
});

test("le GeoJSON reprend exactement les points et les bounds", async () => {
  const result = await orchestrateTrajectoryProjection(
    request({ durationSeconds: 600 }),
    dependencies(),
  );
  const projection = result.body.projection;
  assert.equal(isTrajectoryRenderable(projection), true);
  const geoJson = trajectoryToGeoJson(projection);
  assert.deepEqual(geoJson.features[0].geometry.coordinates[0], [
    projection.points[0].longitude,
    projection.points[0].latitude,
  ]);
  assert.deepEqual(geoJson.features[0].geometry.coordinates.at(-1), [
    projection.points.at(-1).longitude,
    projection.points.at(-1).latitude,
  ]);
  const bounds = trajectoryBounds(projection);
  assert.ok(bounds[0][0] <= bounds[1][0]);
  assert.ok(bounds[0][1] <= bounds[1][1]);
});

test("une projection de moins de deux points est explicitement non traçable", () => {
  const projection = {
    mode: "constant-altitude",
    spatialStrategy: "launch-column",
    points: [
      {
        latitude: 50.631,
        longitude: 3.058,
        altitudeAmslM: 600,
        elapsedSeconds: 0,
        timestamp: "2026-07-27T04:00:00.000Z",
        verticalPhase: "initial",
      },
    ],
    startedAt: "2026-07-27T04:00:00.000Z",
    endedAt: "2026-07-27T04:00:00.000Z",
    durationSeconds: 0,
    stepSeconds: 20,
    targetAltitudeAmslM: 600,
    verticalProfile: { targetAltitudeAmslM: 600 },
    weatherModel: "arome_seamless",
    weatherSourceModels: [],
    warnings: [],
  };
  assert.equal(isTrajectoryRenderable(projection), false);
});

test("interpole un marqueur temporel sans vent ni recalcul météo", () => {
  const points = [
    {
      latitude: 50,
      longitude: 3,
      altitudeAmslM: 100,
      elapsedSeconds: 0,
      timestamp: "2026-07-27T04:00:00.000Z",
      verticalPhase: "initial",
    },
    {
      latitude: 52,
      longitude: 5,
      altitudeAmslM: 300,
      elapsedSeconds: 600,
      timestamp: "2026-07-27T04:10:00.000Z",
      verticalPhase: "level",
    },
  ];
  const middle = interpolateTrajectoryPoint(points, 300);
  assert.equal(middle.latitude, 51);
  assert.equal(middle.longitude, 4);
  assert.equal(middle.altitudeAmslM, 200);
  assert.equal(middle.windUsed, undefined);
});

test("crée le marqueur 5 minutes et omet ceux hors durée", async () => {
  const result = await orchestrateTrajectoryProjection(
    request({ durationSeconds: 600 }),
    dependencies(),
  );
  const markers = buildTrajectoryTimeMarkers(result.body.projection);
  assert.deepEqual(
    markers.map((marker) => marker.minutes),
    [5, 10],
  );
});

test("stocke uniquement une projection réussie versionnée", async () => {
  const data = new Map();
  globalThis.window = {};
  globalThis.sessionStorage = {
    setItem(key, value) {
      data.set(key, value);
    },
    getItem(key) {
      return data.get(key) ?? null;
    },
  };
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "projection-user" } });
  const result = await orchestrateTrajectoryProjection(
    request({ durationSeconds: 600 }),
    dependencies(),
  );
  const stored = {
    version: 1,
    createdAtIso: "2026-07-27T04:00:00.000Z",
    request: request({ durationSeconds: 600 }),
    response: result.body,
  };
  assert.equal(saveTrajectoryProjection(stored), true);
  const restored = getTrajectoryProjection();
  assert.deepEqual(restored, stored);
  assert.equal(
    restored.response.projection.points.length,
    result.body.projection.points.length,
  );
  assert.equal(
    saveTrajectoryProjection({ ...stored, response: { ok: false } }),
    false,
  );
  delete globalThis.window;
  delete globalThis.sessionStorage;
});

test("la requête d'analyse est strictement séparée entre USER et GUEST", () => {
  const data = new Map();
  const storage = {
    setItem(key, value) { data.set(key, value); },
    getItem(key) { return data.get(key) ?? null; },
  };
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage };
  const analysisRequest = {
    version: 2,
    launchSite: { name: "Bondues", latitude: 50.631, longitude: 3.058 },
    launchDateTimeIso: "2026-09-02T06:00:00.000Z",
    durationSeconds: 3600,
    weatherModel: "arome_seamless",
    altitudesAmslM: ["ground", 300],
  };
  setRuntimeGuestModeActive(false);
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-a" } });
  assert.equal(saveTrajectoryAnalysisRequest(analysisRequest), true);
  assert.deepEqual(getTrajectoryAnalysisRequest()?.request, analysisRequest);

  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-b" } });
  assert.equal(getTrajectoryAnalysisRequest(), null);
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.equal(getTrajectoryAnalysisRequest(), null);

  setRuntimeGuestModeActive(false);
  delete globalThis.localStorage;
  delete globalThis.window;
});
