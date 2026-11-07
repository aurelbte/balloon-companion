import test from "node:test";
import assert from "node:assert/strict";
import { calculateManufacturerLoad } from "../manufacturerDispatcher.ts";
import { calculateOfficialLoad } from "../engine.ts";
import { ultramagicModelParameters } from "../modelParameters/ultramagicModels.ts";
import { enabledPilotValidationLoadConfigurations, enabledOfficialLoadParameterCombinations } from "../modelParameters/activationRegistry.ts";
import { fm04MinimumTom } from "./fm04Rules.ts";
import { calculateUltramagicLoadCandidate } from "./officialCalculation.ts";

const parameters = ultramagicModelParameters.find(({ model }) => model === "H65");
const input = {
  balloonId: "ULTRAMAGIC_CANDIDATE_TEST", manufacturer: "Ultramagic", model: "H65",
  volumeM3: parameters.volumeM3, applicableMtowKg: parameters.standardMtomKg,
  balloonEquipmentWeightKg: 200, occupantsWeightKg: 100,
  launchElevationMslM: 300, plannedMaximumAltitudeMslM: 3_000,
  groundTemperature: { temperatureC: 20, sourceModel: "TEST_ONLY", forecastRun: "test", validTime: "2026-08-08T00:00:00.000Z" },
};
const noAdmissibleResult = result => {
  assert.equal(result.status, "NON_VALIDÉ");
  for (const key of ['marginKg', 'permittedTotalMassKg', 'availableOccupantsCapacityKg', 'calculationStatus']) assert.equal(key in result, false, key);
};
const missingEvidence = ["MINIMUM_TOM_UNVERIFIED", "BASKET_LIMIT_AND_COMPATIBILITY_UNVERIFIED", "COMPLETE_MASSES_UNVERIFIED", "APPLICABLE_SUPPLEMENTS_UNVERIFIED"];

for (const [temperatureC, expectedLift] of [[20, 426], [10, 488]]) {
  test(`H65 at ${temperatureC} C retains FM04 theoretical lift without approving the flight`, () => {
    const result = calculateUltramagicLoadCandidate({ ...input, groundTemperature: { ...input.groundTemperature, temperatureC } }, parameters);
    noAdmissibleResult(result);
    assert.equal(result.theoretical.performanceLimitedMassKg, temperatureC === 20 ? 426.2791848227497 : 487.67266152940033);
    assert.notEqual(result.theoretical.performanceLimitedMassKg, expectedLift);
    assert.ok(result.reasons.includes("METHOD_NOT_VALIDATED"));
    for (const reason of missingEvidence) assert.ok(result.reasons.includes(reason));
  });
}

test('MTOM above manufacturer ceiling is refused even when lift would already limit the mass', () => {
  const result = calculateUltramagicLoadCandidate({ ...input, applicableMtowKg: parameters.standardMtomKg + 1 }, parameters);
  noAdmissibleResult(result);
  assert.deepEqual(result.reasons, ['MTOM_EXCEEDS_MANUFACTURER_LIMIT']);
  assert.equal(result.theoretical, undefined);
});

test('no automatic reduced MTOM selection and no approval from a generic confirmation checkbox', () => {
  const nominal = calculateUltramagicLoadCandidate({ ...input, configurationLimitsConfirmed: true, launchElevationMslM: 0, plannedMaximumAltitudeMslM: 0, groundTemperature: { ...input.groundTemperature, temperatureC: -10 } }, parameters);
  noAdmissibleResult(nominal);
  assert.equal(nominal.theoretical.candidateMassCeilingKg, parameters.standardMtomKg);
  assert.ok(!nominal.reasons.includes('REDUCED_MTOM_DOCUMENTATION_UNVERIFIED'));
  const reduced = calculateUltramagicLoadCandidate({ ...input, applicableMtowKg: parameters.reducedMtomKg }, parameters);
  noAdmissibleResult(reduced);
  assert.ok(reduced.reasons.includes('REDUCED_MTOM_DOCUMENTATION_UNVERIFIED'));
  const absent = calculateUltramagicLoadCandidate({ ...input, applicableMtowKg: undefined }, parameters);
  noAdmissibleResult(absent); assert.equal(absent.theoretical, undefined);
});

