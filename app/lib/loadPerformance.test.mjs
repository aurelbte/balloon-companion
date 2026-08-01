import test from "node:test";
import assert from "node:assert/strict";
import { balloonEquipmentWeightForLoad } from "./loadPerformance/balloonInput.ts";
import { calculateOfficialLoad, displayLoadMarginKg, loadMarginTone } from "./loadPerformance/engine.ts";
import { calculateDemoLoad, demoLoadCacheKey, DEMO_LOAD_BADGE } from "./loadPerformance/demoEngine.ts";
import { interpolateDemoPermittedMass } from "./loadPerformance/demoInterpolation.ts";
import { demoCameronZ105, enabledDemoLoadDatasets } from "./loadPerformance/datasets/demoCameronZ105.ts";
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
  groundTemperature: { temperatureC: 11, sourceModel: "AROME", forecastRun: "2026-08-02T00:00:00.000Z", validTime: "2026-08-02T05:00:00.000Z" },
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
  assert.equal(calculateOfficialLoad({ ...completeInput, groundTemperature: undefined }).reasonCode, "NO_GROUND_TEMPERATURE");
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

test("le dataset UX reste démonstratif et séparé des datasets officiels", () => {
  assert.equal(demoCameronZ105.authorityStatus, "DEMO_ONLY");
  assert.equal(demoCameronZ105.official, false);
  assert.equal(enabledDemoLoadDatasets.length, 1);
  assert.ok(!officialLoadDatasets.some(({ id }) => id === demoCameronZ105.id));
  assert.equal(DEMO_LOAD_BADGE, "TEST");
});

test("le moteur DEMO est impossible à utiliser hors activation explicite", () => {
  const result = calculateDemoLoad(completeInput, false);
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reasonCode, "UNSUPPORTED_OFFICIAL_DATASET");
});

test("l'interpolation DEMO est bilinéaire et n'extrapole jamais", () => {
  assert.equal(interpolateDemoPermittedMass(demoCameronZ105.table, 0, 0), 1450);
  assert.equal(interpolateDemoPermittedMass(demoCameronZ105.table, 5, 250), 1370);
  assert.equal(interpolateDemoPermittedMass(demoCameronZ105.table, -1, 500), null);
  assert.equal(interpolateDemoPermittedMass(demoCameronZ105.table, 10, 2001), null);
});

test("le calcul DEMO utilise uniquement la température sol, l'altitude AMSL et les masses fournies", () => {
  const result = calculateDemoLoad({ ...completeInput, groundTemperature: { ...completeInput.groundTemperature, temperatureC: 10 } }, true);
  assert.equal(result.status, "AVAILABLE");
  if (result.status !== "AVAILABLE") return;
  assert.equal(result.calculationMode, "DEMO");
  assert.equal(result.datasetId, "DEMO_CAMERON_Z105_UI_TEST");
  assert.equal(result.permittedTotalMassKg, 1130);
  assert.equal(result.actualTotalMassKg, 1173);
  assert.equal(result.marginKg, -43);
  assert.equal(result.groundTemperatureC, 10);
  assert.equal(result.launchElevationMslM, 47);
});

test("le calcul DEMO couvre les marges positive, faible et négative", () => {
  for (const [occupantsWeightKg, tone] of [[100, "positive"], [360, "caution"], [400, "negative"]]) {
    const result = calculateDemoLoad({ ...completeInput, occupantsWeightKg, plannedMaximumAltitudeMslM: 1000, groundTemperature: { ...completeInput.groundTemperature, temperatureC: 10 } }, true);
    assert.equal(result.status, "AVAILABLE");
    if (result.status === "AVAILABLE") assert.equal(loadMarginTone(result.marginKg), tone);
  }
});

test("les données obligatoires et les limites DEMO restent explicites", () => {
  assert.equal(calculateDemoLoad({ ...completeInput, plannedMaximumAltitudeMslM: undefined }, true).reasonCode, "NO_MAXIMUM_ALTITUDE");
  assert.equal(calculateDemoLoad({ ...completeInput, occupantsWeightKg: undefined }, true).reasonCode, "NO_OCCUPANTS_WEIGHT");
  assert.equal(calculateDemoLoad({ ...completeInput, balloonEquipmentWeightKg: undefined }, true).reasonCode, "INCOMPLETE_BALLOON_MASSES");
  assert.equal(calculateDemoLoad({ ...completeInput, plannedMaximumAltitudeMslM: 2500 }, true).reasonCode, "OUTSIDE_DEMO_TABLE");
  const belowTerrain = calculateDemoLoad({ ...completeInput, plannedMaximumAltitudeMslM: 40 }, true);
  assert.equal(belowTerrain.reasonCode, "OUTSIDE_DEMO_TABLE");
  assert.match(belowTerrain.message, /altitude du terrain/);
});

test("la clé de cache est invalidée à chaque entrée métier ou échéance modifiée", () => {
  const initial = demoLoadCacheKey(completeInput);
  assert.notEqual(initial, demoLoadCacheKey({ ...completeInput, occupantsWeightKg: 341 }));
  assert.notEqual(initial, demoLoadCacheKey({ ...completeInput, plannedMaximumAltitudeMslM: 1600 }));
  assert.notEqual(initial, demoLoadCacheKey({ ...completeInput, launchDateTime: "2026-08-02T05:30:00.000Z" }));
});
