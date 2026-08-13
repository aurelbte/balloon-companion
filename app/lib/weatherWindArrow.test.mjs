import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { windArrowRotationDegrees } from "../weather/windArrow.ts";

test("oriente Navigation selon le déplacement de l'air et son cap natif nord-est", () => {
  assert.equal(windArrowRotationDegrees(0), 135); // Sud
  assert.equal(windArrowRotationDegrees(90), 225); // Ouest
  assert.equal(windArrowRotationDegrees(180), 315); // Nord
  assert.equal(windArrowRotationDegrees(270), 45); // Est
  assert.equal(windArrowRotationDegrees(45), 180); // Sud-Ouest
  assert.equal(windArrowRotationDegrees(225), 0); // Nord-Est
});

test("Cockpit et Météo détaillée utilisent le même helper", () => {
  const cockpit = readFileSync(new URL("../components/cockpit/ConditionsCard.tsx", import.meta.url), "utf8");
  const weather = readFileSync(new URL("../weather/page.tsx", import.meta.url), "utf8");
  assert.match(cockpit, /windArrowRotationDegrees\(point\?\.windDirectionDeg\)/);
  assert.match(weather, /windArrowRotationDegrees\(slot\.windDirectionDeg\)/);
});
