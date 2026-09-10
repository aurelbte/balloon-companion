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

test("analyse valide sans aucun export ni snapshot exporté : profil disponible, carte vide", () => {
  const input = fixture();
  const result = validateFlightWeather({ ...input, snapshot: null, trajectories: [] });
  assert.deepEqual(result.snapshot, input.snapshot);
  assert.deepEqual(result.trajectories, []);
  assert.equal(snapshotWindProfile(selectFlightWeatherSnapshot(result.snapshot, null)).get(300).directionDeg, 120);
});

test("désactiver les couches ou retirer les exports ne modifie pas le profil prévu", () => {
  const input = fixture();
  const withExports = validateFlightWeather(input);
  input.analysis.layers = { ...input.analysis.layers, trajectories: false };
  const withoutExports = validateFlightWeather({ ...input, snapshot: null, trajectories: [] });
  assert.deepEqual(withoutExports.snapshot, withExports.snapshot);
  assert.deepEqual(withoutExports.trajectories, []);
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
  ["modèle", { model: WEATHER_MODEL_REGISTRY.find(({ id }) => id === "icon") }],
  ["échéance", { forecastAtIso: "2026-09-09T06:00:00.000Z" }],
  ["calcul futur", { calculatedAtIso: "2026-09-11T05:00:00.000Z" }],
  ["altitude terrain", { terrainAltitudeAmslM: Number.NaN }],
  ["profil invalide", { predictedWindProfile: [{ levelM: 300, altitudeAmslM: 300, directionFromDeg: 20, speedMps: -1 }] }],
]) test(`source météo incohérente (${name}) non attachable, même si un ancien snapshot existe`, () => {
  const input = fixture(); input.analysis.traces[0] = { ...input.analysis.traces[0], ...patch };
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


test("offline exact sans export : l'analyse suffit, un ancien snapshot ou un export corrompu ne la masque pas", (t) => {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  globalThis.window = { localStorage: storage, sessionStorage: storage };
  globalThis.localStorage = storage;
  t.after(() => { delete globalThis.window; delete globalThis.localStorage; setRuntimeGuestModeActive(false); });
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null }); setRuntimeGuestModeActive(true);
  t.mock.method(globalThis, "fetch", () => { throw new Error("Offline: aucun accès réseau"); });
  const input = fixture();
  assert.ok(saveTrajectoryAnalysisRequest(input.request));
  assert.ok(savePreparationDraft(input.preparation));
  assert.ok(saveWeatherAnalysis(input.analysis));
  const fresh = loadValidatedFlightWeather(input.now);
  assert.deepEqual(fresh.snapshot, input.snapshot);
  assert.deepEqual(fresh.trajectories, []);
  saveFlightWeatherSnapshot({ ...input.snapshot, forecastAtIso: "2026-09-09T06:00:00.000Z" });
  assert.deepEqual(loadValidatedFlightWeather(input.now).snapshot, input.snapshot);
  saveExportedPlannedTrajectories(input.trajectories);
  const exportKey = [...data.keys()].find((key) => key.includes("planned_trajectories"));
  data.set(exportKey, "{");
  const corrupted = loadValidatedFlightWeather(input.now);
  assert.deepEqual(corrupted.snapshot, input.snapshot);
  assert.deepEqual(corrupted.trajectories, []);
  savePreparationDraft({ ...input.preparation, departureTime: "2026-09-11T06:00:00.000Z" });
  assert.deepEqual(loadValidatedFlightWeather(input.now), { snapshot: null, trajectories: [], validUntil: null });
});

test("le modèle du profil dépend de la sélection d'analyse, jamais du sous-ensemble exporté", () => {
  const input = fixture();
  const icon = WEATHER_MODEL_REGISTRY.find(({ id }) => id === "icon");
  input.analysis.selectedModelIds = ["arome", "icon"];
  input.analysis.analysisKey = createTrajectoryAnalysisKey(input.request, input.analysis.selectedModelIds, [300]);
  input.analysis.traces.push({ ...structuredClone(input.analysis.traces[0]), model: icon, traceId: "icon:300" });
  // Only AROME is exported; the last selected analysis model remains ICON.
  const exported = validateFlightWeather(input);
  const hidden = validateFlightWeather({ ...input, trajectories: [] });
  assert.equal(exported.snapshot.weatherModel, icon.providerModelId);
  assert.deepEqual(exported.trajectories, input.trajectories);
  assert.deepEqual(hidden.snapshot, exported.snapshot);
  assert.deepEqual(hidden.trajectories, []);
  const malformed = validateFlightWeather({ ...input, trajectories: [null] });
  assert.deepEqual(malformed.snapshot, exported.snapshot);
  assert.deepEqual(malformed.trajectories, []);
});

