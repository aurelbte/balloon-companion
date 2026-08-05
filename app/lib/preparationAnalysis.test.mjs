import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  addFavoriteLaunchSite,
  DEFAULT_FAVORITE_LAUNCH_SITES,
  proposeFavoriteDisplayName,
  renameFavoriteLaunchSite,
  removeFavoriteLaunchSite,
  sameLaunchSite,
  updateFavoriteLaunchSite,
} from "./favoriteLaunchSites.ts";
import {
  clampVerticalRateMps,
  normalizeTimeInput,
  optionalAscentRateMps,
  optionalDescentRateMps,
  stepVerticalRateMps,
  validDurationMinutes,
} from "./preparationInputs.ts";
import {
  createTrajectoryAnalysisKey,
  toggleLimitedSelection,
} from "./trajectory/analysisState.ts";
import {
  analysisFitPadding,
  analysisFitMaxZoom,
  calculateTrajectoryBounds,
  countValidTrajectoryPoints,
  createTrajectoryFitKey,
  trajectoryContentKey,
} from "./trajectory/trajectoryBounds.ts";
import { newAnalysisLayerSettings } from "./trajectory/weatherAnalysisStorage.ts";

test("les favoris évitent les doublons et peuvent être retirés", () => {
  const lfqo = DEFAULT_FAVORITE_LAUNCH_SITES[0];
  assert.equal(addFavoriteLaunchSite(DEFAULT_FAVORITE_LAUNCH_SITES, lfqo).length, 2);
  const custom = { id: "custom", name: "Champ", latitude: 50.7, longitude: 3.1 };
  const added = addFavoriteLaunchSite(DEFAULT_FAVORITE_LAUNCH_SITES, custom, "2026-08-04T10:00:00.000Z");
  assert.equal(added.length, 3);
  assert.equal(sameLaunchSite(added[2], custom), true);
  assert.deepEqual(removeFavoriteLaunchSite(added, custom), DEFAULT_FAVORITE_LAUNCH_SITES);
});

test("un favori reçoit un nom court et peut être renommé sans modifier ses coordonnées", () => {
  const source = { id: "osm-1", name: "Boeschepe, 59299, Nord, Hauts-de-France, France", latitude: 50.80135, longitude: 2.687643 };
  assert.equal(proposeFavoriteDisplayName(source), "Boeschepe");
  const [favorite] = addFavoriteLaunchSite([], source, "2026-08-04T10:00:00.000Z");
  const [renamed] = renameFavoriteLaunchSite([favorite], favorite.id, "Terrain maison");
  assert.equal(renamed.name, "Terrain maison");
  assert.equal(renamed.sourceName, source.name);
  assert.equal(renamed.latitude, source.latitude);
  assert.equal(renamed.longitude, source.longitude);
  assert.equal(renamed.id, favorite.id);
});

test("modifier le point conserve l'identifiant et invalide l'altitude en cache", () => {
  const original = { ...DEFAULT_FAVORITE_LAUNCH_SITES[0], altitudeAmslM: 62 };
  const result = updateFavoriteLaunchSite([original], original.id, { name: "Terrain maison", latitude: 50.7, longitude: 3.1 }, "2026-08-05T10:00:00.000Z");
  assert.equal(result.duplicate, null);
  assert.equal(result.favorites[0].id, original.id);
  assert.equal(result.favorites[0].altitudeAmslM, undefined);
  assert.equal(result.favorites[0].updatedAt, "2026-08-05T10:00:00.000Z");
});

test("modifier un favori refuse les coordonnées exactes d'un autre favori", () => {
  const [first, second] = DEFAULT_FAVORITE_LAUNCH_SITES;
  const result = updateFavoriteLaunchSite(DEFAULT_FAVORITE_LAUNCH_SITES, first.id, { name: first.name, latitude: second.latitude, longitude: second.longitude });
  assert.equal(result.duplicate?.id, second.id);
  assert.deepEqual(result.favorites, DEFAULT_FAVORITE_LAUNCH_SITES);
});

test("la saisie horaire accepte les formats numériques iPad", () => {
  assert.deepEqual(normalizeTimeInput("0615"), { digits: "0615", time: "06:15", error: null });
  assert.deepEqual(normalizeTimeInput("6:15"), { digits: "0615", time: "06:15", error: null });
  assert.equal(normalizeTimeInput("2568").error, "Heure invalide");
  assert.equal(validDurationMinutes("75"), true);
  assert.equal(validDurationMinutes("0"), false);
});

