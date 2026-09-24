import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../prepare/page.tsx", import.meta.url), "utf8");
const selector = readFileSync(new URL("../components/prepare/TerrainSelector.tsx", import.meta.url), "utf8");

test("la recherche terrain démarre après trois caractères et 300 ms", () => {
  assert.match(page, /query\.length < 3/);
  assert.match(page, /window\.setTimeout\([\s\S]*?, 300\)/);
  assert.match(page, /\/api\/geocoding\/search\?q=/);
});

test("une ancienne requête est annulée et ne peut pas publier ses résultats", () => {
  assert.match(page, /const controller = new AbortController\(\)/);
  assert.match(page, /\{ signal: controller\.signal \}/);
  assert.match(page, /terrainSearchSequence\.current !== sequence/);
  assert.match(page, /controller\.abort\(\)/);
});

test("la loupe principale est supprimée mais les propositions et la géolocalisation restent disponibles", () => {
  assert.doesNotMatch(selector, /aria-label="Rechercher le terrain"/);
  assert.doesNotMatch(selector, /onSearch: \(\) => void/);
  assert.match(selector, /suggestions\.map/);
  assert.match(selector, /aria-label="Utiliser ma position"/);
  assert.match(selector, /terrain-search-feedback/);
});