for (const overrides of [{ occupantsWeightKg: undefined }, { balloonEquipmentWeightKg: NaN }, { groundTemperature: undefined }, { applicableMtowKg: -1 }]) {
  test(`incomplete or invalid input is explicit, not replaced: ${JSON.stringify(overrides)}`, () => {
    const result = calculateUltramagicLoadCandidate({ ...input, ...overrides }, parameters);
    noAdmissibleResult(result);
    assert.deepEqual(result.reasons, ['INVALID_OR_MISSING_INPUT']);
    assert.equal(result.theoretical, undefined);
  });
}

test('invalid model and altitude remain blocked', () => {
  assert.deepEqual(calculateUltramagicLoadCandidate({ ...input, model: 'T150' }, parameters).reasons, ['MODEL_MISMATCH']);
  assert.deepEqual(calculateUltramagicLoadCandidate({ ...input, plannedMaximumAltitudeMslM: 200 }, parameters).reasons, ['OUTSIDE_METHOD_DOMAIN']);
});

test('dispatcher propagates NON_VALIDÉ and never wraps the diagnostics in AVAILABLE', () => {
  for (const confirmation of [false, true]) {
    const result = calculateManufacturerLoad('Ultramagic', 'H65', { ...input, configurationLimitsConfirmed: confirmation });
    noAdmissibleResult(result);
    for (const reason of missingEvidence) assert.ok(result.reasons.includes(reason));
    assert.equal(result.reasons.includes('CONFIGURATION_LIMITS_UNCONFIRMED'), !confirmation);
  }
  const mismatch = calculateManufacturerLoad('Ultramagic', 'H65', { ...input, volumeM3: 999_999 });
  noAdmissibleResult(mismatch); assert.deepEqual(mismatch.reasons, ['VOLUME_MISMATCH']);
});

for (const modelParameters of ultramagicModelParameters) {
  test(`${modelParameters.model}: theoretical bookkeeping, missing proof and production non-activation`, () => {
    const modelInput = { ...input, model: modelParameters.model, volumeM3: modelParameters.volumeM3, applicableMtowKg: modelParameters.standardMtomKg, configurationLimitsConfirmed: true, launchElevationMslM: 0, plannedMaximumAltitudeMslM: 0, groundTemperature: { ...input.groundTemperature, temperatureC: 0 } };
    const baseline = calculateUltramagicLoadCandidate(modelInput, modelParameters);
    noAdmissibleResult(baseline);
    for (const reason of missingEvidence.filter(reason => reason !== "MINIMUM_TOM_UNVERIFIED")) assert.ok(baseline.reasons.includes(reason));
    assert.equal(baseline.reasons.includes("MINIMUM_TOM_UNVERIFIED"), fm04MinimumTom(modelParameters.model).state === "NOT_INDICATED");
    const minimum = fm04MinimumTom(modelParameters.model);
    assert.equal(baseline.reasons.includes("LANDING_MASS_UNVERIFIED"), minimum.state === "NUMERIC" && !!minimum.landingSource);
    assert.ok(Object.values(baseline.theoretical).every(Number.isFinite));
    assert.ok(baseline.theoretical.candidateMassCeilingKg <= modelParameters.standardMtomKg);
    assert.equal(baseline.theoretical.actualTotalMassKg, 300);
    const heavier = calculateUltramagicLoadCandidate({ ...modelInput, occupantsWeightKg: 110, balloonEquipmentWeightKg: 210 }, modelParameters);
    assert.equal(heavier.theoretical.actualTotalMassKg, 320);
    const reduced = calculateUltramagicLoadCandidate({ ...modelInput, applicableMtowKg: modelParameters.reducedMtomKg }, modelParameters);
    noAdmissibleResult(reduced);
    assert.ok(reduced.theoretical.candidateMassCeilingKg <= modelParameters.reducedMtomKg);
    assert.ok(reduced.reasons.includes('REDUCED_MTOM_DOCUMENTATION_UNVERIFIED'));
    const production = calculateOfficialLoad(modelInput);
    assert.equal(production.status, 'UNAVAILABLE'); assert.equal(production.reasonCode, 'PENDING_VERIFICATION');
    assert.match(production.message, /NON_VALIDÉ/);
    assert.equal('marginKg' in production, false);
    for (const registry of [enabledPilotValidationLoadConfigurations, enabledOfficialLoadParameterCombinations]) assert.ok(!registry.some(entry => entry.modelParameterSetId === modelParameters.id));
  });
}
