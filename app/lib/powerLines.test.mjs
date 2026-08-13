import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPowerLinesQuery, toPowerLineGeoJson } from "./powerLines.ts";

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

test("le calque reste désactivé et ne charge rien par défaut", () => {
  const page = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  const map = readFileSync(new URL("../components/flight/FlightMap.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/flight/MapOptionsPopover.tsx", import.meta.url), "utf8");
  assert.match(page, /powerLines: false/);
  assert.match(page, /showPowerLines=\{layerSettings\.powerLines\}/);
  assert.match(panel, /\["powerLines", "Lignes haute tension"\]/);
  assert.match(map, /if \(!showPowerLines\) return/);
  assert.match(map, /visibility: showPowerLinesRef\.current \? "visible" : "none"/);
});

test("la route utilise le POST accepté par Overpass", () => {
  const route = readFileSync(new URL("../api/osm/power-lines/route.ts", import.meta.url), "utf8");
  assert.match(route, /method: "POST"/);
  assert.match(route, /application\/x-www-form-urlencoded/);
});

test("le fond initial reflète la sélection et la modale n'affiche pas de point d'interrogation isolé", () => {
  const page = readFileSync(new URL("../flight/page.tsx", import.meta.url), "utf8");
  const map = readFileSync(new URL("../components/flight/FlightMap.tsx", import.meta.url), "utf8");
  assert.match(map, /visibility: baseMapRef\.current === "plan" \? "visible" : "none"/);
  assert.match(map, /visibility: baseMapRef\.current === "satellite" \? "visible" : "none"/);
  assert.doesNotMatch(page, /Arrêter et enregistrer ce vol \?/);
});
