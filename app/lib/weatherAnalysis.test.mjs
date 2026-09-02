import test from "node:test";
import assert from "node:assert/strict";
import {
  ALTITUDE_ANALYSIS_COLORS,
  MODEL_LINE_STYLES,
} from "./trajectory/analysisStyles.ts";
import {
  loadExportedPlannedTrajectories,
  loadFlightWeatherSnapshot,
  loadWeatherAnalysis,
  isUsableWeatherAnalysisCache,
  saveExportedPlannedTrajectories,
  saveFlightWeatherSnapshot,
  saveWeatherAnalysis,
  DEFAULT_ANALYSIS_LAYERS,
} from "./trajectory/weatherAnalysisStorage.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";

test("la couleur d’altitude reste fixe et indépendante du modèle", () => {
  assert.deepEqual(ALTITUDE_ANALYSIS_COLORS, {
    ground: "#3b82f6",
    100: "#22d3ee",
    300: "#22c55e",
    600: "#facc15",
    1000: "#f97316",
    1500: "#ef4444",
    2000: "#8b5cf6",
    2500: "#ec4899",
    3000: "#ffffff",
  });
});

test("chaque modèle possède un motif stable et distinct", () => {
  const signatures = Object.values(MODEL_LINE_STYLES).map((style) =>
    style.dasharray.join(","),
  );
  assert.equal(new Set(signatures).size, signatures.length);
  assert.deepEqual(MODEL_LINE_STYLES.arome.dasharray, [1, 0]);
  assert.deepEqual(MODEL_LINE_STYLES.ecmwf.dasharray, [3, 2]);
});

test("un cache offline exige la même signature et une trajectoire réellement traçable", () => {
  const key = "matching-analysis";
  const valid = {
    version: 1,
    updatedAtIso: "2026-09-02T06:00:00.000Z",
    selectedModelIds: ["arome"],
    selectedAltitudes: [300],
    layers: DEFAULT_ANALYSIS_LAYERS,
    traces: [{ projection: { points: [{ latitude: 50.6, longitude: 3 }, { latitude: 50.7, longitude: 3.1 }] } }],
    failures: [],
    analysisKey: key,
  };
  assert.equal(isUsableWeatherAnalysisCache(valid, key), true);
  assert.equal(isUsableWeatherAnalysisCache(valid, "other-analysis"), false);
  assert.equal(isUsableWeatherAnalysisCache({ ...valid, traces: [] }, key), false);
  assert.equal(isUsableWeatherAnalysisCache({ ...valid, traces: [{ projection: { points: [{ latitude: 50.6, longitude: 3 }] } }] }, key), false);
});

test("l’analyse et les exports Vol survivent au rechargement local", () => {
  const data = new Map();
  const storage = {
    setItem(key, value) {
      data.set(key, value);
    },
    getItem(key) {
      return data.get(key) ?? null;
    },
  };
  globalThis.localStorage = storage;
  globalThis.window = { localStorage: storage };
  setRuntimeAuthSnapshot({ state: "SIGNED_IN", user: { id: "user-a" } });
  const analysis = {
    version: 1,
    updatedAtIso: "2026-07-29T18:30:00.000Z",
    selectedModelIds: ["arome", "ecmwf"],
    selectedAltitudes: ["ground", 300, 600, 1000],
    layers: DEFAULT_ANALYSIS_LAYERS,
    traces: [],
    failures: [],
  };
  assert.equal(saveWeatherAnalysis(analysis), true);
  assert.deepEqual(loadWeatherAnalysis(), analysis);

  const exported = [
    {
      version: 1,
      traceId: "arome:300",
      modelId: "arome",
      modelLabel: "AROME",
      providerModelId: "arome_seamless",
      altitudeKey: "300",
      altitudeAmslM: 300,
      altitudeLabel: "300 m",
      color: "#22c55e",
      dasharray: [1, 0],
      geometry: [
        [3.058, 50.631],
        [3.1, 50.65],
      ],
      calculatedAtIso: "2026-07-29T18:00:00.000Z",
      forecastAtIso: "2026-07-29T18:30:00.000Z",
    },
  ];
  assert.equal(saveExportedPlannedTrajectories(exported), true);
  assert.deepEqual(loadExportedPlannedTrajectories(), exported);

  const snapshot = {
    version: 1,
    weatherModel: "arome_seamless",
    modelLabel: "AROME",
    referenceLocation: { name: "LFQO", latitude: 50.68, longitude: 3.08, terrainAltitudeAmslM: 20 },
    forecastAtIso: "2026-07-29T18:30:00.000Z",
    sourceUpdatedAt: "2026-07-29T18:00:00.000Z",
    windProfile: [{ levelM: 200, altitudeAmslM: 200, directionFromDeg: 120, speedMps: 3 }],
  };
  assert.equal(saveFlightWeatherSnapshot(snapshot), true);
  assert.deepEqual(loadFlightWeatherSnapshot(), snapshot);
  assert.equal(saveFlightWeatherSnapshot({ ...snapshot, weatherModel: "icon_seamless", modelLabel: "ICON" }), true);
  assert.equal(loadFlightWeatherSnapshot()?.weatherModel, "icon_seamless");
  assert.equal(saveFlightWeatherSnapshot({ ...snapshot, weatherModel: "gfs_seamless", modelLabel: "GFS" }), true);
  assert.equal(loadFlightWeatherSnapshot()?.weatherModel, "gfs_seamless");

  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  assert.equal(loadWeatherAnalysis(), null);
  assert.equal(loadFlightWeatherSnapshot(), null);
  setRuntimeGuestModeActive(false);
  delete globalThis.localStorage;
  delete globalThis.window;
});
