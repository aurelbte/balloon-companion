import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { describePreparationLoadEstimate, PREPARATION_LOAD_ESTIMATE_WARNING } from "./preparationLoadEstimate.ts";
import { buildLoadCalculationInput } from "./loadPerformance/balloonInput.ts";
import { resolveLoadGroundTemperature } from "./loadGroundTemperatureSelection.ts";
import { calculateOfficialLoad } from "./loadPerformance/engine.ts";
import { calculateManufacturerLoad } from "./loadPerformance/manufacturerDispatcher.ts";
import { ultramagicModelParameters } from "./loadPerformance/modelParameters/ultramagicModels.ts";
import { cameronModelParameters } from "./loadPerformance/modelParameters/cameronModels.ts";
import { findExactKubicekModel } from "./loadPerformance/modelParameters/kubicekModels.ts";
import { fm04Compatibility, fm04BasketDefault } from "./loadPerformance/ultramagic/fm04Rules.ts";

// Synthetic documentary inputs exercise the UI gates; never real aircraft evidence.
function umFixture(model='T150', takeoffKg=830) {
  const parameters=ultramagicModelParameters.find(row=>row.model===model);
  const row=fm04Compatibility(model);
  const basketType=row?.baskets[0] ?? 'C3';
  const burnerModel=row?.burners[0] ?? 'MK21DOUBLE';
  const fm04Evidence={
    balloonId:'SYNTHETIC-TEST-ONLY',model,manualRevision:'FM04_REVISION_30',
    buildStandard:{reference:'SYNTHETIC BUILD STANDARD',basketType,basketSerialNumber:'TEST-BASKET',burnerModel,maximumTakeoffMassKg:parameters.standardMtomKg,maximumLiftKg:parameters.standardMtomKg,otherEquipmentRequirementsVerified:true},
    masses:{reference:'SYNTHETIC COMPLETE WEIGHT LIST',complete:true,envelopeKg:40,emptyBasketKg:60,burnerKg:20,cylindersAndFuelKg:30,occupantsKg:takeoffKg-165,baggageKg:10,accessoriesKg:5,basketCarriedKg:takeoffKg-100},
    basketPlate:{reference:'SYNTHETIC PLATE',basketType,basketSerialNumber:'TEST-BASKET',maximumCarriedKg:fm04BasketDefault(basketType).kg},
    landing:{reference:'SYNTHETIC LANDING MASS',complete:true,totalMassKg:takeoffKg},
    supplements:{reference:'SYNTHETIC SUPPLEMENT REVIEW',applicabilityVerified:true,requirementsVerified:true},
  };
  const input={balloonId:fm04Evidence.balloonId,manufacturer:'Ultramagic',model,volumeM3:parameters.volumeM3,applicableMtowKg:parameters.standardMtomKg,configurationLimitsConfirmed:true,balloonEquipmentWeightKg:150,occupantsWeightKg:takeoffKg-165,launchElevationMslM:0,plannedMaximumAltitudeMslM:0,groundTemperature:{temperatureC:10,provider:'TEST',sourceModel:'TEST',forecastRun:'TEST',validTime:'2026-11-05T10:00:00Z'},fm04Evidence};
  return {input,parameters,e:fm04Evidence};
}

