import test from "node:test";
import assert from "node:assert/strict";
import { calculateCameronMethodA2Candidate } from "./cameron/officialCalculation.ts";
import { calculateManufacturerLoad } from "./manufacturerDispatcher.ts";
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

test("les autres constructeurs conservent strictement leur comportement", () => {
  assert.deepEqual(calculateManufacturerLoad("Ultramagic", "H65", { ...inputs, volumeM3: 1_840 }), {
    status: "UNAVAILABLE",
    reasonCode: "CONFIGURATION_LIMITS_UNCONFIRMED",
    message: "Confirmez les limites du ballon dans sa fiche.",
  });
  assert.deepEqual(calculateManufacturerLoad("Inconnu", "X", inputs), {
    status: "UNSUPPORTED_MANUFACTURER",
    manufacturer: "Inconnu",
  });
});
