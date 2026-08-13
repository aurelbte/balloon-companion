import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const details = readFileSync(new URL("../components/flight/AirspaceDetails.tsx", import.meta.url), "utf8");

test("la fiche conserve les informations aéronautiques et le carrousel", () => {
  for (const label of ["PLANCHER", "PLAFOND", "PAYS", "Espace aérien précédent", "Espace aérien suivant"]) assert.match(details, new RegExp(label));
});

test("la fiche ne contient plus le bloc de position verticale", () => {
  for (const label of ["ÉCART JUSQU’AU PLAFOND", "Dans les limites verticales", "Altitude GPS indicative", "MARGE VERTICALE", "POSITION VERTICALE"]) assert.doesNotMatch(details, new RegExp(label));
  assert.doesNotMatch(details, /verticalContext/);
});
