import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aggregateObservedWind, closestFlightWindLevel, formatObservedWind, predictedWindProfile } from "./flightWindProfile.ts";
import { extractPredictedWind } from "./trajectory/weatherAnalysisStorage.ts";

const point = (altitude, speed, heading, timestamp) => ({ latitude: 50, longitude: 3, altitude, speed, heading, accuracy: 5, verticalAccuracy: 8, timestamp });

test("affecte une observation à la tranche d'altitude la plus proche", () => {
  assert.equal(closestFlightWindLevel(160), 200);
  assert.equal(closestFlightWindLevel(740), 800);
});

test("agrège plusieurs observations par moyenne de vitesse et moyenne circulaire", () => {
  const profile = aggregateObservedWind([point(198, 2, 359, 1), point(201, 4, 1, 2), point(205, 3, 0, 3)]);
  const observed = profile.get(200);
  assert.ok(observed);
  assert.ok(observed.directionDeg < 2 || observed.directionDeg > 358);
  assert.ok(Math.abs(observed.speedKt - 5.831532) < 0.001);
  assert.equal(observed.sampleCount, 3);
});

test("conserve les tranches traversées et n'affiche rien sans assez de données", () => {
  const profile = aggregateObservedWind([
    point(300, 2, 80, 1), point(305, 2, 85, 2), point(295, 2, 90, 3),
    point(800, 3, 100, 4), point(805, 3, 105, 5), point(795, 3, 110, 6),
  ]);
  assert.equal(profile.has(300), true);
  assert.equal(profile.has(800), true);
  assert.equal(formatObservedWind(undefined), "—");
});

test("Observé et Prévu restent distincts et les boutons de zoom sont retirés", () => {
  const panel = readFileSync(new URL("../components/flight/WindProfilePanel.tsx", import.meta.url), "utf8");
  const map = readFileSync(new URL("../components/flight/FlightMap.tsx", import.meta.url), "utf8");
  assert.match(panel, />Observé</);
  assert.match(panel, />Prévu · \{predictedModelLabel/);
  assert.match(map, /showZoom: false/);
});

test("branche uniquement les vents prévus du modèle figé et laisse les niveaux absents vides", () => {
  const trajectories = [{ version: 1, traceId: "a", modelId: "arome", modelLabel: "AROME", providerModelId: "arome_seamless", altitudeKey: "300", altitudeAmslM: 300, altitudeLabel: "300 m", color: "#fff", dasharray: [], geometry: [], calculatedAtIso: "2026-08-13T10:00:00Z", forecastAtIso: "2026-08-13T12:00:00Z", predictedWind: { directionFromDeg: 110, speedMps: 2.57222 } }, { version: 1, traceId: "g", modelId: "gfs", modelLabel: "GFS", providerModelId: "gfs_seamless", altitudeKey: "300", altitudeAmslM: 300, altitudeLabel: "300 m", color: "#fff", dasharray: [], geometry: [], calculatedAtIso: "2026-08-13T10:00:00Z", forecastAtIso: "2026-08-13T12:00:00Z", predictedWind: { directionFromDeg: 220, speedMps: 4 } }];
  const profile = predictedWindProfile(trajectories, "arome_seamless");
  assert.equal(formatObservedWind(profile.get(300)), "110° / 5 kt");
  assert.equal(profile.has(400), false);
  assert.equal(predictedWindProfile(trajectories, null).size, 0);
});

test("exporte le premier windUsed disponible quand le point initial de projection n'en contient pas", () => {
  const windUsed = {
    queryAltitudeAmslM: 300,
    speedMps: 2.57222,
    directionFromDeg: 110,
    movementDirectionToDeg: 290,
    sourceModel: "arome_seamless",
    sourceSlices: [],
  };
  const predictedWind = extractPredictedWind([
    { windUsed: undefined },
    { windUsed },
  ]);
  const trajectories = [{
    version: 1, traceId: "arome-300", modelId: "arome", modelLabel: "AROME",
    providerModelId: "arome_seamless", altitudeKey: "300", altitudeAmslM: 300,
    altitudeLabel: "300 m", color: "#fff", dasharray: [], geometry: [],
    calculatedAtIso: "2026-08-13T10:00:00Z", forecastAtIso: "2026-08-13T12:00:00Z",
    predictedWind,
  }];

  assert.deepEqual(predictedWind, { directionFromDeg: 110, speedMps: 2.57222 });
  assert.equal(formatObservedWind(predictedWindProfile(trajectories, "arome_seamless").get(300)), "110° / 5 kt");
});

test("le mode Vol privilégie toujours le modèle persisté du vol restauré", () => {
  const page = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  assert.match(page, /activeFlight\?\.weatherModel \?\? recoverableFlight\?\.weatherModel/);
  assert.match(page, /weatherModel: preparation\.weatherModel/);
});