// These tests keep the persistent stores intact while dropping only the current session.
import { startNewPreparationSession } from "./preparationSession.ts";
import { loadPreparationDraft } from "./preparationDraftStorage.ts";
import { getTrajectoryAnalysisRequest } from "./trajectory/projectionStorage.ts";
import { loadWeatherAnalysis, loadExportedPlannedTrajectories, resumeExactOfflineAnalysis } from "./trajectory/weatherAnalysisStorage.ts";
import { readFileSync } from "node:fs";
import ts from "typescript";

function storedPreparationSession(t) {
  const data = new Map();
  const storage = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  globalThis.window = { localStorage: storage, sessionStorage: storage };
  globalThis.localStorage = storage;
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null }); setRuntimeGuestModeActive(true);
  startNewPreparationSession();
  t.after(() => { startNewPreparationSession(); delete globalThis.window; delete globalThis.localStorage; setRuntimeGuestModeActive(false); });
  const input = fixture();
  assert.ok(savePreparationDraft(input.preparation));
  assert.ok(saveTrajectoryAnalysisRequest(input.request));
  assert.ok(saveWeatherAnalysis(input.analysis));
  assert.ok(saveExportedPlannedTrajectories(input.trajectories));
  return { data, input };
}

test("nouvelle session : aucun ancien modèle, échéance, altitude, profil ou export courant ; aucun stockage effacé", (t) => {
  const { data, input } = storedPreparationSession(t);
  // Include unrelated journal/GPS records: reset must perform no persistent writes/deletes.
  data.set("journal-flight", JSON.stringify({ id: "recorded", status: "COMPLETED", gps: [[50.6, 3.1]] }));
  const before = [...data.entries()];
  assert.deepEqual(loadValidatedFlightWeather(input.now).snapshot, input.snapshot);
  startNewPreparationSession();
  assert.equal(loadPreparationDraft(), null);
  assert.equal(getTrajectoryAnalysisRequest(), null);
  assert.deepEqual(loadValidatedFlightWeather(input.now), { snapshot: null, trajectories: [], validUntil: null });
  assert.deepEqual(loadWeatherAnalysis(), input.analysis);
  assert.deepEqual(loadExportedPlannedTrajectories(), input.trajectories);
  assert.deepEqual([...data.entries()], before);
});