function kbFixture(model = "BB20") {
  const parameters = findExactKubicekModel(model);
  const componentIds = [model,"K10",500,"BASIC","TEST_FRAME","TEST_ONLY_BURNER","TEST_BURNER"];
  const review = (page) => ({ reference:"SYNTHETIC_REVIEW_ONLY", page, componentIds:[...componentIds], approved:true, conditionsSatisfied:true });
  return {
    balloonId:"TEST_ONLY", manufacturer:"Kubíček", model, volumeM3:parameters.volumeM3,
    applicableMtowKg:parameters.standardMtomKg, configurationLimitsConfirmed:true,
    balloonEquipmentWeightKg:300, occupantsWeightKg:150,
    launchElevationMslM:0, plannedMaximumAltitudeMslM:6000*0.3048,
    groundTemperature:{ temperatureC:17.8872, sourceModel:"TEST", forecastRun:"TEST", validTime:"TEST" },
    kubicekEvidence:{
      balloonId:"TEST_ONLY", model, manualRevision:"B3102_ED3_REV23",
      weightRecord:{ reference:"TEST_II", applicableMtowKg:parameters.standardMtomKg, minimumCrewAndEquipmentKg:300, reducedMtowCountersignedByKubicek:false },
      masses:{ reference:"TEST_MASSES", complete:true, fullCylindersVerified:true, envelopeKg:100, emptyBasketKg:70,
        burnerAndFrameKg:30, fullCylindersKg:80, otherEquipmentKg:20, occupantsKg:150, baggageKg:10,
        basketCarriedKg:250, carriageAllocationReference:"TEST_CARRIAGE" },
      flightMasses:{ reference:"TEST_FLIGHT_MASSES", complete:true, landingKg:380, minimumKg:380, maximumKg:460 },
      configuration:{ reference:"TEST_CONFIG", basketModel:"K10", basketSerialNumber:500, frameModel:"BASIC", frameSerialNumber:"TEST_FRAME",
        frameHasSnMark:true, burnerModel:"TEST_ONLY_BURNER", burnerSerialNumber:"TEST_BURNER",
        envelopeBasket:review("2-8"), envelopeBurner:review("2-11"), basketFrame:review("8-3"),
        envelopeTemperatureLimitsVerified:true, envelopeTemperatureLimitReference:"TEST_FABRIC_LIMIT",
        flyingWiresAndAirworthinessVerified:true, occupancyAndCylinderLayoutVerified:true, occupantCount:2, maximumSurfaceWindMs:3,
        basketPlate:{ reference:"TEST_PLATE", model:"K10", serialNumber:500, emptyWeightKg:70, maximumCarriedKg:600 } },
      supplements:{ reference:"TEST_SUPPLEMENT_REVIEW", applicability:"NONE_APPLICABLE", requirementsVerified:true },
      temperatureAssessment:{ reference:"TEST_TEMPERATURE_REVIEW", inversionReviewed:true, standardDecreaseApplicable:true },
    },
  };
}
const present = (input) => describePreparationLoadEstimate(input, calculateOfficialLoad(input));
function assertUnvalidated(result) {
  assert.equal(result.status, "NON_VALIDÉ");
  assert.equal(result.warning, "ESTIMATION NON VALIDÉE — ne pas utiliser pour déterminer la charge admissible");
  for (const field of ["marginKg", "permittedTotalMassKg", "availableOccupantsCapacityKg", "candidateMassCeilingKg", "manufacturerMtomCeilingKg", "calculationStatus"]) {
    assert.equal(field in result, false, field);
  }
}
function assertRefused(result) {
  assertUnvalidated(result);
  assert.equal(result.kind, "REFUSAL");
  assert.equal("values" in result, false);
  assert.ok(result.reason.length);
  assert.ok(result.reasonCodes.length);
}

test("Ultramagic: expose only existing theoretical lift values with units, no admissible ceiling", () => {
  const { input } = umFixture();
  const diagnostic = calculateManufacturerLoad(input.manufacturer, input.model, input);
  const preview = present(input);
  assertUnvalidated(preview);
  assert.equal(preview.kind, "VALUES");
  assert.deepEqual(preview.reasonCodes, ["METHOD_NOT_VALIDATED"]);
  assert.deepEqual(preview.values.map(({ value, unit }) => [value, unit]), [
    [diagnostic.theoretical.liftKgPer1000Ft3, "kg/1000 ft³"],
    [diagnostic.theoretical.performanceLimitedMassKg, "kg"],
  ]);
  assert.equal(calculateOfficialLoad(input).status, "UNAVAILABLE");
});

test("Kubicek: keep 16.539624 LU / 534.267968 kg unchanged; official load remains unavailable", () => {
  const input = kbFixture();
  const preview = present(input);
  assertUnvalidated(preview);
  assert.equal(preview.kind, "VALUES");
  assert.deepEqual(preview.reasonCodes, ["LU_METHOD_NOT_VALIDATED"]);
  assert.deepEqual(preview.values.map(({ value, unit }) => [value, unit]), [
    [16.539624, "LU"], [534.267968, "kg"],
  ]);
  assert.equal(calculateOfficialLoad(input).status, "UNAVAILABLE");
});

