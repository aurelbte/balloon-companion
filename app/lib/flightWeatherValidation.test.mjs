import assert from "node:assert/strict";
import test from "node:test";
import { validateFlightWeather, loadValidatedFlightWeather, selectFlightWeatherSnapshot } from "./flightWeatherValidation.ts";
import { snapshotWindProfile } from "./flightWindProfile.ts";
import { createTrajectoryAnalysisKey } from "./trajectory/analysisState.ts";
import { WEATHER_MODEL_REGISTRY } from "./weather/models.ts";
import { saveWeatherAnalysis, saveFlightWeatherSnapshot, saveExportedPlannedTrajectories, DEFAULT_ANALYSIS_LAYERS } from "./trajectory/weatherAnalysisStorage.ts";
import { saveTrajectoryAnalysisRequest } from "./trajectory/projectionStorage.ts";
import { savePreparationDraft } from "./preparationDraftStorage.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "./auth/dataScopeRuntime.ts";

function fixture() {
  const model = WEATHER_MODEL_REGISTRY.find(({ id }) => id === "arome");
  const forecastAtIso = "2026-09-10T06:00:00.000Z";
  const calculatedAtIso = "2026-09-10T05:00:00.000Z";
  const site = { name: "Terrain", latitude: 50.6, longitude: 3.1 };
  const request = { version: 2, launchSite: site, launchDateTimeIso: forecastAtIso, durationSeconds: 3_600, weatherModel: model.providerModelId, altitudesAmslM: [300], climbRateMps: 1, descentRateMps: 1 };
  const preparation = { storageVersion: 3, launchSite: site, departureTime: forecastAtIso, durationMinutes: 60, weatherModel: model.providerModelId, selectedAltitudes: [300], targetAltitudeAmslM: 300, ascentRateMps: 1, descentRateMps: -1, createdAt: 1, updatedAt: 1 };
  const windProfile = [{ levelM: 300, altitudeAmslM: 300, directionFromDeg: 120, speedMps: 4 }];
  const trace = { traceId: "arome:300", model, calculatedAtIso, forecastAtIso, terrainAltitudeAmslM: 20, altitudeKey: "300", altitudeAmslM: 300, predictedWindProfile: windProfile, projection: { points: [{ latitude: 50.6, longitude: 3.1 }, { latitude: 50.7, longitude: 3.2 }] } };
  const analysis = { version: 1, analysisKey: createTrajectoryAnalysisKey(request, ["arome"], [300]), updatedAtIso: calculatedAtIso, selectedModelIds: ["arome"], selectedAltitudes: [300], traces: [trace], failures: [], layers: DEFAULT_ANALYSIS_LAYERS };
  const snapshot = { version: 1, weatherModel: model.providerModelId, modelLabel: model.label, referenceLocation: { ...site, terrainAltitudeAmslM: 20 }, forecastAtIso, sourceUpdatedAt: calculatedAtIso, windProfile };
  const exported = { version: 1, traceId: trace.traceId, modelId: model.id, providerModelId: model.providerModelId, altitudeKey: "300", altitudeAmslM: 300, calculatedAtIso, forecastAtIso, geometry: [[3.1, 50.6], [3.2, 50.7]] };
  return { preparation, request, analysis, snapshot, trajectories: [exported], now: Date.parse("2026-09-10T06:15:00Z") };
}

test("cache signé correspondant : profil et trajectoires utilisables sans réseau", () => {
  const input = fixture();
  const result = validateFlightWeather(input);
  assert.deepEqual(result.snapshot, input.snapshot);
  assert.deepEqual(result.trajectories, input.trajectories);
  assert.equal(result.validUntil, Date.parse("2026-09-10T07:00:00Z"));
});

for (const now of ["2026-09-10T05:01:00Z", "2026-09-10T05:59:00Z"]) test(`préparation fraîche avant décollage (${now}) : export accepté et profil prévu disponible dans Vol`, () => {
  const input = { ...fixture(), now: Date.parse(now) };
  const result = validateFlightWeather(input);
  assert.deepEqual(result.trajectories, input.trajectories);
  const snapshot = selectFlightWeatherSnapshot(result.snapshot, null);
  assert.equal(snapshot?.modelLabel, "AROME");
  assert.equal(snapshot?.forecastAtIso, input.request.launchDateTimeIso);
  const winds = snapshotWindProfile(snapshot);
  assert.equal(winds.size, 1);
  assert.equal(winds.get(300).directionDeg, 120);
  assert.equal(winds.get(300).speedKt, 4 * 1.943844);
  assert.equal(result.validUntil, Date.parse("2026-09-10T07:00:00Z"));
});

for (const [name, patch] of [
  ["coordonnées", { launchSite: { name: "Autre terrain", latitude: 49, longitude: 3 } }],
  ["modèle", { weatherModel: "icon_seamless" }],
  ["date", { departureTime: "2026-09-11T06:00:00.000Z" }],
  ["échéance", { departureTime: "2026-09-10T06:10:00.000Z" }],
  ["altitudes", { selectedAltitudes: [600] }],
  ["durée", { durationMinutes: 90 }],
  ["montée", { ascentRateMps: 2 }],
  ["descente", { descentRateMps: -2 }],
  ["préparation incomplète", { launchSite: null }],
]) test(`préparation modifiée (${name}) : ancienne analyse exclue`, () => {
  const input = fixture(); input.preparation = { ...input.preparation, ...patch };
  assert.deepEqual(validateFlightWeather(input), { snapshot: null, trajectories: [], validUntil: null });
});

for (const now of ["2026-09-10T07:00:00Z", "2026-09-11T06:15:00Z"]) test(`prévision après la fin prévue (${now}) exclue même si la signature correspond`, () => {
  assert.equal(validateFlightWeather({ ...fixture(), now: Date.parse(now) }).snapshot, null);
});

