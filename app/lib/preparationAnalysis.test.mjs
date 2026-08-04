import test from "node:test";
import assert from "node:assert/strict";

import {
  addFavoriteLaunchSite,
  DEFAULT_FAVORITE_LAUNCH_SITES,
  removeFavoriteLaunchSite,
  sameLaunchSite,
} from "./favoriteLaunchSites.ts";
import { normalizeTimeInput, validDurationMinutes } from "./preparationInputs.ts";
import {
  createTrajectoryAnalysisKey,
  toggleLimitedSelection,
} from "./trajectory/analysisState.ts";
import {
  analysisFitPadding,
  calculateTrajectoryBounds,
} from "./trajectory/trajectoryBounds.ts";

test("les favoris évitent les doublons et peuvent être retirés", () => {
  const lfqo = DEFAULT_FAVORITE_LAUNCH_SITES[0];
  assert.equal(addFavoriteLaunchSite(DEFAULT_FAVORITE_LAUNCH_SITES, lfqo).length, 2);
  const custom = { id: "custom", name: "Champ", latitude: 50.7, longitude: 3.1 };
  const added = addFavoriteLaunchSite(DEFAULT_FAVORITE_LAUNCH_SITES, custom, "2026-08-04T10:00:00.000Z");
  assert.equal(added.length, 3);
  assert.equal(sameLaunchSite(added[2], custom), true);
  assert.deepEqual(removeFavoriteLaunchSite(added, custom), DEFAULT_FAVORITE_LAUNCH_SITES);
});

test("la saisie horaire accepte les formats numériques iPad", () => {
  assert.deepEqual(normalizeTimeInput("0615"), { digits: "0615", time: "06:15", error: null });
  assert.deepEqual(normalizeTimeInput("6:15"), { digits: "0615", time: "06:15", error: null });
  assert.equal(normalizeTimeInput("2568").error, "Heure invalide");
  assert.equal(validDurationMinutes("75"), true);
  assert.equal(validDurationMinutes("0"), false);
});

test("la clé d'analyse change avec chaque entrée métier", () => {
  const request = {
    version: 2,
    launchSite: { name: "LFQO", latitude: 50.686341, longitude: 3.079865 },
    launchDateTimeIso: "2026-08-04T06:15:00.000Z",
    durationSeconds: 3600,
    weatherModel: "arome_seamless",
    altitudesAmslM: ["ground", 300],
  };
  const first = createTrajectoryAnalysisKey(request, ["arome"], ["ground", 300]);
  assert.notEqual(first, createTrajectoryAnalysisKey({ ...request, durationSeconds: 4500 }, ["arome"], ["ground", 300]));
  assert.notEqual(first, createTrajectoryAnalysisKey(request, ["icon"], ["ground", 300]));
  assert.notEqual(first, createTrajectoryAnalysisKey(request, ["arome"], ["ground", 600]));
  assert.notEqual(first, createTrajectoryAnalysisKey({ ...request, launchSite: { ...request.launchSite, longitude: 3.2 } }, ["arome"], ["ground", 300]));
});

test("les limites de sélection conservent au moins une valeur", () => {
  assert.deepEqual(toggleLimitedSelection({ current: ["a"], value: "a", maximum: 3 }), { values: ["a"], limitReached: false });
  assert.deepEqual(toggleLimitedSelection({ current: ["a", "b", "c"], value: "d", maximum: 3 }), { values: ["a", "b", "c"], limitReached: true });
  assert.deepEqual(toggleLimitedSelection({ current: [100, 300], value: 100, maximum: 5 }), { values: [300], limitReached: false });
});

test("le cadrage inclut le départ, tous les points et gère l'antiméridien", () => {
  const trace = {
    projection: { points: [
      { latitude: 50.7, longitude: 3.2 },
      { latitude: 51.1, longitude: 4.4 },
    ] },
  };
  assert.deepEqual(calculateTrajectoryBounds([trace], { latitude: 50.6, longitude: 3 }), { west: 3, east: 4.4, south: 50.6, north: 51.1 });
  const wrapped = calculateTrajectoryBounds([{ projection: { points: [{ latitude: 10, longitude: -179 }] } }], { latitude: 9, longitude: 179 });
  assert.equal(wrapped.east - wrapped.west, 2);
  assert.deepEqual(analysisFitPadding(402), { top: 88, right: 88, bottom: 118, left: 88 });
});
