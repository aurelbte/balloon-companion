import test from "node:test";
import assert from "node:assert/strict";
import { calculateCameronMethodA2Candidate } from "./officialCalculation.ts";
import { calculatePilotValidationLoad } from "../candidateEngine.ts";
import { calculateOfficialLoad } from "../engine.ts";
import { cameronModelParameters, resolveCameronModelParameters } from "../modelParameters/cameronModels.ts";
import { CAMERON_Z105_REFERENCE_001 } from "../referenceCases/cameronZ105References.ts";

function syntheticInput(parameters) {
  return {
    balloonId: `SYNTHETIC_TEST_${parameters.id}`,
    manufacturer: "Cameron",
    model: parameters.model,
    volumeM3: parameters.volumeM3,
    applicableMtowKg: parameters.standardMtomKg,
    balloonEquipmentWeightKg: 400,
    occupantsWeightKg: 200,
    launchElevationMslM: 0,
    plannedMaximumAltitudeMslM: 0,
    groundTemperature: {
      temperatureC: 0,
      sourceModel: "SYNTHETIC_TEST_ONLY",
      forecastRun: "2026-08-08T00:00:00.000Z",
      validTime: "2026-08-08T00:00:00.000Z",
    },
  };
}

for (const parameters of cameronModelParameters) {
  test(`${parameters.model} respecte les invariants du moteur commun Cameron A2`, () => {
    const input = syntheticInput(parameters);
    const baseline = calculateCameronMethodA2Candidate(input, parameters);
    assert.ok(baseline);
    assert.equal(baseline.limitingRule, "APPLICABLE_MTOW");
    assert.equal(baseline.permittedTotalMassKg, parameters.standardMtomKg);
    assert.ok(baseline.permittedTotalMassKg <= parameters.standardMtomKg);
    assert.ok(Object.values(baseline).filter((value) => typeof value === "number").every(Number.isFinite));
    assert.equal("datasetId" in baseline, false);
    assert.equal(calculateCameronMethodA2Candidate({ ...input, volumeM3: input.volumeM3 + 1 }, parameters), null);

    const massDeltaKg = 10;
    const heavierEquipment = calculateCameronMethodA2Candidate({
      ...input,
      balloonEquipmentWeightKg: input.balloonEquipmentWeightKg + massDeltaKg,
    }, parameters);
    const heavierOccupants = calculateCameronMethodA2Candidate({
      ...input,
      occupantsWeightKg: input.occupantsWeightKg + massDeltaKg,
    }, parameters);
    assert.ok(heavierEquipment);
    assert.ok(heavierOccupants);
    assert.equal(heavierEquipment.marginKg, baseline.marginKg - massDeltaKg);
    assert.equal(heavierOccupants.marginKg, baseline.marginKg - massDeltaKg);

    if (parameters.reducedMtomKg !== undefined) {
      const reduced = calculateCameronMethodA2Candidate({
        ...input,
        applicableMtowKg: parameters.reducedMtomKg,
      }, parameters);
      assert.ok(reduced);
      assert.equal(reduced.permittedTotalMassKg, parameters.reducedMtomKg);
      assert.ok(reduced.permittedTotalMassKg <= parameters.standardMtomKg);
    }
  });
}

test("CAMERON_Z105_REFERENCE_001 reste exactement à +80 kg", () => {
  const reference = CAMERON_Z105_REFERENCE_001;
  const parameters = resolveCameronModelParameters(reference.model);
  assert.ok(parameters);
  const result = calculateCameronMethodA2Candidate({
    balloonId: reference.id,
    manufacturer: reference.manufacturer,
    model: reference.model,
    volumeM3: reference.volumeM3,
    applicableMtowKg: reference.applicableMtowKg,
    balloonEquipmentWeightKg: reference.balloonEquipmentWeightKg,
    occupantsWeightKg: reference.occupantsWeightKg,
    launchElevationMslM: reference.launchElevationMslM,
    plannedMaximumAltitudeMslM: reference.plannedMaximumAltitudeMslM,
    groundTemperature: {
      temperatureC: reference.groundTemperatureC,
      sourceModel: "REFERENCE",
      forecastRun: reference.verifiedAt,
      validTime: reference.verifiedAt,
    },
  }, parameters);
  assert.ok(result);
  assert.equal(Math.floor(result.marginKg), 80);
});

