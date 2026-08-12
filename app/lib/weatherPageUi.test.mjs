import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
const cockpitCard = readFileSync(new URL("../components/cockpit/ConditionsCard.tsx", import.meta.url), "utf8");

test("la carte météo ouvre la page dédiée", () => {
  assert.match(cockpitCard, /<Link[^>]+href=\{href\}/);
  assert.match(page, /href="\/"/);
});

test("Météo est sélectionné par défaut et Aviation reste indépendant", () => {
  assert.match(page, /useState<"weather" \| "aviation">\("weather"\)/);
  assert.match(page, /weatherPlace: null, aviationStation: null/);
});

test("les états vides météo, METAR et TAF sont prévus sans valeurs exemples", () => {
  assert.match(page, /Aucun lieu météo sélectionné/);
  assert.match(page, /Aucun aérodrome sélectionné/);
  assert.match(page, /METAR non disponible/);
  assert.match(page, /TAF non disponible/);
  assert.doesNotMatch(page, /LFQO|Lille|06:12|21:48/);
});
