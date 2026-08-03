import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { balloonFormSectionDefaults, mtomAfterManualChange, mtomAfterModelChange } from "./balloonFormPolicy.ts";

test("le formulaire ouvre les sections essentielles et ferme les détails facultatifs", () => {
  assert.deepEqual(balloonFormSectionDefaults(false, false), { identity: true, masses: true, limits: true, optionalDetails: false });
  assert.deepEqual(balloonFormSectionDefaults(true, true), { identity: true, masses: true, limits: false, optionalDetails: false });
});

test("le Z105 propose 952 kg sans confirmer les limites", () => {
  assert.deepEqual(mtomAfterModelChange("", false, "Cameron", "Z105"), { value: "952", fromCatalog: true, configurationLimitsConfirmed: false });
});

test("un modèle à limites multiples ou inconnu ne reçoit aucune MTOM", () => {
  assert.deepEqual(mtomAfterModelChange("", false, "Cameron", "Z90"), { value: "", fromCatalog: false, configurationLimitsConfirmed: false });
  assert.deepEqual(mtomAfterModelChange("", false, "Cameron", "Z300"), { value: "", fromCatalog: false, configurationLimitsConfirmed: false });
});

test("le catalogue ne remplace jamais une MTOM saisie par le pilote", () => {
  assert.deepEqual(mtomAfterModelChange("940", false, "Cameron", "Z105"), { value: "940", fromCatalog: false, configurationLimitsConfirmed: false });
});

test("toute modification manuelle de MTOM annule la confirmation", () => {
  assert.deepEqual(mtomAfterManualChange("951"), { value: "951", fromCatalog: false, configurationLimitsConfirmed: false });
});

test("la structure mobile évite le scroll horizontal et compacte les cylindres", () => {
  const css = readFileSync(new URL("../more/More.module.css", import.meta.url), "utf8");
  const component = readFileSync(new URL("../components/balloons/BalloonForm.tsx", import.meta.url), "utf8");
  assert.match(css, /\.balloonForm\s*\{[^}]*overflow-x:\s*clip/s);
  assert.match(css, /\.cylinderRow\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.balloonFormActions\s*\{[^}]*position:\s*sticky/s);
  assert.equal((component.match(/<details/g) ?? []).length, 4);
});
