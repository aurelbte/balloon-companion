import test from "node:test";
import assert from "node:assert/strict";
import { loadMapAnalysisRequest } from "./mapAnalysisRequest.ts";
import { saveTrajectoryAnalysisRequest, saveTrajectoryProjection } from "./projectionStorage.ts";
import { savePreparationDraft } from "../preparationDraftStorage.ts";
import { startNewPreparationSession } from "../preparationSession.ts";
import { setRuntimeAuthSnapshot, setRuntimeGuestModeActive } from "../auth/dataScopeRuntime.ts";
import { saveWeatherAnalysis, loadWeatherAnalysis, isUsableWeatherAnalysisCache } from "./weatherAnalysisStorage.ts";
import { createTrajectoryAnalysisKey } from "./analysisState.ts";

function setup(t) {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  globalThis.window = { localStorage: storage, sessionStorage: storage };
  globalThis.localStorage = storage;
  globalThis.sessionStorage = storage;
  setRuntimeAuthSnapshot({ state: "SIGNED_OUT", user: null });
  setRuntimeGuestModeActive(true);
  startNewPreparationSession();
  t.after(() => { startNewPreparationSession(); setRuntimeGuestModeActive(false); delete globalThis.window; delete globalThis.localStorage; delete globalThis.sessionStorage; });
  const preparation = { storageVersion: 3, launchSite: { name: "Terrain", latitude: 50, longitude: 3 }, departureTime: "2026-09-10T06:00:00.000Z", durationMinutes: 60, weatherModel: "arome_seamless", selectedAltitudes: [300], targetAltitudeAmslM: 300, createdAt: 1, updatedAt: 1 };
  const request = { version: 2, launchSite: preparation.launchSite, launchDateTimeIso: preparation.departureTime, durationSeconds: 3600, weatherModel: preparation.weatherModel, altitudesAmslM: [300] };
  savePreparationDraft(preparation);
  saveTrajectoryAnalysisRequest(request);
  const cache = { version: 1, updatedAtIso: "2026-09-10T05:00:00.000Z", analysisKey: createTrajectoryAnalysisKey(request, ["arome"], [300]), selectedModelIds: ["arome"], selectedAltitudes: [300], layers: {}, failures: [], traces: [{ projection: { points: [{ latitude: 50, longitude: 3 }, { latitude: 50.1, longitude: 3.1 }] } }] };
  saveWeatherAnalysis(cache);
  return { preparation, request, cache, data };
}

for (const [name, patch] of [
  ["jour", { departureTime: "2026-09-13T06:00:00.000Z" }],
  ["terrain", { launchSite: { name: "Autre terrain", latitude: 48, longitude: 2 } }],
]) test(`brouillon avec un autre ${name} : aucune restauration de l'ancienne requête dans Map`, t => {
  const { preparation, cache, data } = setup(t);
  savePreparationDraft({ ...preparation, ...patch });
  const before = [...data];
  assert.equal(loadMapAnalysisRequest(), null);
  assert.deepEqual(loadWeatherAnalysis(), cache);
  assert.deepEqual([...data], before);
});

test("nouvelle session : ancienne requête et projection legacy non restaurées", t => {
  const { request, data } = setup(t);
  saveTrajectoryProjection({ version: 2, createdAtIso: "2026-09-10T05:00:00.000Z", request, response: { ok: true, version: 2, layerProjections: [{ projection: { points: [{ latitude: 50, longitude: 3 }, { latitude: 50.1, longitude: 3.1 }] } }] } });
  const before = [...data];
  startNewPreparationSession();
  assert.equal(loadMapAnalysisRequest(), null);
  assert.deepEqual([...data], before);
});

test("préparation soumise compatible : requête disponible et cache offline exact intact", t => {
  const { request, cache } = setup(t);
  assert.deepEqual(loadMapAnalysisRequest()?.request, request);
  assert.ok(isUsableWeatherAnalysisCache(loadWeatherAnalysis(), cache.analysisKey));
});

test("une projection legacy seule ne relance plus une ancienne analyse dans Map", t => {
  const { preparation, request } = setup(t);
  startNewPreparationSession();
  savePreparationDraft(preparation);
  assert.ok(saveTrajectoryProjection({ version: 2, createdAtIso: "2026-09-10T05:00:00.000Z", request, response: { ok: true, version: 2, layerProjections: [{ projection: { points: [{ latitude: 50, longitude: 3 }, { latitude: 50.1, longitude: 3.1 }] } }] } }));
  assert.equal(loadMapAnalysisRequest(), null);
});