test("signature absente ou sélection d'altitudes incohérente : pas de secours ambigu", () => {
  const input = fixture();
  delete input.analysis.analysisKey;
  assert.equal(validateFlightWeather(input).snapshot, null);
  const other = fixture(); other.analysis.selectedAltitudes = [600];
  assert.equal(validateFlightWeather(other).snapshot, null);
});

for (const [name, patch] of [
  ["modèle", { weatherModel: "icon_seamless" }],
  ["échéance", { forecastAtIso: "2026-09-09T06:00:00.000Z" }],
  ["calcul", { sourceUpdatedAt: "2026-09-09T05:00:00.000Z" }],
  ["terrain", { referenceLocation: { latitude: 49, longitude: 3.1, terrainAltitudeAmslM: 20 } }],
  ["profil", { windProfile: [{ levelM: 300, altitudeAmslM: 300, directionFromDeg: 20, speedMps: 99 }] }],
]) test(`snapshot exporté incohérent (${name}) non attachable`, () => {
  const input = fixture(); input.snapshot = { ...input.snapshot, ...patch };
  assert.equal(validateFlightWeather(input).snapshot, null);
});

test("exports d'un ancien calcul ou géométrie incohérente exclus", () => {
  const input = fixture(); input.trajectories[0].calculatedAtIso = "2026-09-09T05:00:00Z";
  assert.deepEqual(validateFlightWeather(input).trajectories, []);
  const other = fixture(); other.trajectories[0].geometry[1] = [8, 48];
  assert.deepEqual(validateFlightWeather(other).trajectories, []);
});

test("la requête persistée permet la lecture après disparition du brouillon de session", () => {
  const input = fixture(); input.preparation = null;
  assert.deepEqual(validateFlightWeather(input).snapshot, input.snapshot);
  input.request = null;
  assert.equal(validateFlightWeather(input).snapshot, null);
});

test("un vol actif/récupéré ne reçoit jamais un autre snapshot ni un fallback absent au départ", () => {
  const { snapshot } = fixture();
  assert.equal(selectFlightWeatherSnapshot(snapshot, null), snapshot);
  assert.deepEqual(selectFlightWeatherSnapshot(snapshot, { weatherSnapshot: structuredClone(snapshot) }), snapshot);
  assert.equal(selectFlightWeatherSnapshot(snapshot, {}), null);
  assert.equal(selectFlightWeatherSnapshot(null, { weatherSnapshot: snapshot }), null);
  assert.equal(selectFlightWeatherSnapshot(snapshot, { weatherSnapshot: { ...snapshot, weatherModel: "icon_seamless" } }), null);
});

test("Prépa → Carte → Vol avant départ : export chargé offline, ancienne préparation incompatible refusée", (t) => {
  const storage = () => { const values = new Map(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
  const localStorage = storage(), sessionStorage = storage();
  globalThis.window = { localStorage, sessionStorage };
  globalThis.localStorage = localStorage;
  t.after(() => { delete globalThis.window; delete globalThis.localStorage; setRuntimeGuestModeActive(false); });
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null }); setRuntimeGuestModeActive(true);
  t.mock.method(globalThis, "fetch", () => { throw new Error("No network must be used"); });
  const input = { ...fixture(), now: Date.parse("2026-09-10T05:15:00Z") };
  assert.ok(saveTrajectoryAnalysisRequest(input.request)); assert.ok(savePreparationDraft(input.preparation));
  assert.ok(saveWeatherAnalysis(input.analysis)); assert.ok(saveFlightWeatherSnapshot(input.snapshot)); assert.ok(saveExportedPlannedTrajectories(input.trajectories));
  const loaded = loadValidatedFlightWeather(input.now);
  assert.deepEqual(loaded.snapshot, input.snapshot);
  assert.deepEqual(loaded.trajectories, input.trajectories);
  assert.equal(snapshotWindProfile(selectFlightWeatherSnapshot(loaded.snapshot, null)).size, 1);
  savePreparationDraft({ ...input.preparation, selectedAltitudes: [600] });
  assert.equal(loadValidatedFlightWeather(input.now).snapshot, null);
  localStorage.getItem = () => "{";
  assert.deepEqual(loadValidatedFlightWeather(input.now), { snapshot: null, trajectories: [], validUntil: null });
});

test("offline avant départ : conserve les modèles et altitudes explicitement sélectionnés sur la carte", () => {
  const input = { ...fixture(), now: Date.parse("2026-09-10T05:30:00Z") };
  const icon = WEATHER_MODEL_REGISTRY.find(({ id }) => id === "icon");
  input.analysis.selectedModelIds = ["icon"];
  input.analysis.selectedAltitudes = [600];
  input.analysis.analysisKey = createTrajectoryAnalysisKey(input.request, ["icon"], [600]);
  Object.assign(input.analysis.traces[0], { model: icon, traceId: "icon:600", altitudeKey: "600", altitudeAmslM: 600 });
  Object.assign(input.trajectories[0], { modelId: "icon", providerModelId: icon.providerModelId, traceId: "icon:600", altitudeKey: "600", altitudeAmslM: 600 });
  Object.assign(input.snapshot, { weatherModel: icon.providerModelId, modelLabel: icon.label });
  const result = validateFlightWeather(input);
  assert.deepEqual(result.snapshot, input.snapshot);
  assert.deepEqual(result.trajectories, input.trajectories);
  // A subsequent draft change is not the same as an explicit map selection.
  input.preparation.selectedAltitudes = [1000];
  assert.equal(validateFlightWeather(input).snapshot, null);
});
