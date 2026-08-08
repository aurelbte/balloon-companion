import test from "node:test";
import assert from "node:assert/strict";
import { calculateManufacturerLoad } from "../manufacturerDispatcher.ts";
import { ultramagicModelParameters } from "../modelParameters/ultramagicModels.ts";
import { calculateUltramagicLoadCandidate } from "./officialCalculation.ts";

const parameters = ultramagicModelParameters.find(({ model }) => model === "H65");
assert.ok(parameters);
const input = {
  balloonId: "ULTRAMAGIC_CANDIDATE_TEST",
  manufacturer: "Ultramagic",
  model: "H65",
  volumeM3: 999_999,
  applicableMtowKg: parameters.standardMtomKg,
  balloonEquipmentWeightKg: 200,
  occupantsWeightKg: 100,
  launchElevationMslM: 300,
  plannedMaximumAltitudeMslM: 3_000,
  groundTemperature: {
    temperatureC: 20,
    sourceModel: "TEST_ONLY",
    forecastRun: "2026-08-08T00:00:00.000Z",
    validTime: "2026-08-08T00:00:00.000Z",
  },
};

test("H-65 à 20 °C utilise le volume officiel et reproduit la portance FM04", () => {
  const result = calculateUltramagicLoadCandidate(input, parameters);
  assert.ok(result);
  assert.ok(Math.abs(result.liftKgPer1000Ft3 - 6.55) <= 0.02);
  assert.ok(Math.abs(result.performanceLimitedMassKg - 426) <= 1);
  assert.equal(result.limitingRule, "ULTRAMAGIC_LIFT");
});

test("H-65 à 10 °C reproduit le second exemple FM04", () => {
  const result = calculateUltramagicLoadCandidate({
    ...input,
    groundTemperature: { ...input.groundTemperature, temperatureC: 10 },
  }, parameters);
  assert.ok(result);
  assert.ok(Math.abs(result.performanceLimitedMassKg - 488) <= 1);
});

test("MTOM, masses et marge respectent les invariants sans arrondi", () => {
  const mtomKg = 400;
  const baseline = calculateUltramagicLoadCandidate({ ...input, applicableMtowKg: mtomKg }, parameters);
  assert.ok(baseline);
  assert.equal(baseline.permittedTotalMassKg, mtomKg);
  assert.equal(baseline.limitingRule, "APPLICABLE_MTOW");
  assert.equal(baseline.marginKg, baseline.availableOccupantsCapacityKg - input.occupantsWeightKg);

  const occupants = calculateUltramagicLoadCandidate({
    ...input,
    applicableMtowKg: mtomKg,
    occupantsWeightKg: input.occupantsWeightKg + 10,
  }, parameters);
  const equipment = calculateUltramagicLoadCandidate({
    ...input,
    applicableMtowKg: mtomKg,
    balloonEquipmentWeightKg: input.balloonEquipmentWeightKg + 10,
  }, parameters);
  assert.ok(occupants);
  assert.ok(equipment);
  assert.equal(occupants.marginKg, baseline.marginKg - 10);
  assert.equal(equipment.marginKg, baseline.marginKg - 10);
});

test("le dispatcher expose un candidat confirmé sans fallback Cameron/DEMO", () => {
  const dispatched = calculateManufacturerLoad("Ultramagic", "H65", {
    ...input,
    volumeM3: parameters.volumeM3,
    configurationLimitsConfirmed: true,
  });
  assert.equal(dispatched.status, "AVAILABLE");
  assert.equal(dispatched.calculationStatus, "CANDIDATE_PILOT_VALIDATION");
  assert.ok(Number.isFinite(dispatched.marginKg));
  assert.ok(!dispatched.datasetId.includes("DEMO"));
  assert.equal(dispatched.manufacturerMethodId, parameters.manufacturerMethodId);
  assert.equal("calculationMode" in dispatched, false);
});

test("un modèle sans confirmation réelle ne produit aucun kilogramme", () => {
  const dispatched = calculateManufacturerLoad("Ultramagic", "H65", {
    ...input,
    volumeM3: parameters.volumeM3,
    configurationLimitsConfirmed: false,
  });
  assert.equal(dispatched.status, "UNAVAILABLE");
  assert.equal(dispatched.reasonCode, "CONFIGURATION_LIMITS_UNCONFIRMED");
  assert.equal("marginKg" in dispatched, false);
});

for (const modelParameters of ultramagicModelParameters) {
  test(`${modelParameters.model} respecte les invariants du moteur commun FM04`, () => {
    assert.equal(modelParameters.verificationStatus, "CANDIDATE_PILOT_VALIDATION");
    const modelInput = {
      ...input,
      model: modelParameters.model,
      volumeM3: 999_999,
      applicableMtowKg: modelParameters.standardMtomKg,
      launchElevationMslM: 0,
      plannedMaximumAltitudeMslM: 0,
      groundTemperature: { ...input.groundTemperature, temperatureC: 0 },
    };
    const baseline = calculateUltramagicLoadCandidate(modelInput, modelParameters);
    const otherFreeVolume = calculateUltramagicLoadCandidate({
      ...modelInput,
      volumeM3: 1,
    }, modelParameters);
    assert.ok(baseline);
    assert.deepEqual(otherFreeVolume, baseline);
    assert.ok(Object.values(baseline).filter((value) => typeof value === "number").every(Number.isFinite));
    assert.ok(baseline.permittedTotalMassKg <= modelParameters.standardMtomKg);
    assert.equal("datasetId" in baseline, false);
    assert.equal("calculationMode" in baseline, false);

    const occupants = calculateUltramagicLoadCandidate({
      ...modelInput,
      occupantsWeightKg: modelInput.occupantsWeightKg + 10,
    }, modelParameters);
    const equipment = calculateUltramagicLoadCandidate({
      ...modelInput,
      balloonEquipmentWeightKg: modelInput.balloonEquipmentWeightKg + 10,
    }, modelParameters);
    assert.ok(occupants);
    assert.ok(equipment);
    assert.equal(occupants.marginKg, baseline.marginKg - 10);
    assert.equal(equipment.marginKg, baseline.marginKg - 10);

    if (modelParameters.reducedMtomKg !== undefined) {
      const reduced = calculateUltramagicLoadCandidate({
        ...modelInput,
        applicableMtowKg: modelParameters.reducedMtomKg,
      }, modelParameters);
      assert.ok(reduced);
      assert.equal(reduced.permittedTotalMassKg, modelParameters.reducedMtomKg);
      assert.equal(reduced.limitingRule, "APPLICABLE_MTOW");
    }
  });
}