test("un modèle candidat passe par A2 sans DEMO et exige les limites du ballon réel", () => {
  const parameters = resolveCameronModelParameters("Z-120");
  assert.ok(parameters);
  const input = syntheticInput(parameters);
  const unconfirmed = calculatePilotValidationLoad({ ...input, configurationLimitsConfirmed: false });
  assert.equal(unconfirmed.status, "UNAVAILABLE");
  assert.equal(unconfirmed.reasonCode, "CONFIGURATION_LIMITS_UNCONFIRMED");

  const candidate = calculatePilotValidationLoad({ ...input, configurationLimitsConfirmed: true });
  assert.equal(candidate.status, "AVAILABLE");
  assert.equal(candidate.modelParameterSetId, parameters.id);
  assert.equal(candidate.calculationStatus, "CANDIDATE_PILOT_VALIDATION");
  assert.ok(!candidate.datasetId.includes("DEMO"));
  assert.equal("calculationMode" in candidate, false);
});

test("une désignation ambiguë ne produit aucun kilogramme candidat", () => {
  const parameters = resolveCameronModelParameters("Z-425LW");
  assert.ok(parameters);
  const result = calculatePilotValidationLoad({
    ...syntheticInput(parameters),
    model: "Z425",
    configurationLimitsConfirmed: true,
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(result.reasonCode, "UNSUPPORTED_MODEL");
  assert.equal("marginKg" in result, false);
});


test("Z-275 : données Table 2 et alias exacts, sans doublon ni changement de méthode", () => {
  const p = resolveCameronModelParameters("Z-275");
  assert.ok(p);
  assert.equal(resolveCameronModelParameters("Z275"), p);
  assert.equal(resolveCameronModelParameters("z 275"), p);
  assert.equal(resolveCameronModelParameters("Z-275LW"), null);
  assert.equal(cameronModelParameters.filter(({ model }) => model === "Z-275").length, 1);
  assert.equal(p.manufacturerMethodId, "CAMERON_METHOD_A2");
  assert.equal(p.volumeCuFt, 275_000);
  assert.equal(p.volumeM3, 7_788); // Use the manual's metric value, never rederive it from ft³.
  assert.equal(p.standardMtomKg, 2_494);
  assert.equal(p.reducedMtomKg, 1_999);
  assert.equal(p.standardMlmKg, 1_247); // Documentary only, no new landing-mass guard in A2.
  assert.equal(p.source.manualRevision, "ISSUE_10_AMENDMENT_18");
  assert.ok(p.source.pages.includes("2-7"));
  assert.equal(p.verificationStatus, "CANDIDATE_PILOT_VALIDATION");
});

test("Z-275 : CHARGE réutilise A2, MTOM applicable explicite et contrôles Cameron inchangés", () => {
  const p = resolveCameronModelParameters("Z-275");
  const input = { ...syntheticInput(p), model: "Z275", balloonEquipmentWeightKg: 800,
    occupantsWeightKg: 500, configurationLimitsConfirmed: true };
  const direct = calculateCameronMethodA2Candidate(input, p);
  assert.ok(direct);
  const standard = calculateOfficialLoad(input);
  assert.equal(standard.status, "AVAILABLE");
  assert.equal(standard.calculationStatus, "CANDIDATE_PILOT_VALIDATION");
  assert.equal(standard.modelParameterSetId, p.id);
  assert.equal(standard.manufacturerMethodId, "CAMERON_METHOD_A2");
  assert.equal(standard.performanceLimitedMassKg, direct.performanceLimitedMassKg);
  assert.equal(standard.permittedTotalMassKg, 2_494);
  assert.equal(standard.marginKg, 1_194);
  const reduced = calculateOfficialLoad({ ...input, applicableMtowKg: 1_999 });
  assert.equal(reduced.status, "AVAILABLE");
  assert.equal(reduced.permittedTotalMassKg, 1_999);
  assert.equal(reduced.marginKg, 699);
  assert.equal(reduced.performanceLimitedMassKg, standard.performanceLimitedMassKg);
  const noConfirmation = calculateOfficialLoad({ ...input, configurationLimitsConfirmed: false });
  assert.equal(noConfirmation.status, "UNAVAILABLE");
  assert.equal(noConfirmation.reasonCode, "CONFIGURATION_LIMITS_UNCONFIRMED");
  const noMtom = calculateOfficialLoad({ ...input, applicableMtowKg: undefined });
  assert.equal(noMtom.status, "UNAVAILABLE");
  assert.equal(noMtom.reasonCode, "MISSING_MTOW"); // Never choose standard/reduced implicitly.
  const wrongVolume = calculateOfficialLoad({ ...input, volumeM3: 7_790 });
  assert.equal(wrongVolume.status, "UNAVAILABLE");
  assert.equal(wrongVolume.reasonCode, "VOLUME_MISMATCH");
  const wrongAltitude = calculateOfficialLoad({ ...input, plannedMaximumAltitudeMslM: -1 });
  assert.equal(wrongAltitude.status, "UNAVAILABLE");
  assert.equal(wrongAltitude.reasonCode, "OUTSIDE_OFFICIAL_TABLE");
});
