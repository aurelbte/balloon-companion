import test from "node:test";
import assert from "node:assert/strict";
import { calculateCameronMethodA2Candidate } from "./cameron/officialCalculation.ts";
import { calculateManufacturerLoad } from "./manufacturerDispatcher.ts";
import { ultramagicModelParameters } from "./modelParameters/ultramagicModels.ts";
import { resolveCameronModelParameters } from "./modelParameters/cameronModels.ts";

const parameters = resolveCameronModelParameters("Z-120");
assert.ok(parameters);
const inputs = {
  balloonId: "CAMERON_DISPATCH_TEST",
  manufacturer: "Cameron",
  model: "Z-120",
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

test("le dispatcher Cameron retourne strictement le calcul A2 existant", () => {
  const direct = calculateCameronMethodA2Candidate(inputs, parameters);
  const dispatched = calculateManufacturerLoad("Cameron", "Z-120", inputs);
  assert.deepEqual(dispatched, direct);
});

test("Ultramagic reste non validé et un constructeur inconnu reste rejeté", () => {
  const h65 = ultramagicModelParameters.find(({ model }) => model === "H65");
  const ultramagic = calculateManufacturerLoad("Ultramagic", "H65", { ...inputs, volumeM3: h65.volumeM3, applicableMtowKg: h65.standardMtomKg });
  assert.equal(ultramagic.status, "NON_VALIDÉ");
  assert.ok(ultramagic.reasons.includes("CONFIGURATION_LIMITS_UNCONFIRMED"));
  assert.ok(ultramagic.reasons.includes("APPLICABLE_SUPPLEMENTS_UNVERIFIED"));
  assert.equal("marginKg" in ultramagic, false);
  assert.deepEqual(calculateManufacturerLoad("Inconnu", "X", inputs), {
    status: "UNSUPPORTED_MANUFACTURER",
    manufacturer: "Inconnu",
  });
});
