import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPowerLinesQuery, getPowerLineQueryBounds, powerLineBoundsContain, powerLineBoundsKey, toPowerLineGeoJson } from "./powerLines.ts";

test("la requête inclut les lignes principales et exclut les lignes mineures", () => {
  const query = buildPowerLinesQuery({ west: 2, south: 50, east: 3, north: 51 });
  assert.match(query, /power.*line/);
  assert.doesNotMatch(query, /minor_line/);
  const geojson = toPowerLineGeoJson({ elements: [
    { id: 1, tags: { power: "line" }, geometry: [{ lat: 50, lon: 2 }, { lat: 51, lon: 3 }] },
    { id: 2, tags: { power: "minor_line" }, geometry: [{ lat: 50, lon: 2 }, { lat: 51, lon: 3 }] },
  ] });
  assert.deepEqual(geojson.features.map(({ id }) => id), [1]);
});

test("une emprise déplacée charge une nouvelle zone tandis qu'une zone déjà couverte réutilise le cache", () => {
  const initial = getPowerLineQueryBounds({ west: 3, south: 50.6, east: 3.2, north: 50.8 });
  const nearby = getPowerLineQueryBounds({ west: 3.02, south: 50.62, east: 3.18, north: 50.78 });
  const moved = getPowerLineQueryBounds({ west: 5, south: 48.7, east: 5.3, north: 49 });
  assert.equal(powerLineBoundsContain(initial, nearby), true);
  assert.equal(powerLineBoundsContain(initial, moved), false);
  assert.notEqual(powerLineBoundsKey(initial), powerLineBoundsKey(moved));
});

test("un fort dézoom produit encore une emprise Overpass utile et valide", () => {
  const queryBounds = getPowerLineQueryBounds({ west: -5, south: 42, east: 9, north: 51 });
  assert.ok(queryBounds.east - queryBounds.west <= 2);
  assert.ok(queryBounds.north - queryBounds.south <= 2);
});

test("le calque reste désactivé et ne charge rien par défaut", () => {
  const page = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  const map = readFileSync(new URL("../components/flight/FlightMap.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/flight/MapOptionsPopover.tsx", import.meta.url), "utf8");
  assert.match(page, /powerLines: false/);
  assert.match(page, /showPowerLines=\{layerSettings\.powerLines\}/);
  assert.match(panel, /\["powerLines", "Lignes haute tension"\]/);
  assert.match(map, /if \(!showPowerLines\) return/);
  assert.match(map, /map\.current\.on\("moveend"/);
  assert.match(map, /powerLineBoundsContain/);
  assert.match(map, /visibility: showPowerLinesRef\.current \? "visible" as const : "none" as const/);
});

test("la route utilise le POST accepté par Overpass", () => {
  const route = readFileSync(new URL("../api/osm/power-lines/route.ts", import.meta.url), "utf8");
  assert.match(route, /method: "POST"/);
  assert.match(route, /application\/x-www-form-urlencoded/);
});

test("le rendu utilise un double trait épais au-dessus des espaces et sous les trajectoires", () => {
  const map = readFileSync(new URL("../components/flight/FlightMap.tsx", import.meta.url), "utf8");
  assert.match(map, /POWER_LINES_CASING_LAYER_ID/);
  assert.match(map, /8, 4\.6, 14, 7/);
  assert.match(map, /8, 2\.8, 14, 4\.6/);
  assert.ok(map.indexOf("id: AIRSPACES_SELECTED_OUTLINE_LAYER_ID") < map.lastIndexOf("id: POWER_LINES_CASING_LAYER_ID"));
  assert.ok(map.lastIndexOf("id: POWER_LINES_LAYER_ID") < map.indexOf("map.current.addSource(PLANNED_TRAJECTORIES_SOURCE_ID"));
});

test("le fond initial reflète la sélection et la modale n'affiche pas de point d'interrogation isolé", () => {
  const page = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  const map = readFileSync(new URL("../components/flight/FlightMap.tsx", import.meta.url), "utf8");
  assert.match(map, /visibility: baseMapRef\.current === "plan" \? "visible" : "none"/);
  assert.match(map, /visibility: baseMapRef\.current === "satellite" \? "visible" : "none"/);
  assert.doesNotMatch(page, /Arrêter et enregistrer ce vol \?/);
});
