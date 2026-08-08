import test from "node:test";
import assert from "node:assert/strict";
import { calculateCameronMethodA2Candidate } from "./officialCalculation.ts";
import { calculatePilotValidationLoad } from "../candidateEngine.ts";
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
