import assert from "node:assert/strict";
import test from "node:test";
import { calculateManufacturerLoad } from "../manufacturerDispatcher.ts";
import { kubicekModelParameters } from "../modelParameters/kubicekModels.ts";

const plannedMaximumAltitudeMslM = 6000 * 0.3048;
const groundTemperature = {
  temperatureC: 17.8872,
  sourceModel: "KUBICEK_MODEL_VALIDATION",
  forecastRun: "TEST",
  validTime: "TEST",
};

function inputFor(modelParameters, overrides = {}) {
  return {
    volumeM3: modelParameters.volumeM3,
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

test("les 82 modèles Kubíček satisfont les invariants du moteur branché", () => {
  assert.equal(kubicekModelParameters.length, 82);
  const failures = [];

  for (const parameters of kubicekModelParameters) {
    try {
      assert.equal(parameters.verificationStatus, "CANDIDATE_PILOT_VALIDATION");
      const baseline = calculateManufacturerLoad("Kubíček", parameters.model, inputFor(parameters));
      assert.equal(baseline?.status, "NON_VALIDÉ");
      assert.ok(baseline.reasons.includes("AIRCRAFT_EVIDENCE_UNVERIFIED"));
      assert.ok(baseline.reasons.includes("LU_METHOD_NOT_VALIDATED"));
      assert.equal("marginKg" in baseline, false);
      assert.equal("permittedTotalMassKg" in baseline, false);
      assertFiniteCalculation(baseline.theoretical);
      assert.ok(baseline.theoretical.performanceLimitedMassKg > 0);
      assert.ok(baseline.theoretical.candidateMassCeilingKg <= parameters.standardMtomKg);

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
      assert.equal(occupantsPlus10?.status, "NON_VALIDÉ");
      assert.equal(equipmentPlus10?.status, "NON_VALIDÉ");
      assert.equal(occupantsPlus10.theoretical.inputMassSumKg, baseline.theoretical.inputMassSumKg + 10);
      assert.equal(equipmentPlus10.theoretical.inputMassSumKg, baseline.theoretical.inputMassSumKg + 10);

      const restrictiveMtowKg = Math.max(1, Math.min(parameters.standardMtomKg, baseline.theoretical.performanceLimitedMassKg) - 1);
      const mtowLimited = calculateManufacturerLoad(
        "Kubíček",
        parameters.model,
        inputFor(parameters, { applicableMtowKg: restrictiveMtowKg }),
      );
      assert.equal(mtowLimited?.status, "NON_VALIDÉ");
      assert.equal(mtowLimited.theoretical.candidateMassCeilingKg, restrictiveMtowKg);
      assert.ok(mtowLimited.reasons.includes("RMTOW_UNVERIFIED"));

      const rmtowKg = Math.max(1, restrictiveMtowKg - 1);
      const rmtowLimited = calculateManufacturerLoad(
        "Kubíček",
        parameters.model,
        inputFor(parameters, { applicableMtowKg: rmtowKg }),
      );
      assert.equal(rmtowLimited?.status, "NON_VALIDÉ");
      assert.equal(rmtowLimited.theoretical.candidateMassCeilingKg, rmtowKg);
      assert.ok(rmtowLimited.reasons.includes("RMTOW_UNVERIFIED"));

      const outside = calculateManufacturerLoad(
        "Kubíček",
        parameters.model,
        inputFor(parameters, { plannedMaximumAltitudeMslM: 30_001 * 0.3048 }),
      );
      assert.deepEqual(outside, {
        status: "UNAVAILABLE",
        reasonCode: "OUTSIDE_OFFICIAL_TABLE",
        message: "Altitude ou température hors du domaine officiel du Loading Chart Kubíček.",
      });
    } catch (error) {
      failures.push(`${parameters.model}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
});
