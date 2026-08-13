import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { aggregateObservedWind, closestFlightWindLevel, formatObservedWind } from "./flightWindProfile.ts";

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
  assert.match(panel, />Prévu</);
  assert.match(map, /showZoom: false/);
});
