import test from "node:test";
import assert from "node:assert/strict";
import { balloonEquipmentWeightForLoad } from "./loadPerformance/balloonInput.ts";
import { calculateOfficialLoad, displayLoadMarginKg, loadMarginTone } from "./loadPerformance/engine.ts";
import { calculateDemoLoad, demoLoadCacheKey, DEMO_LOAD_BADGE, isDemoCameronZ105 } from "./loadPerformance/demoEngine.ts";
import { interpolateDemoPermittedMass } from "./loadPerformance/demoInterpolation.ts";
import { formatDemoLoadDiagnostic } from "./loadPerformance/demoDiagnostic.ts";
import { loadDisplayPolicy } from "./loadPerformance/loadDisplayMode.ts";
import { resolveSyntheticMarginMode } from "./loadPerformance/demoMode.ts";
import { demoCameronZ105, enabledDemoLoadDatasets } from "./loadPerformance/datasets/demoCameronZ105.ts";
import { enabledOfficialLoadDatasets, officialLoadDatasets, validateOfficialLoadDatasets } from "./loadPerformance/manufacturerDatasets.ts";
import { createBalloon } from "./balloons.ts";
import { cameronZ105Official } from "./loadPerformance/datasets/cameronZ105Official.ts";
import { calculateCameronMethodA2Candidate, calculateCameronOfficialCandidate } from "./loadPerformance/cameron/officialCalculation.ts";
import {
  cameronModelParameters,
  cameronZ105Parameters,
  canActivateOfficialLoadCandidate,
  enabledOfficialLoadParameterCombinations,
  kubicekModelParameters,
  officialLoadMethodMatrix,
  officialLoadValidationStrategy,
  ultramagicModelParameters,
  applicableMtomCatalog,
  applicableMtomCatalogEntry,
  proposedApplicableMtowKg,
  resolveApplicableMtowSuggestion,
} from "./loadPerformance/modelParameters/index.ts";
import {
  CAMERON_Z105_REFERENCE_001,
  applyApplicableMtowLimit,
  auditCameronZ105ReferenceCoverage,
  cameronZ105References,
  validateCameronZ105Reference,
} from "./loadPerformance/referenceCases/cameronZ105References.ts";

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
  assert.ok(errors.some((error) => error.includes("vérification absente")));
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

