import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const instruments = readFileSync(new URL("../components/flight/FlightInstruments.tsx", import.meta.url), "utf8");
const winds = readFileSync(new URL("../components/flight/WindProfilePanel.tsx", import.meta.url), "utf8");
const controls = readFileSync(new URL("../components/flight/FlightControls.tsx", import.meta.url), "utf8");
const airspace = readFileSync(new URL("../components/flight/AirspaceDetails.tsx", import.meta.url), "utf8");
const map = readFileSync(new URL("../components/flight/FlightMap.tsx", import.meta.url), "utf8");

test("les instruments et commandes essentielles restent présents", () => {
  for (const label of ["ALT GPS", "GND estimé", "QNH", "CAP", "VARIO", "SOL", "DIST.", "VOL"]) assert.match(instruments, new RegExp(label.replace(".", "\\.")));
  for (const label of ["Suivre ma position", "Vue élargie", "Options de carte", "DÉMARRER", "ARRÊTER"]) assert.match(controls, new RegExp(label));
});

test("VENTS et la fiche espace restent accessibles avec des cibles tactiles harmonisées", () => {
  assert.match(winds, />VENTS</);
  assert.match(winds, /Profil vertical des vents/);
  assert.match(airspace, /Espace aérien précédent/);
  assert.match(airspace, /Espace aérien suivant/);
  assert.match(airspace, /width: "40px"/);
});

test("les boutons de zoom MapLibre ne réapparaissent pas", () => {
  assert.match(map, /showZoom: false/);
});