test("missing individual evidence permits only theoretical values while official load stays blocked", () => {
  const um = umFixture().input;
  const kb = kbFixture();
  for (const [input, key, fields] of [
    [um, "fm04Evidence", ["buildStandard", "masses", "basketPlate", "landing", "supplements"]],
    [kb, "kubicekEvidence", ["weightRecord", "configuration", "masses", "flightMasses", "supplements", "temperatureAssessment"]],
  ]) {
    for (const field of fields) {
      const changed = structuredClone(input); delete changed[key][field];
      const diagnostic = calculateManufacturerLoad(changed.manufacturer, changed.model, changed);
      assert.ok(diagnostic.theoretical, `${key}/${field}: direct diagnostics still exist`);
      const preview = present(changed);
      assertUnvalidated(preview);
      assert.equal(preview.kind, "VALUES");
      assert.ok(preview.admissibilityReasonCodes.length);
      assert.equal(preview.values.at(-1).value, diagnostic.theoretical.performanceLimitedMassKg);
      assert.equal(calculateOfficialLoad(changed).status, "UNAVAILABLE");
    }
    const none = structuredClone(input); delete none[key];
    assert.equal(present(none).kind, "VALUES");
    assert.equal(calculateOfficialLoad(none).status, "UNAVAILABLE");
    const wrong = structuredClone(input); wrong[key].balloonId = "ANOTHER_AIRCRAFT";
    assert.equal(present(wrong).kind, "VALUES");
    assert.equal(calculateOfficialLoad(wrong).status, "UNAVAILABLE");
    const wrongRevision = structuredClone(input); wrongRevision[key].manualRevision = "OTHER_REVISION";
    assert.equal(present(wrongRevision).kind, "VALUES");
    const unconfirmed = { ...input, configurationLimitsConfirmed: false };
    assert.equal(present(unconfirmed).kind, "VALUES");
    assert.equal(calculateOfficialLoad(unconfirmed).status, "UNAVAILABLE");
  }
});

test("real /map mapping uses stored masses, selected temperature and altitudes without inventing evidence", () => {
  for (const [manufacturer, model, volumeM3, applicableMtowKg] of [
    ["Ultramagic", "T150", 4245, 1465], ["Kubíček", "BB26", 2600, 840],
  ]) {
    const balloon = { id: "LOCAL_BALLOON", manufacturer, model, volumeM3, applicableMtowKg,
      configurationLimitsConfirmed: false,
      weights: { envelopeKg: 100, basketKg: 100, burnerKg: 100, fullCylinders: [] } };
    const temperature = resolveLoadGroundTemperature("manual", "15", null);
    const input = buildLoadCalculationInput({ balloon, occupantsWeightKg: 150,
      launchElevationMslM: 50, plannedMaximumAltitudeMslM: 1000, groundTemperature: temperature });
    const before = structuredClone(input);
    const preview = present(input);
    assertUnvalidated(preview);
    assert.equal(preview.kind, "VALUES");
    assert.equal(input.balloonEquipmentWeightKg, 300);
    assert.equal(input.groundTemperature.temperatureC, 15);
    assert.equal("fm04Evidence" in input, false);
    assert.equal("kubicekEvidence" in input, false);
    assert.ok(preview.admissibilityReasonCodes.length);
    assert.deepEqual(input, before);
    assert.equal(calculateOfficialLoad(input).status, "UNAVAILABLE");
    const missingMass = { ...balloon, weights: { ...balloon.weights, envelopeKg: undefined } };
    assertRefused(present(buildLoadCalculationInput({ balloon: missingMass, occupantsWeightKg: 150,
      launchElevationMslM: 50, plannedMaximumAltitudeMslM: 1000, groundTemperature: temperature })));
  }
});