test("seul le Z105 explicitement confirmé peut atteindre le calcul candidat", () => {
  assert.equal(calculateOfficialLoad(completeInput).reasonCode, "CONFIGURATION_LIMITS_UNCONFIRMED");
  assert.equal(calculateOfficialLoad({ ...completeInput, manufacturer: "Kubíček" }).reasonCode, "UNSUPPORTED_MODEL");
  assert.equal(calculateOfficialLoad({ ...completeInput, manufacturer: "Ultramagic" }).reasonCode, "UNSUPPORTED_MODEL");
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

test("la marge synthétique exige les deux paramètres explicites", () => {
  assert.equal(resolveSyntheticMarginMode("?testLoad=1", true), false);
  assert.equal(resolveSyntheticMarginMode("?showSyntheticMargin=1", true), false);
  assert.equal(resolveSyntheticMarginMode("?testLoad=1&showSyntheticMargin=1", false), false);
  assert.equal(resolveSyntheticMarginMode("?testLoad=1&showSyntheticMargin=1", true), true);
});

test("le flux DEMO peut être validé sans exposer de kilogrammes synthétiques", () => {
  assert.deepEqual(loadDisplayPolicy({ demoEnabled: true, syntheticMarginRequested: false, resultAvailable: true }), {
    showSyntheticBadge: true,
    showSyntheticMargin: false,
    openSyntheticDetail: false,
  });
  assert.equal(loadDisplayPolicy({ demoEnabled: true, syntheticMarginRequested: true, resultAvailable: true }).showSyntheticMargin, true);
  assert.equal(loadDisplayPolicy({ demoEnabled: false, syntheticMarginRequested: true, resultAvailable: true }).showSyntheticMargin, false);
});

test("le Cameron Z105 est reconnu par ses champs structurés normalisés", () => {
  assert.equal(isDemoCameronZ105({ manufacturer: " cameron ", model: " z 105 " }), true);
  assert.equal(isDemoCameronZ105({ manufacturer: "Cameron", model: "Z120" }), false);
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

test("le diagnostic compact reflète exactement les données disponibles", () => {
  assert.equal(formatDemoLoadDiagnostic({ terrain: true, temperature: false, balloon: true, occupantsWeight: true, maximumAltitude: true }), "TERRAIN ✓ · TEMP ✕ · BALLON ✓ · POIDS ✓ · ALT ✓");
});

test("CAMERON_Z105_REFERENCE_001 reproduit exactement le golden case pilote", () => {
  const reference = CAMERON_Z105_REFERENCE_001;
  const validation = validateCameronZ105Reference(reference);
  assert.equal(reference.volumeM3, 2974);
  assert.equal(reference.applicableMtowKg, 952);
  assert.equal(reference.balloonEquipmentWeightKg, 415);
  assert.equal(reference.occupantsWeightKg, 330);
  assert.equal(validation.actualTotalMassKg, 745);
  assert.equal(validation.permittedTotalMassFromCapacityKg, 825);
  assert.equal(validation.marginFromCapacityKg, 80);
  assert.equal(validation.marginFromTotalsKg, 80);
  assert.equal(validation.coherent, true);
});

test("le candidat Cameron officiel reproduit le golden case sans constante d'ajustement", () => {
  const reference = CAMERON_Z105_REFERENCE_001;
  const result = calculateCameronOfficialCandidate({
    balloonId: reference.id,
    manufacturer: reference.manufacturer,
    model: reference.model,
    volumeM3: reference.volumeM3,
    applicableMtowKg: reference.applicableMtowKg,
    balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg,
    occupantsWeightKg: reference.occupantsWeightKg,
    launchElevationMslM: reference.launchElevationMslM,
    plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
    groundTemperature: { temperatureC: reference.groundTemperatureC, sourceModel: "REFERENCE", forecastRun: reference.verifiedAt, validTime: reference.verifiedAt },
  });
  assert.ok(result);
  assert.ok(Math.abs(result.performanceLimitedMassKg - 825.3448292881172) < 1e-9);
  assert.equal(Math.floor(result.permittedTotalMassKg), 825);
  assert.equal(Math.floor(result.marginKg), 80);
  assert.equal(result.limitingRule, "CAMERON_LIFT");
});

test("le candidat Cameron applique la MTOM et refuse toute applicabilité extrapolée", () => {
  const reference = CAMERON_Z105_REFERENCE_001;
  const input = {
    balloonId: reference.id, manufacturer: reference.manufacturer, model: reference.model,
    volumeM3: reference.volumeM3, applicableMtowKg: 800,
    balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg, occupantsWeightKg: reference.occupantsWeightKg,
    launchElevationMslM: reference.launchElevationMslM, plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
    groundTemperature: { temperatureC: reference.groundTemperatureC, sourceModel: "REFERENCE", forecastRun: reference.verifiedAt, validTime: reference.verifiedAt },
  };
  const limited = calculateCameronOfficialCandidate(input);
  assert.equal(limited?.permittedTotalMassKg, 800);
  assert.equal(limited?.limitingRule, "APPLICABLE_MTOW");
  assert.equal(calculateCameronOfficialCandidate({ ...input, model: "Z120" }), null);
  assert.equal(calculateCameronOfficialCandidate({ ...input, volumeM3: 2_973 }), null);
  assert.equal(calculateCameronOfficialCandidate({ ...input, plannedMaximumAltitudeMslM: 50 }), null);
});

test("la méthode Cameron A2 est indépendante du Z105 et exige un jeu de paramètres exact", () => {
  const reference = CAMERON_Z105_REFERENCE_001;
  const z120 = cameronModelParameters.find(({ model }) => model === "Z-120");
  assert.ok(z120);
  const base = {
    balloonId: "CAMERON-Z120-AUDIT", manufacturer: "Cameron", model: "Z120",
    volumeM3: z120.volumeM3, applicableMtowKg: 1_100,
    balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg, occupantsWeightKg: reference.occupantsWeightKg,
    launchElevationMslM: reference.launchElevationMslM, plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
    groundTemperature: { temperatureC: reference.groundTemperatureC, sourceModel: "REFERENCE", forecastRun: reference.verifiedAt, validTime: reference.verifiedAt },
  };
  assert.ok(calculateCameronMethodA2Candidate(base, z120));
  assert.equal(calculateCameronMethodA2Candidate({ ...base, volumeM3: 2_974 }, z120), null);
  assert.equal(calculateCameronMethodA2Candidate(base, cameronZ105Parameters), null);
  assert.equal(calculateCameronOfficialCandidate(base), null);
});

test("les registres séparent méthodes, paramètres modèles et limites de configuration", () => {
  assert.equal(officialLoadMethodMatrix.length, 3);
  assert.deepEqual(enabledOfficialLoadParameterCombinations, []);
  assert.equal(cameronModelParameters.length, 11);
  assert.equal(kubicekModelParameters[0].verificationStatus, "PENDING_HUMAN_VERIFICATION");
  assert.equal(ultramagicModelParameters[0].verificationStatus, "PENDING_HUMAN_VERIFICATION");
  assert.equal(officialLoadValidationStrategy.method.minimumCases, 15);
  assert.equal(officialLoadValidationStrategy.familyOrTableRow.minimumCases, 3);
  assert.equal(officialLoadValidationStrategy.modelParameterSet.minimumCases, 2);
  assert.ok(!("applicableMtowKg" in cameronZ105Parameters));
});

test("l'activation exige la combinaison méthode, paramètres, révision et limites confirmées", () => {
  const complete = {
    key: {
      manufacturerMethodId: cameronZ105Parameters.manufacturerMethodId,
      modelParameterSetId: cameronZ105Parameters.id,
      manualRevision: cameronZ105Parameters.source.manualRevision,
      configurationLimitsConfirmed: true,
    },
    methodValidated: true,
    modelParametersVerified: true,
    sourcesTraceable: true,
    targetedTestsPassing: true,
  };
  assert.equal(canActivateOfficialLoadCandidate(complete), true);
  assert.equal(canActivateOfficialLoadCandidate({ ...complete, methodValidated: false }), false);
  assert.equal(canActivateOfficialLoadCandidate({ ...complete, targetedTestsPassing: false }), false);
});

test("la capacité occupants et la marge réagissent aux masses sans formule constructeur implicite", () => {
  const base = applyApplicableMtowLimit({ tablePermittedTotalMassKg: 825, applicableMtowKg: 952, balloonEquipmentWeightKg: 415, occupantsWeightKg: 330 });
  const heavierOccupants = applyApplicableMtowLimit({ tablePermittedTotalMassKg: 825, applicableMtowKg: 952, balloonEquipmentWeightKg: 415, occupantsWeightKg: 350 });
  const heavierEquipment = applyApplicableMtowLimit({ tablePermittedTotalMassKg: 825, applicableMtowKg: 952, balloonEquipmentWeightKg: 435, occupantsWeightKg: 330 });
  assert.deepEqual(base, { tablePermittedTotalMassKg: 825, permittedTotalMassKg: 825, occupantsCapacityKg: 410, actualTotalMassKg: 745, marginKg: 80, limitingRule: "CHARGE_CONDITIONS" });
  assert.equal(heavierOccupants.marginKg, 60);
  assert.equal(heavierEquipment.occupantsCapacityKg, 390);
  assert.equal(heavierEquipment.marginKg, 60);
});

test("la MTOM applicable limite toujours une masse de table supérieure", () => {
  const result = applyApplicableMtowLimit({ tablePermittedTotalMassKg: 825, applicableMtowKg: 780, balloonEquipmentWeightKg: 415, occupantsWeightKg: 330 });
  assert.equal(result.permittedTotalMassKg, 780);
  assert.equal(result.occupantsCapacityKg, 365);
  assert.equal(result.marginKg, 35);
  assert.equal(result.limitingRule, "APPLICABLE_MTOW");
});

test("le dataset officiel Cameron reste impossible à activer avec un seul cas", () => {
  assert.equal(cameronZ105Official.enabled, false);
  assert.equal(cameronZ105Official.documentedData.loadTable, null);
  assert.equal(cameronZ105Official.calculationMethod.interpolationPolicy, "DIRECT_FORMULA_NO_TABLE_INTERPOLATION");
  assert.equal(cameronZ105Official.verification.status, "PENDING_HUMAN_VERIFICATION");
  assert.ok(auditCameronZ105ReferenceCoverage(cameronZ105References).length > 0);
});

test("REFERENCE_001 passe par l'orchestrateur normal avec le statut validation pilote", () => {
  const reference = CAMERON_Z105_REFERENCE_001;
  const input = {
    ...completeInput,
    volumeM3: reference.volumeM3,
    applicableMtowKg: reference.applicableMtowKg,
    balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg,
    occupantsWeightKg: reference.occupantsWeightKg,
    launchElevationMslM: reference.launchElevationMslM,
    plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
    groundTemperature: { ...completeInput.groundTemperature, temperatureC: reference.groundTemperatureC },
    configurationLimitsConfirmed: true,
  };
  const official = calculateOfficialLoad(input);
  const demo = calculateDemoLoad(input, true);
  assert.equal(official.status, "AVAILABLE");
  if (official.status === "AVAILABLE") {
    assert.equal(official.calculationStatus, "CANDIDATE_PILOT_VALIDATION");
    assert.equal(official.manufacturerMethodId, "CAMERON_METHOD_A2");
    assert.equal(official.modelParameterSetId, "CAMERON_Z105");
    assert.equal(Math.floor(official.actualTotalMassKg), 745);
    assert.equal(Math.floor(official.availableOccupantsCapacityKg), 410);
    assert.equal(Math.floor(official.permittedTotalMassKg), 825);
    assert.equal(Math.floor(official.marginKg), 80);
    assert.equal(official.marginKg, official.availableOccupantsCapacityKg - reference.occupantsWeightKg);
    assert.equal("calculationMode" in official, false);
  }
  assert.equal(demo.status, "AVAILABLE");
  if (demo.status === "AVAILABLE") {
    assert.equal(demo.calculationMode, "DEMO");
    assert.notEqual(demo.marginKg, reference.expectedMarginKg);
  }
});

test("le candidat Z105 expose chaque précondition manquante sans fallback DEMO", () => {
  const reference = CAMERON_Z105_REFERENCE_001;
  const input = {
    ...completeInput,
    volumeM3: 2_973,
    applicableMtowKg: reference.applicableMtowKg,
    balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg,
    occupantsWeightKg: reference.occupantsWeightKg,
    launchElevationMslM: reference.launchElevationMslM,
    plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
    groundTemperature: { ...completeInput.groundTemperature, temperatureC: reference.groundTemperatureC },
    configurationLimitsConfirmed: true,
  };
  assert.equal(calculateOfficialLoad({ ...input, configurationLimitsConfirmed: false }).reasonCode, "CONFIGURATION_LIMITS_UNCONFIRMED");
  assert.equal(calculateOfficialLoad({ ...input, applicableMtowKg: undefined }).reasonCode, "MISSING_MTOW");
  assert.equal(calculateOfficialLoad({ ...input, balloonEquipmentWeightKg: undefined }).reasonCode, "INCOMPLETE_BALLOON_MASSES");
  assert.equal(calculateOfficialLoad({ ...input, groundTemperature: undefined }).reasonCode, "NO_GROUND_TEMPERATURE");
  assert.equal(calculateOfficialLoad({ ...input, launchElevationMslM: undefined }).reasonCode, "NO_LAUNCH_ELEVATION");
  assert.equal(calculateOfficialLoad({ ...input, plannedMaximumAltitudeMslM: undefined }).reasonCode, "NO_MAXIMUM_ALTITUDE");
  assert.equal(calculateOfficialLoad({ ...input, model: "Z350", volumeM3: 9_911 }).reasonCode, "PENDING_VERIFICATION");
  assert.equal(calculateOfficialLoad({ ...input, volumeM3: 2_970 }).reasonCode, "VOLUME_MISMATCH");
  assert.equal(calculateOfficialLoad({ ...input, manufacturer: " cameron ", model: "Z-105" }).status, "AVAILABLE");
});

test("le candidat applique MTOM, marges négative et proche de zéro sans arrondi intermédiaire", () => {
  const reference = CAMERON_Z105_REFERENCE_001;
  const input = {
    ...completeInput,
    volumeM3: 2_973,
    applicableMtowKg: reference.applicableMtowKg,
    balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg,
    occupantsWeightKg: reference.occupantsWeightKg,
    launchElevationMslM: reference.launchElevationMslM,
    plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
    groundTemperature: { ...completeInput.groundTemperature, temperatureC: reference.groundTemperatureC },
    configurationLimitsConfirmed: true,
  };
  const mtomLimited = calculateOfficialLoad({ ...input, applicableMtowKg: 800 });
  assert.equal(mtomLimited.status, "AVAILABLE");
  if (mtomLimited.status === "AVAILABLE") assert.equal(mtomLimited.limitingRule, "APPLICABLE_MTOW");
  const negative = calculateOfficialLoad({ ...input, occupantsWeightKg: 500 });
  assert.equal(negative.status, "AVAILABLE");
  if (negative.status === "AVAILABLE") assert.ok(negative.marginKg < 0);
  const nearZero = calculateOfficialLoad({ ...input, occupantsWeightKg: 410 });
  assert.equal(nearZero.status, "AVAILABLE");
  if (nearZero.status === "AVAILABLE") assert.equal(displayLoadMarginKg(nearZero.marginKg), 0);
  const heavier = calculateOfficialLoad({ ...input, occupantsWeightKg: reference.occupantsWeightKg + 12 });
  assert.equal(heavier.status, "AVAILABLE");
  if (heavier.status === "AVAILABLE") assert.ok(Math.abs(heavier.marginKg - (reference.expectedMarginKg + 0.3448292881172 - 12)) < 1e-9);
});

test("la proposition MTOM catalogue ne concerne que le jeu de paramètres Cameron Z105", () => {
  assert.equal(proposedApplicableMtowKg("Cameron", "Z105"), 952);
  assert.equal(proposedApplicableMtowKg(" cameron ", "Z-105"), 952);
  assert.equal(proposedApplicableMtowKg("Cameron", "Z350"), null);
  assert.equal(proposedApplicableMtowKg("Ultramagic", "Z105"), null);
  assert.deepEqual(resolveApplicableMtowSuggestion(undefined, "Cameron", "Z105"), { valueKg: 952, proposed: true });
  assert.deepEqual(resolveApplicableMtowSuggestion(940, "Cameron", "Z105"), { valueKg: 940, proposed: false });
});

test("le catalogue MTOM distingue une valeur unique des limites multiples", () => {
  const z105 = applicableMtomCatalogEntry("Cameron", "Z105");
  const z90 = applicableMtomCatalogEntry("Cameron", "Z90");
  const kubicek = applicableMtomCatalogEntry("Kubíček", "BB30Z");
  const ultramagic = applicableMtomCatalogEntry("Ultramagic", "M105");
  assert.deepEqual(z105?.options.map(({ mtomKg }) => mtomKg), [952]);
  assert.deepEqual(z90?.options.map(({ mtomKg }) => mtomKg), [816, 499]);
  assert.equal(kubicek?.aircraftSpecificReducedLimitPossible, true);
  assert.deepEqual(ultramagic?.options.map(({ mtomKg }) => mtomKg), [1_032, 998]);
  assert.equal(proposedApplicableMtowKg("Cameron", "Z90"), null);
  assert.equal(proposedApplicableMtowKg("Kubíček", "BB30Z"), null);
  assert.equal(proposedApplicableMtowKg("Ultramagic", "M105"), null);
});

test("chaque limite du catalogue MTOM reste traçable vers un manuel officiel", () => {
  for (const entry of applicableMtomCatalog) {
    assert.ok(entry.options.length > 0);
    for (const option of entry.options) {
      assert.equal(option.verificationStatus, "VERIFIED_FROM_OFFICIAL_MANUAL");
      assert.ok(option.sourceDocument.length > 0);
      assert.ok(option.manualRevision.length > 0);
      assert.ok(option.sourcePage.length > 0);
      assert.ok(option.mtomKg > 0);
    }
  }
});

test("une MTOM saisie par le pilote n'est jamais remplacée par le catalogue", () => {
  assert.deepEqual(resolveApplicableMtowSuggestion(940, "Cameron", "Z105"), { valueKg: 940, proposed: false });
  assert.deepEqual(resolveApplicableMtowSuggestion(undefined, "Cameron", "Z90"), { valueKg: undefined, proposed: false });
  assert.equal(applicableMtomCatalogEntry("Cameron", "Z300"), null);
  assert.equal(applicableMtomCatalogEntry("Cameron", "Z425"), null);
});

test("deux Z105 de même configuration produisent exactement la même marge", () => {
  const reference = CAMERON_Z105_REFERENCE_001;
  const common = {
    manufacturer: "Cameron",
    model: "Z105",
    volumeM3: 2_973,
    applicableMtowKg: 952,
    configurationLimitsConfirmed: true,
    balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg,
    occupantsWeightKg: reference.occupantsWeightKg,
    launchElevationMslM: reference.launchElevationMslM,
    plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
    groundTemperature: { ...completeInput.groundTemperature, temperatureC: reference.groundTemperatureC },
  };
  const first = calculateOfficialLoad({ ...common, balloonId: "F-HLFM" });
  const second = calculateOfficialLoad({ ...common, balloonId: "F-TEST" });
  assert.equal(first.status, "AVAILABLE");
  assert.equal(second.status, "AVAILABLE");
  if (first.status === "AVAILABLE" && second.status === "AVAILABLE") assert.equal(second.marginKg, first.marginKg);
});

test("une différence de masse équipée modifie la marge du Z105 du même nombre de kg", () => {
  const reference = CAMERON_Z105_REFERENCE_001;
  const common = {
    manufacturer: "Cameron",
    model: "Z105",
    volumeM3: 2_973,
    applicableMtowKg: 952,
    configurationLimitsConfirmed: true,
    occupantsWeightKg: reference.occupantsWeightKg,
    launchElevationMslM: reference.launchElevationMslM,
    plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
    groundTemperature: { ...completeInput.groundTemperature, temperatureC: reference.groundTemperatureC },
  };
  const differenceKg = 18;
  const first = calculateOfficialLoad({ ...common, balloonId: "F-HLFM", balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg });
  const second = calculateOfficialLoad({ ...common, balloonId: "F-TEST", balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg + differenceKg });
  assert.equal(first.status, "AVAILABLE");
  assert.equal(second.status, "AVAILABLE");
  if (first.status === "AVAILABLE" && second.status === "AVAILABLE") assert.equal(second.marginKg, first.marginKg - differenceKg);
});
