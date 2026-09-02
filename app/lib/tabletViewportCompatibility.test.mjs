import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const flightMap = readFileSync(new URL("../components/flight/FlightMap.tsx", import.meta.url), "utf8");
const migrationDialogStyles = readFileSync(new URL("../components/auth/LocalDataMigrationDialog.module.css", import.meta.url), "utf8");
const preparePage = readFileSync(new URL("../prepare/page.tsx", import.meta.url), "utf8");
const mapPage = readFileSync(new URL("../map/page.tsx", import.meta.url), "utf8");

test("FlightMap redimensionne MapLibre seulement quand son conteneur change", () => {
  assert.match(flightMap, /new ResizeObserver\(resizeMapIfNeeded\)/);
  assert.match(flightMap, /nextSize\.width === previousSize\.width/);
  assert.match(flightMap, /nextSize\.height === previousSize\.height/);
  assert.match(flightMap, /map\.current\?\.resize\(\)/);
  assert.match(flightMap, /resizeObserver\.disconnect\(\)/);
  assert.match(flightMap, /cancelAnimationFrame\(resizeFrame\)/);
});

test("les surfaces ciblées restent scrollables dans un viewport bas", () => {
  assert.match(migrationDialogStyles, /max-height: calc\(100dvh/);
  assert.match(migrationDialogStyles, /overflow-y: auto/);
  assert.match(migrationDialogStyles, /safe-area-inset-top/);
  assert.match(migrationDialogStyles, /safe-area-inset-bottom/);
  assert.match(preparePage, /max-h-\[calc\(100dvh-24px\)\][^\n]*overflow-y-auto/);
  assert.equal((mapPage.match(/max-h-\[calc\(100dvh-12px\)\][^\n]*overflow-y-auto/g) ?? []).length, 2);
});