test("les taux verticaux sont optionnels, positifs et convertis seulement à la frontière moteur", () => {
  assert.equal(optionalAscentRateMps(0), undefined);
  assert.equal(optionalAscentRateMps(2), 2);
  assert.equal(optionalDescentRateMps(-3), 3);
  assert.equal(stepVerticalRateMps(0, 1), 0.5);
  assert.equal(stepVerticalRateMps(7, 1), 7);
  assert.equal(stepVerticalRateMps(0, -1), 0);
  assert.equal(clampVerticalRateMps(2.24), 2);
  assert.equal(clampVerticalRateMps(2.26), 2.5);
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

test("les limites de sélection autorisent une analyse vierge", () => {
  assert.deepEqual(toggleLimitedSelection({ current: ["a"], value: "a", maximum: 3, minimum: 0 }), { values: [], limitReached: false });
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
  assert.deepEqual(analysisFitPadding(402), { top: 95, right: 105, bottom: 125, left: 105 });
  assert.equal(analysisFitMaxZoom(402), 11);
});

test("la clé de cadrage distingue chaque analyse, sélection, taille et recentrage", () => {
  const base = { analysisKey: "analysis-a", visibleTraceIds: ["trace-a"], width: 402, height: 650, recenterToken: 0, trajectoryKey: "trace-a:2:start:end" };
  const first = createTrajectoryFitKey(base);
  assert.notEqual(first, createTrajectoryFitKey({ ...base, analysisKey: "analysis-b" }));
  assert.notEqual(first, createTrajectoryFitKey({ ...base, visibleTraceIds: ["trace-a", "trace-b"] }));
  assert.notEqual(first, createTrajectoryFitKey({ ...base, width: 650, height: 402 }));
  assert.notEqual(first, createTrajectoryFitKey({ ...base, recenterToken: 1 }));
  assert.notEqual(first, createTrajectoryFitKey({ ...base, trajectoryKey: "trace-a:200:start:new-end" }));
  assert.equal(countValidTrajectoryPoints([{ projection: { points: [{ latitude: 50, longitude: 3 }, { latitude: Number.NaN, longitude: 4 }] } }]), 1);
});

test("une trajectoire LFQO longue vers le nord-est inclut son dernier point", () => {
  const points = Array.from({ length: 301 }, (_, index) => ({
    latitude: 50.686341 + index * 0.002,
    longitude: 3.079865 + index * 0.003,
  }));
  const trace = { traceId: "arome:1000", model: { id: "arome" }, altitudeKey: "1000", calculatedAtIso: "2026-08-04T06:00:00Z", projection: { points } };
  const bounds = calculateTrajectoryBounds([trace], { latitude: 50.686341, longitude: 3.079865 });
  assert.equal(countValidTrajectoryPoints([trace]), 301);
  assert.equal(bounds.north, points.at(-1).latitude);
  assert.equal(bounds.east, points.at(-1).longitude);
});

test("une trace partielle puis complète produit une nouvelle signature de cadrage", () => {
  const buildTrace = (points) => ({ traceId: "arome:1000", model: { id: "arome" }, altitudeKey: "1000", calculatedAtIso: "2026-08-04T06:00:00Z", projection: { points } });
  const partial = buildTrace([{ latitude: 50.68, longitude: 3.08 }]);
  const complete = buildTrace([{ latitude: 50.68, longitude: 3.08 }, { latitude: 51.2, longitude: 4.1 }]);
  assert.notEqual(trajectoryContentKey([partial]), trajectoryContentKey([complete]));
});

test("une nouvelle analyse ouvre le fond classique sans espaces aériens", () => {
  const layers = newAnalysisLayerSettings();
  assert.equal(layers.satellite, false);
  assert.equal(layers.airspaces, false);
  assert.equal(layers.trajectories, true);
});

test("Prépa expose une gestion dédiée et un état sélectionné accessible des favoris", () => {
  const source = readFileSync(new URL("../components/prepare/TerrainSelector.tsx", import.meta.url), "utf8");
  assert.match(source, /Gérer les favoris/);
  assert.match(source, /Ajouter un favori/);
  assert.match(source, /Modifier/);
  assert.match(source, /Supprimer/);
  assert.match(source, /aria-selected=\{selected\}/);
});

test("la carte de confirmation est ouverte avant l'enregistrement du favori", () => {
  const source = readFileSync(new URL("../components/prepare/TerrainSelector.tsx", import.meta.url), "utf8");
  const mapSource = readFileSync(new URL("../components/prepare/LaunchPointMapDialog.tsx", import.meta.url), "utf8");
  assert.match(source, /setMapDraft\(\{ point: terrain/);
  assert.match(source, /Déplacez le point sur le lieu exact de décollage/);
  assert.match(mapSource, /draggable: true/);
  assert.match(mapSource, /map\.on\("click"/);
  assert.match(mapSource, /Utiliser ma position/);
});

test("l'Analyse démarre sans sélection ni restauration visuelle du cache", () => {
  const source = readFileSync(new URL("../map/page.tsx", import.meta.url), "utf8");
  assert.match(source, /setSelectedModels\(\[\]\)/);
  assert.match(source, /setSelectedAltitudes\(\[\]\)/);
  assert.match(source, /setVisibleTraceIds\(\[\]\)/);
  assert.match(source, /Sélectionnez un modèle et une altitude\./);
  assert.doesNotMatch(source, /loadWeatherAnalysis/);
});

test("le cadrage final attend MapLibre idle et partage une seule fonction de fit", () => {
  const source = readFileSync(new URL("../components/PreparationMap.tsx", import.meta.url), "utf8");
  assert.match(source, /pointCount === 0/);
  assert.ok(source.indexOf("map.resize()") < source.indexOf('map.once("idle"'));
  assert.match(source, /lastCompletedTrajectoryFitKey\.current = fitKey/);
  assert.match(source, /fitVisibleTrajectoryBounds/);
  assert.match(source, /scheduleTrajectoryFit/);
  assert.match(source, /map\.off\("idle", handleIdle\)/);
  assert.equal(source.match(/map\.fitBounds/g).length, 1);
});

test("Prépa affiche deux steppers facultatifs en m\/s sans clavier", () => {
  const source = readFileSync(new URL("../prepare/page.tsx", import.meta.url), "utf8");
  assert.match(source, /ascentRateMps/);
  assert.match(source, /descentRateMps/);
  assert.match(source, /stepVerticalRateMps/);
  assert.doesNotMatch(source, /ascentRateMPerMin/);
  assert.match(source, /m\/s/);
});

test("l'Analyse transmet les deux taux convertis au moteur existant", () => {
  const source = readFileSync(new URL("../map/page.tsx", import.meta.url), "utf8");
  assert.match(source, /config\.request\.climbRateMps/);
  assert.match(source, /config\.request\.descentRateMps/);
});