test("missing numerical inputs, unknown models, volume and MTOW mismatches never leak values", () => {
  for (const input of [umFixture().input, kbFixture()]) {
    for (const changes of [
      { balloonId: undefined }, { model: "UNKNOWN" }, { volumeM3: input.volumeM3 + 100 },
      { applicableMtowKg: input.applicableMtowKg + 1 }, { applicableMtowKg: undefined },
      { balloonEquipmentWeightKg: undefined }, { occupantsWeightKg: undefined },
      { plannedMaximumAltitudeMslM: undefined }, { launchElevationMslM: undefined },
      { plannedMaximumAltitudeMslM: -1 }, { groundTemperature: undefined },
      { groundTemperature: { ...input.groundTemperature, temperatureC: NaN } },
    ]) assertRefused(present({ ...input, ...changes }));
  }
});

test("out-of-manual conditions refuse; no new formula or extrapolated estimate", () => {
  for (const input of [umFixture().input, kbFixture()]) {
    for (const changes of [
      { groundTemperature: { ...input.groundTemperature, temperatureC: 100 } },
      { plannedMaximumAltitudeMslM: 10000 },
    ]) assertRefused(present({ ...input, ...changes }));
  }
});

test("known individual configuration violations stay visible and cannot become admissible results", () => {
  const um = umFixture().input;
  um.fm04Evidence.basketPlate.maximumCarriedKg = 1;
  assert.equal(present(um).kind, "VALUES");
  assert.ok(present(um).admissibilityReasonCodes.includes("BASKET_LOAD_EXCEEDED"));
  assert.equal(calculateOfficialLoad(um).status, "UNAVAILABLE");
  const kb = kbFixture();
  kb.kubicekEvidence.flightMasses.minimumKg = 100;
  assert.equal(present(kb).kind, "VALUES");
  assert.ok(present(kb).admissibilityReasonCodes.includes("FLIGHT_BELOW_MLW"));
  assert.equal(calculateOfficialLoad(kb).status, "UNAVAILABLE");
  const tooHeavy = kbFixture();
  tooHeavy.kubicekEvidence.masses.occupantsKg = 500;
  tooHeavy.occupantsWeightKg = 500;
  assert.equal(present(tooHeavy).kind, "VALUES");
  assert.equal(calculateOfficialLoad(tooHeavy).status, "UNAVAILABLE");
});

test("Cameron consultation is untouched for every model, including production margins", () => {
  const withoutTime = ({ calculatedAt, ...result }) => result;
  for (const p of cameronModelParameters) {
    const input = { ...umFixture().input, manufacturer: p.manufacturer, model: p.model,
      volumeM3: p.volumeM3, applicableMtowKg: p.standardMtomKg };
    const before = calculateOfficialLoad(input);
    assert.equal(describePreparationLoadEstimate(input, before), null);
    assert.deepEqual(withoutTime(calculateOfficialLoad(input)), withoutTime(before));
  }
  assert.equal(describePreparationLoadEstimate({ manufacturer: "OTHER" }, { status: "UNAVAILABLE" }), null);
});

test("map exposes the warning next to values/refusal, and excludes estimates from admissible detail/margin branches", () => {
  const source = readFileSync(new URL("../map/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const loadEstimate = testLoadEnabled \? null : describePreparationLoadEstimate\(loadInput, loadResult\)/);
  assert.match(source, /const candidateLoadResult = !loadEstimate && loadResult.status === "AVAILABLE"/);
  assert.match(source, /const displayedMargin = !loadEstimate && loadResult.status === "AVAILABLE"/);
  const panel = source.slice(source.indexOf('{loadEstimate ? <div className="mt-3 text-sm">'), source.indexOf('</div> : <p className="mt-3 text-sm">'));
  assert.ok(panel.indexOf("{loadEstimate.warning}") < panel.indexOf('loadEstimate.kind === "VALUES"'));
  assert.match(panel, /Configuration et justificatifs individuels non validés/);
  assert.match(panel, /Estimation refusée : \{loadEstimate.reason\}/);
  assert.match(panel, /value.toLocaleString\("fr-FR".*\{unit\}/);
  assert.doesNotMatch(panel, /marginKg|permittedTotalMassKg|availableOccupantsCapacityKg|Charge disponible/);
  assert.equal(PREPARATION_LOAD_ESTIMATE_WARNING.includes("ne pas utiliser pour déterminer la charge admissible"), true);
});
