import test from "node:test";
import assert from "node:assert/strict";
import { balloonEquipmentWeightForLoad } from "./loadPerformance/balloonInput.ts";
import { calculateOfficialLoad, displayLoadMarginKg, loadMarginTone } from "./loadPerformance/engine.ts";
import { enabledOfficialLoadDatasets, officialLoadDatasets, validateOfficialLoadDatasets } from "./loadPerformance/manufacturerDatasets.ts";
import { createBalloon } from "./balloons.ts";

const completeInput = {
  balloonId: "F-TEST",
  manufacturer: "Cameron",
  model: "Z105",
  volumeM3: 2_973,
  officialManualId: "CAMERON_ISSUE_10",
  officialManualRevision: "Amendment 18",
  officialLoadDatasetId: "CAMERON_ISSUE_10_AMENDMENT_18",
  balloonEquipmentWeightKg: 833,
  occupantsWeightKg: 340,
  launchLatitude: 50.686341,
  launchLongitude: 3.079865,
  launchElevationMslM: 47,
  launchDateTime: "2026-08-02T04:30:00.000Z",
  plannedMaximumAltitudeMslM: 1_500,
  temperatureProfile: [{ altitudeMslM: 1_500, temperatureC: 11, sourceModel: "AROME", forecastRun: "2026-08-02T00:00:00.000Z", validTime: "2026-08-02T05:00:00.000Z" }],
};

test("aucun dataset constructeur non vérifié n'est activé", () => {
  assert.equal(officialLoadDatasets.length, 3);
  assert.deepEqual(enabledOfficialLoadDatasets, []);
  assert.deepEqual(validateOfficialLoadDatasets(), []);
});

test("un dataset activé sans preuve complète fait échouer l'audit", () => {
  const unsafe = { ...officialLoadDatasets[0], enabled: true };
  const errors = validateOfficialLoadDatasets([unsafe]);
  assert.ok(errors.some((error) => error.includes("aucun modèle activé")));
  assert.ok(errors.some((error) => error.includes("golden test absent")));
  assert.ok(errors.some((error) => error.includes("interpolation non implémentée")));
});

test("le moteur explique chaque donnée manquante sans utiliser zéro", () => {
  assert.equal(calculateOfficialLoad({}).reasonCode, "NO_BALLOON");
  assert.equal(calculateOfficialLoad({ ...completeInput, balloonEquipmentWeightKg: undefined }).reasonCode, "INCOMPLETE_BALLOON_MASSES");
  assert.equal(calculateOfficialLoad({ ...completeInput, occupantsWeightKg: undefined }).reasonCode, "NO_OCCUPANTS_WEIGHT");
  assert.equal(calculateOfficialLoad({ ...completeInput, plannedMaximumAltitudeMslM: undefined }).reasonCode, "NO_MAXIMUM_ALTITUDE");
  assert.equal(calculateOfficialLoad({ ...completeInput, launchElevationMslM: undefined }).reasonCode, "NO_LAUNCH_ELEVATION");
  assert.equal(calculateOfficialLoad({ ...completeInput, temperatureProfile: [] }).reasonCode, "NO_TEMPERATURE_PROFILE");
});

test("une altitude maximale sous le terrain est refusée", () => {
  const result = calculateOfficialLoad({ ...completeInput, plannedMaximumAltitudeMslM: 40 });
  assert.deepEqual(result, { status: "UNAVAILABLE", reasonCode: "OUTSIDE_OFFICIAL_TABLE", message: "L’altitude maximale prévue est inférieure à l’altitude du terrain." });
});

test("Cameron, Kubíček et Ultramagic restent bloqués sans golden dataset", () => {
  for (const manufacturer of ["Cameron", "Kubíček", "Ultramagic"]) {
    const result = calculateOfficialLoad({ ...completeInput, manufacturer });
    assert.equal(result.status, "UNAVAILABLE");
    assert.equal(result.reasonCode, "UNSUPPORTED_OFFICIAL_DATASET");
  }
});

test("le moteur de charge réutilise la masse centrale du ballon", () => {
  const balloon = createBalloon({
    registration: "F-TEST",
    manufacturer: "Cameron",
    model: "Z105",
    category: "Libre à air chaud",
    volumeM3: 2_973,
    weights: { envelopeKg: 285, burnerKg: 72, basketKg: 220, fullCylinders: [64, 64, 64, 64].map((fullWeightKg, index) => ({ id: String(index), fullWeightKg })) },
  });
  assert.equal(balloonEquipmentWeightForLoad(balloon), 833);
});

test("l'affichage arrondit la marge vers le bas et centralise les tons", () => {
  assert.equal(displayLoadMarginKg(12.9), 12);
  assert.equal(displayLoadMarginKg(-12.1), -13);
  assert.equal(loadMarginTone(84), "positive");
  assert.equal(loadMarginTone(12), "caution");
  assert.equal(loadMarginTone(-1), "negative");
});
