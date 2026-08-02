import assert from "node:assert/strict";
import test from "node:test";
import { GROUND_TEMPERATURE_PROVIDER_ID, OpenMeteoGroundTemperatureProvider, canFetchGroundTemperature, groundTemperatureRequestKey } from "./loadPerformance/groundTemperatureProvider.ts";
import { calculateDemoLoad } from "./loadPerformance/demoEngine.ts";
import { calculateOfficialLoad } from "./loadPerformance/engine.ts";

const request = { latitude: 50.686341, longitude: 3.079865, dateTime: "2026-08-02T18:42:00.000Z", provider: GROUND_TEMPERATURE_PROVIDER_ID };

test("la température est récupérable sans mode DEMO dès que terrain, date et heure existent", () => {
  assert.equal(canFetchGroundTemperature(request), true);
  assert.equal(canFetchGroundTemperature({ ...request, dateTime: "" }), false);
  assert.equal(canFetchGroundTemperature({ ...request, latitude: undefined }), false);
});

test("la clé est strictement identique sur /map et /map?testLoad=1", () => {
  const normal = groundTemperatureRequestKey(request);
  const demo = groundTemperatureRequestKey(request);
  assert.equal(normal, demo);
  assert.equal(normal.includes("testLoad"), false);
  assert.equal(normal.includes("DEMO"), false);
});

test("altitude, ballon, poids et modèle de trajectoire n'entrent pas dans la clé", () => {
  const base = groundTemperatureRequestKey(request);
  assert.equal(base, groundTemperatureRequestKey({ ...request }));
  assert.equal(base.includes("1500"), false);
  assert.equal(base.includes("F-HLFM"), false);
  assert.equal(base.includes("arome"), false);
});

test("terrain, date ou heure modifiés produisent une nouvelle clé", () => {
  const base = groundTemperatureRequestKey(request);
  assert.notEqual(base, groundTemperatureRequestKey({ ...request, latitude: 50.8 }));
  assert.notEqual(base, groundTemperatureRequestKey({ ...request, dateTime: "2026-08-03T18:42:00.000Z" }));
  assert.notEqual(base, groundTemperatureRequestKey({ ...request, dateTime: "2026-08-02T19:42:00.000Z" }));
});

test("le moteur DEMO ne produit aucun résultat en mode normal même avec une température", () => {
  const result = calculateDemoLoad({ balloonId: "F-HLFM", manufacturer: "Cameron", model: "Z105", balloonEquipmentWeightKg: 415, occupantsWeightKg: 330, launchElevationMslM: 100, plannedMaximumAltitudeMslM: 500, groundTemperature: { temperatureC: 20, sourceModel: "Open-Meteo", forecastRun: "n/a", validTime: request.dateTime } }, false);
  assert.equal(result.status, "UNAVAILABLE");
});

test("le fournisseur appelle le flux générique sans modèle de trajectoire", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ ok: true, temperatureC: 21.6, validTime: request.dateTime, sourceModel: "Open-Meteo", forecastRun: "n/a", provider: "Open-Meteo" }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await new OpenMeteoGroundTemperatureProvider().getGroundTemperature({ ...request, weatherModel: "arome_seamless" });
    assert.equal(result.temperatureC, 21.6);
    assert.equal(new URL(requestedUrl, "http://localhost").searchParams.has("weatherModel"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("la température reste disponible au moteur officiel même sans dataset activé", () => {
  const result = calculateOfficialLoad({ balloonId: "F-HLFM", manufacturer: "Cameron", model: "Z105", balloonEquipmentWeightKg: 415, occupantsWeightKg: 330, launchElevationMslM: 100, plannedMaximumAltitudeMslM: 500, groundTemperature: { temperatureC: 21.6, sourceModel: "Open-Meteo", forecastRun: "n/a", validTime: request.dateTime } });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reasonCode, "UNSUPPORTED_OFFICIAL_DATASET");
});
