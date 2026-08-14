import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { selectTrajectoryAirspaces } from "./trajectoryAirspaces.ts";
import { LANDING_WEATHER_RADIUS_M, landingWeatherSamplePoints, summarizeLandingWeather, trajectoryDistanceKm, trajectoryMaximumWindKmh } from "./trajectoryArrivalSummary.ts";

const point = (longitude, latitude, elapsedSeconds, altitudeAmslM, speedMps = 4) => ({ longitude, latitude, elapsedSeconds, altitudeAmslM, timestamp: new Date(Date.parse("2026-08-14T10:00:00Z") + elapsedSeconds * 1000).toISOString(), verticalPhase: "level", windUsed: { speedMps, directionFromDeg: 90, movementDirectionToDeg: 270, queryAltitudeAmslM: altitudeAmslM, sourceModel: "arome_seamless", sourceSlices: [] } });
const trace = { traceId: "arome:300", altitudeKey: "300", altitudeAmslM: 300, label: "300 m", color: "#fff", model: { id: "arome", label: "AROME", providerModelId: "arome_seamless", supported: true }, calculatedAtIso: "2026-08-14T09:00:00Z", forecastAtIso: "2026-08-14T10:00:00Z", terrainAltitudeAmslM: 20, projection: { mode: "constant-altitude", spatialStrategy: "launch-column", startedAt: "2026-08-14T10:00:00Z", endedAt: "2026-08-14T11:00:00Z", durationSeconds: 3600, targetAltitudeAmslM: 300, warnings: [], metadata: { targetAltitudeAmslM: 300 }, points: [point(3, 50, 0, 300, 3), point(3.1, 50, 3600, 300, 6)] } };
const airspace = (id, floor, ceiling, frequencies = []) => ({ type: "Feature", properties: { id, airspaceId: id, airspaceCompositeKey: id, name: id, type: 4, typeLabel: "CTR", icaoClass: 3, icaoClassLabel: "D", lowerLimit: floor, upperLimit: ceiling, lowerLimitMin: null, upperLimitMax: null, frequencies, remarks: null, country: "FR", activity: null, onDemand: null, onRequest: null, byNotam: null, activeFrom: null, activeUntil: null }, geometry: { type: "Polygon", coordinates: [[[3.02,49.99],[3.08,49.99],[3.08,50.01],[3.02,50.01],[3.02,49.99]]] } });

test("résume distance, ETA implicite et vent réellement utilisé", () => {
  assert.ok(trajectoryDistanceKm(trace) > 7);
  assert.equal(trajectoryMaximumWindKmh(trace), 21.6);
  assert.equal(trace.projection.points.at(-1).timestamp, "2026-08-14T11:00:00.000Z");
});

test("échantillonne exactement le centre et huit points sur un rayon de 3 km", () => {
  const samples = landingWeatherSamplePoints(50, 3);
  assert.equal(LANDING_WEATHER_RADIUS_M, 3000);
  assert.equal(samples.length, 9);
  assert.deepEqual(samples[0], { latitude: 50, longitude: 3 });
});

test("agrège la météo d'arrivée au créneau ETA sans inventer les champs absents", () => {
  const forecast = (windSpeedKmh, windDirectionDeg, windGustKmh) => ({ model: "arome_seamless", latitude: 50, longitude: 3, sourceUpdatedAt: "2026-08-14T09:00:00Z", points: [{ timestamp: "2026-08-14T11:00:00Z", weatherCode: "CLEAR", model: "arome_seamless", sourceUpdatedAt: "2026-08-14T09:00:00Z", windSpeedKmh, windDirectionDeg, ...(windGustKmh === undefined ? {} : { windGustKmh }) }] });
  const summary = summarizeLandingWeather([forecast(8, 60, undefined), forecast(12, 110, 18)], "2026-08-14T11:00:00Z");
  assert.equal(summary.averageWindKmh, 10);
  assert.equal(summary.maximumWindKmh, 12);
  assert.equal(summary.maximumGustKmh, 18);
  assert.equal(summary.directionLabel, "ENE → ESE");
});

test("filtre verticalement, déduplique et conserve les fréquences openAIP", () => {
  const inside = airspace("inside", { value: 0, unit: 1, referenceDatum: 0 }, { value: 2000, unit: 1, referenceDatum: 1 }, [{ value: "120.000 MHz", unit: 2, name: "INFO" }]);
  const above = airspace("above", { value: 2000, unit: 1, referenceDatum: 1 }, { value: 3000, unit: 1, referenceDatum: 1 });
  const selected = selectTrajectoryAirspaces(trace, { type: "FeatureCollection", features: [inside, inside, above] });
  assert.deepEqual(selected.map(({ airspaceId }) => airspaceId), ["inside"]);
  assert.equal(selected[0].frequencies[0].value, "120.000 MHz");
});

test("seul le layer du point final ouvre la fiche et les deux vues gardent la même trace", () => {
  const map = readFileSync(new URL("../components/PreparationMap.tsx", import.meta.url), "utf8");
  const popup = readFileSync(new URL("../components/TrajectoryArrivalDetails.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../api/weather/landing-zone/route.ts", import.meta.url), "utf8");
  assert.match(map, /layers: map\.getLayer\("analysis-arrivals"\)/);
  assert.match(map, /setSelectedTraceId\(traceId\)/);
  assert.match(popup, /Météo vol/);
  assert.match(popup, /Espaces aériens/);
  assert.match(map, /trace=\{selectedTrace\}/);
  assert.match(route, /fetchHourlyForecastBatch/);
  assert.match(route, /CACHE_TTL_MS/);
  assert.doesNotMatch(popup, /Fréquence à contacter/);
});