test("nouvelle session : le formulaire démarre sans modèle ni altitude", (t) => {
  storedPreparationSession(t);
  startNewPreparationSession();
  assert.equal(loadPreparationDraft(), null);
  const source = readFileSync(new URL("../prepare/page.tsx", import.meta.url), "utf8");
  const formFunction = source.slice(source.indexOf("function initialForm()"), source.indexOf("function parseNumber("));
  const js = ts.transpileModule(formFunction, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const initialForm = new Function(`${js}; return initialForm;`)();
  assert.deepEqual(initialForm(), {
    launchSite: null, launchSearch: "", date: "", time: "", durationMinutes: "", targetAltitudeAmslM: "",
    selectedAltitudes: [], weatherModel: "",
    ascentRateMps: 0, descentRateMps: 0, balloonName: "", occupantsWeightKg: "",
  });
});

test("nouvelle préparation exacte : le cache ne devient courant qu'après le secours offline, sans anciens exports", (t) => {
  const { input } = storedPreparationSession(t);
  startNewPreparationSession();
  t.mock.method(globalThis, "fetch", () => { throw new Error("offline"); });
  savePreparationDraft(input.preparation);
  saveTrajectoryAnalysisRequest(input.request);
  assert.equal(loadValidatedFlightWeather(input.now).snapshot, null);
  assert.deepEqual(resumeExactOfflineAnalysis(input.request, ["arome"], [300]), input.analysis);
  assert.deepEqual(loadValidatedFlightWeather(input.now).snapshot, input.snapshot);
  assert.deepEqual(loadValidatedFlightWeather(input.now).trajectories, []);
});

for (const [name, patch, models, altitudes] of [
  ["terrain", { launchSite: { name: "Autre", latitude: 49, longitude: 2 } }, ["arome"], [300]],
  ["date", { launchDateTimeIso: "2026-09-13T06:00:00.000Z" }, ["arome"], [300]],
  ["modèle", { weatherModel: "icon_seamless" }, ["icon"], [300]],
  ["altitudes", { altitudesAmslM: [600] }, ["arome"], [600]],
]) test(`nouvelle préparation (${name}) : l'ancien cache ne remplace jamais les choix soumis`, (t) => {
  const { input } = storedPreparationSession(t);
  const request = { ...input.request, ...patch };
  saveTrajectoryAnalysisRequest(request);
  assert.equal(resumeExactOfflineAnalysis(request, models, altitudes), null);
  assert.equal(loadValidatedFlightWeather(input.now).snapshot, null);
  assert.deepEqual(loadValidatedFlightWeather(input.now).trajectories, []);
  assert.deepEqual(loadWeatherAnalysis(), input.analysis);
});

test("nouveau document PWA : aucune valeur courante héritée des stockages", async (t) => {
  const { data, input } = storedPreparationSession(t);
  const before = [...data.entries()];
  // A freshly evaluated module models a document restart, including retained sessionStorage.
  const freshDocument = await import(`./preparationSession.ts?document=${Date.now()}`);
  assert.equal(freshDocument.currentPreparationValue("draft", input.preparation), null);
  assert.equal(freshDocument.currentPreparationValue("analysis", loadWeatherAnalysis()), null);
  assert.equal(freshDocument.currentPreparationValue("exports", loadExportedPlannedTrajectories()), null);
  assert.deepEqual([...data.entries()], before);
});

test("reprise offline dans la même préparation : choix explicites de la carte conservés", (t) => {
  const { input } = storedPreparationSession(t);
  const icon = WEATHER_MODEL_REGISTRY.find(({ id }) => id === "icon");
  const analysis = {
    ...input.analysis, selectedModelIds: ["icon"], selectedAltitudes: [600],
    analysisKey: createTrajectoryAnalysisKey(input.request, ["icon"], [600]),
    traces: [{ ...input.analysis.traces[0], model: icon, traceId: "icon:600", altitudeAmslM: 600, altitudeKey: "600" }],
  };
  saveWeatherAnalysis(analysis);
  assert.deepEqual(resumeExactOfflineAnalysis(input.request, ["arome"], [300]), analysis);
  startNewPreparationSession();
  savePreparationDraft(input.preparation);
  saveTrajectoryAnalysisRequest(input.request);
  assert.equal(resumeExactOfflineAnalysis(input.request, ["arome"], [300]), null);
});

test("préparation sans présélection : les choix explicites sur la carte donnent une analyse valide", () => {
  const input = fixture();
  input.preparation.weatherModel = "";
  input.preparation.selectedAltitudes = [];
  input.request.weatherModel = "";
  input.request.altitudesAmslM = [];
  assert.deepEqual(validateFlightWeather(input).snapshot, input.snapshot);
  assert.deepEqual(validateFlightWeather({ ...input, analysis: null }).trajectories, []);
});

test("ouvrir l'analyse reste possible avec les sélections météo vides", async () => {
  const integration = await import("./trajectory/integration.ts");
  const source = readFileSync(new URL("../prepare/page.tsx", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("  const buildRequest ="), source.indexOf("  const submitProjection ="));
  const js = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const form = { launchSite: { name: "Terrain", latitude: 50, longitude: 3 }, date: "2026-09-13", time: "06:00", durationMinutes: "60", targetAltitudeAmslM: "", ascentRateMps: 0, descentRateMps: 0, weatherModel: "", selectedAltitudes: [] };
  const request = new Function("form", "setError", "combineLocalDateAndTime", "parseNumber", "optionalVerticalRate", "durationMinutesToSeconds", `${js}; return buildRequest();`)(form, message => assert.fail(message), integration.combineLocalDateAndTime, value => value.trim() ? Number(value) : null, integration.optionalVerticalRate, integration.durationMinutesToSeconds);
  assert.equal(request.weatherModel, "");
  assert.deepEqual(request.altitudesAmslM, []);
});
