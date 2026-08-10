import assert from "node:assert/strict";
import test from "node:test";
import { calculateManufacturerLoad } from "../manufacturerDispatcher.ts";
import { kubicekModelParameters } from "../modelParameters/kubicekModels.ts";

const plannedMaximumAltitudeMslM = 6000 * 0.3048;
const groundTemperature = {
  temperatureC: 17.8872,
  sourceModel: "KUBICEK_79_MODEL_VALIDATION",
  forecastRun: "TEST",
  validTime: "TEST",
};

function inputFor(modelParameters, overrides = {}) {
  return {
    manufacturer: "Kubíček",
    model: modelParameters.model,
    applicableMtowKg: modelParameters.standardMtomKg,
    balloonEquipmentWeightKg: 100,
    occupantsWeightKg: 100,
    launchElevationMslM: 0,
    plannedMaximumAltitudeMslM,
    groundTemperature,
    ...overrides,
  };
}

function assertFiniteCalculation(result) {
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === "number") assert.ok(Number.isFinite(value), `${key} doit être fini`);
  }
}

test("les 79 modèles Kubíček satisfont les invariants du moteur branché", () => {
  assert.equal(kubicekModelParameters.length, 79);
  const failures = [];

  for (const parameters of kubicekModelParameters) {
    try {
      assert.equal(parameters.verificationStatus, "CANDIDATE_PILOT_VALIDATION");
      const baseline = calculateManufacturerLoad("Kubíček", parameters.model, inputFor(parameters));
      assert.equal(baseline?.status, "AVAILABLE", "dispatcher Kubíček indisponible");
      assert.equal(baseline.calculationStatus, "CANDIDATE_PILOT_VALIDATION");
      assertFiniteCalculation(baseline);
      assert.ok(baseline.performanceLimitedMassKg > 0);
      assert.ok(baseline.permittedTotalMassKg <= parameters.standardMtomKg);

      const occupantsPlus10 = calculateManufacturerLoad(
        "Kubíček",
        parameters.model,
        inputFor(parameters, { occupantsWeightKg: 110 }),
      );
      const equipmentPlus10 = calculateManufacturerLoad(
        "Kubíček",
        parameters.model,
        inputFor(parameters, { balloonEquipmentWeightKg: 110 }),
      );
      assert.equal(occupantsPlus10?.status, "AVAILABLE");
      assert.equal(equipmentPlus10?.status, "AVAILABLE");
      assert.equal(occupantsPlus10.marginKg, baseline.marginKg - 10);
      assert.equal(equipmentPlus10.marginKg, baseline.marginKg - 10);

      const restrictiveMtowKg = Math.max(1, Math.min(parameters.standardMtomKg, baseline.performanceLimitedMassKg) - 1);
      const mtowLimited = calculateManufacturerLoad(
        "Kubíček",
        parameters.model,
        inputFor(parameters, { applicableMtowKg: restrictiveMtowKg }),
      );
      assert.equal(mtowLimited?.status, "AVAILABLE");
      assert.equal(mtowLimited.permittedTotalMassKg, restrictiveMtowKg);
      assert.equal(mtowLimited.limitingRule, "APPLICABLE_MTOW");

      const rmtowKg = Math.max(1, restrictiveMtowKg - 1);
      const rmtowLimited = calculateManufacturerLoad(
        "Kubíček",
        parameters.model,
        inputFor(parameters, { applicableMtowKg: rmtowKg }),
      );
      assert.equal(rmtowLimited?.status, "AVAILABLE");
      assert.equal(rmtowLimited.permittedTotalMassKg, rmtowKg);

      const outside = calculateManufacturerLoad(
        "Kubíček",
        parameters.model,
        inputFor(parameters, { plannedMaximumAltitudeMslM: 30_001 * 0.3048 }),
      );
      assert.deepEqual(outside, {
        status: "UNAVAILABLE",
        reasonCode: "CONDITIONS_OUTSIDE_METHOD_DOMAIN",
        message: "Altitude ou température hors du domaine officiel du Loading Chart Kubíček.",
      });
    } catch (error) {
      failures.push(`${parameters.model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
});
