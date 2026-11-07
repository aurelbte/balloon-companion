import assert from "node:assert/strict";
import test from "node:test";
import { evaluateKubicekEvidence, kubicekMinimumLandingMassKg } from "./validation.ts";
import { calculateKubicekLoadCandidate, calculateKubicekMassFromLiftUnits } from "./officialCalculation.ts";
import { findExactKubicekModel, kubicekModelParameters } from "../modelParameters/kubicekModels.ts";
import { calculateManufacturerLoad } from "../manufacturerDispatcher.ts";

// Synthetic evidence exercises plumbing only; not an approved aircraft configuration.
function fixture(model = "BB20") {
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
      balloonId:"TEST_ONLY", model, manualRevision:"B3102_ED3_REV22",
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
const codes = (input) => evaluateKubicekEvidence(input).blocks.map(({code}) => code);
const result = (input) => calculateKubicekLoadCandidate(input, findExactKubicekModel(input.model));

test("preuves complètes synthétiques : pas d'activation ni marge et bagages inclus", () => {
  const input = fixture();
  assert.deepEqual(codes(input), []);
  const calculated = result(input);
  assert.equal(calculated.status,"NON_VALIDÉ");
  assert.deepEqual(calculated.reasons,["LU_METHOD_NOT_VALIDATED"]);
  assert.equal(calculated.theoretical.performanceLimitedMassKg,534.267968);
  assert.equal(calculated.theoretical.documentedTakeoffMassKg,460);
  for (const key of ["marginKg","permittedTotalMassKg","availableOccupantsCapacityKg"]) assert.equal(key in calculated,false);
});

test("chaque preuve absente bloque avec source explicite", () => {
  for (const [key,code] of [["weightRecord","WEIGHT_RECORD_UNVERIFIED"],["masses","COMPLETE_MASSES_UNVERIFIED"],
    ["flightMasses","FLIGHT_AND_LANDING_MASSES_UNVERIFIED"],["configuration","CONFIGURATION_UNVERIFIED"],
    ["supplements","SUPPLEMENTS_UNVERIFIED"],["temperatureAssessment","TEMPERATURE_ASSUMPTION_UNVERIFIED"]]) {
    const input=fixture(); delete input.kubicekEvidence[key];
    const calculated=result(input);
    assert.ok(calculated.reasons.includes(code),key);
    assert.ok(calculated.blocks.find((b)=>b.code===code).source);
    assert.equal("marginKg" in calculated,false);
  }
});

test("preuves et revues liées à l'identité exacte, pas au seul checkbox", () => {
  for (const [key,value] of [["balloonId","OTHER"],["model","BB20E"],["manualRevision","B3102_ED3_REV19"]]) {
    const input=fixture(); input.kubicekEvidence[key]=value;
    assert.ok(codes(input).includes("AIRCRAFT_EVIDENCE_UNVERIFIED"));
  }
  const input=fixture(); input.kubicekEvidence.configuration.burnerSerialNumber="OTHER";
  assert.ok(codes(input).includes("ENVELOPE_BURNER_UNVERIFIED"));
  assert.ok(codes(input).includes("ENVELOPE_BASKET_UNVERIFIED"));
  input.kubicekEvidence.configuration.envelopeBurner.approved=false;
  assert.ok(codes(input).includes("ENVELOPE_BURNER_UNVERIFIED"));
});

test("MTOW invalide/supérieure et RMTOW sans accord ou sous plancher refusées", () => {
  for (const mtow of [NaN,Infinity,0,-1,631]) {
    const input=fixture(); input.applicableMtowKg=mtow;
    assert.ok(codes(input).includes("MTOW_INVALID"));
    assert.equal(calculateKubicekMassFromLiftUnits(input,findExactKubicekModel("BB20"),16.5),null);
  }
  const input=fixture(); input.applicableMtowKg=520; input.kubicekEvidence.weightRecord.applicableMtowKg=520;
  assert.ok(codes(input).includes("RMTOW_UNVERIFIED"));
  input.kubicekEvidence.weightRecord.reducedMtowCountersignedByKubicek=true;
  assert.ok(!codes(input).includes("RMTOW_UNVERIFIED"));
  input.applicableMtowKg=346; input.kubicekEvidence.weightRecord.applicableMtowKg=346;
  assert.ok(codes(input).includes("RMTOW_UNVERIFIED"));
  input.applicableMtowKg=400; input.kubicekEvidence.weightRecord.applicableMtowKg=400;
  input.kubicekEvidence.weightRecord.minimumCrewAndEquipmentKg=401;
  assert.ok(codes(input).includes("RMTOW_UNVERIFIED"));
  assert.ok(codes(input).includes("TAKEOFF_EXCEEDS_MTOW"));
});

test("cohérence modèle, volume et paramètres ; aucun alias proche", () => {
  for (const volume of [undefined,NaN,1999,2001]) {
    const input=fixture(); input.volumeM3=volume;
    assert.ok(codes(input).includes("VOLUME_MISMATCH"));
    assert.equal(result(input).theoretical,undefined);
  }
  const input=fixture();
  assert.ok(calculateKubicekLoadCandidate(input,findExactKubicekModel("BB20E")).reasons.includes("MODEL_PARAMETERS_MISMATCH"));
  assert.ok(calculateManufacturerLoad("Kubíček","BB20",{...input,model:"BB20E"}).reasons.includes("MODEL_PARAMETERS_MISMATCH"));
});

test("MLW couvre les 80 modèles ; décollage, atterrissage et tout le vol", () => {
  for (const p of kubicekModelParameters) assert.ok(kubicekMinimumLandingMassKg(p.model)>0,p.model);
  assert.equal(kubicekMinimumLandingMassKg("BB74Z"),1130);
  assert.equal(kubicekMinimumLandingMassKg("BB74"),undefined);
  const input=fixture(); input.kubicekEvidence.flightMasses.landingKg=279; input.kubicekEvidence.flightMasses.minimumKg=279;
  assert.ok(codes(input).includes("FLIGHT_BELOW_MLW"));
  input.kubicekEvidence.flightMasses.landingKg=280; input.kubicekEvidence.flightMasses.minimumKg=280;
  assert.ok(!codes(input).includes("FLIGHT_BELOW_MLW"));
  delete input.kubicekEvidence.flightMasses.landingKg;
  assert.ok(codes(input).includes("FLIGHT_AND_LANDING_MASSES_UNVERIFIED"));
  const small=fixture(); small.balloonEquipmentWeightKg=100; small.occupantsWeightKg=100;
  Object.assign(small.kubicekEvidence.masses,{envelopeKg:30,emptyBasketKg:20,burnerAndFrameKg:10,fullCylindersKg:20,otherEquipmentKg:20,occupantsKg:100,baggageKg:0,basketCarriedKg:130});
  small.kubicekEvidence.configuration.basketPlate.emptyWeightKg=20;
  assert.ok(codes(small).includes("TAKEOFF_BELOW_MLW"));
});

test("nacelle : charge transportée hors tare, plaque et limites documentaires cumulées", () => {
  const input=fixture(); input.kubicekEvidence.configuration.basketPlate.maximumCarriedKg=250;
  assert.ok(!codes(input).includes("BASKET_OVERLOADED")); // 460 kg TOM != 250 kg carried.
  input.kubicekEvidence.configuration.basketPlate.maximumCarriedKg=249;
  assert.ok(codes(input).includes("BASKET_OVERLOADED"));
  delete input.kubicekEvidence.configuration.basketPlate.maximumCarriedKg;
  assert.ok(!codes(input).includes("BASKET_PLATE_UNVERIFIED")); // No invented mandatory plate load limit.
  input.kubicekEvidence.configuration.basketPlate.serialNumber=501;
  assert.ok(codes(input).includes("BASKET_PLATE_UNVERIFIED"));
  input.kubicekEvidence.configuration.basketSerialNumber=399;
  assert.ok(codes(input).includes("BASKET_LIMITS_UNVERIFIED"));
  const overload=fixture(); overload.kubicekEvidence.masses.occupantsKg=650; overload.occupantsWeightKg=650;
  overload.kubicekEvidence.masses.basketCarriedKg=700;
  overload.kubicekEvidence.configuration.basketPlate.maximumCarriedKg=1000;
  assert.ok(codes(overload).includes("BASKET_OVERLOADED"));
});

test("cadres : limite de volume selon vent et condition K50 S/N Rev.22", () => {
  const input=fixture("BB74Z"); const c=input.kubicekEvidence.configuration;
  c.frameModel="K50"; c.frameHasSnMark=false;
  assert.ok(codes(input).includes("FRAME_SN_MARK_REQUIRED"));
  c.frameHasSnMark=true;
  assert.ok(!codes(input).includes("FRAME_VOLUME_EXCEEDED"));
  const large=fixture("BB92Z"); large.kubicekEvidence.configuration.frameModel="K50";
  large.kubicekEvidence.configuration.maximumSurfaceWindMs=5.5;
  assert.ok(!codes(large).includes("FRAME_VOLUME_EXCEEDED"));
  large.kubicekEvidence.configuration.maximumSurfaceWindMs=5.5001;
  assert.ok(codes(large).includes("FRAME_VOLUME_EXCEEDED"));
  large.kubicekEvidence.configuration.frameModel="UNKNOWN";
  assert.ok(codes(large).includes("FRAME_LIMITS_UNVERIFIED"));
});

test("masses négatives/non finies/incomplètes et cylindres non pleins refusés", () => {
  for (const change of [{complete:false},{fullCylindersVerified:false},{envelopeKg:NaN},{fullCylindersKg:-1},{otherEquipmentKg:Infinity},{occupantsKg:149}]) {
    const input=fixture(); Object.assign(input.kubicekEvidence.masses,change);
    assert.ok(codes(input).includes("COMPLETE_MASSES_UNVERIFIED"));
  }
  const input=fixture(); input.kubicekEvidence.masses.basketCarriedKg=100;
  assert.ok(codes(input).includes("BASKET_CARRIED_MASS_UNVERIFIED"));
  input.kubicekEvidence.configuration.occupancyAndCylinderLayoutVerified=false;
  assert.ok(codes(input).includes("BASKET_OCCUPANCY_UNVERIFIED"));
  input.kubicekEvidence.temperatureAssessment.standardDecreaseApplicable=false;
  assert.ok(codes(input).includes("TEMPERATURE_ASSUMPTION_UNVERIFIED"));
});


test("Appendice 6 : seulement les modèles et nacelles explicitement visés", () => {
  for (const [model,limit] of [["BB60N",6],["BB60Z",6],["BB70Z",5.5]]) {
    const input=fixture(model); const c=input.kubicekEvidence.configuration;
    c.basketModel="K32T"; c.frameModel="K50"; c.frameHasSnMark=false;
    c.maximumSurfaceWindMs=limit;
    assert.ok(!codes(input).includes("APPENDIX_6_WIND_LIMIT"));
    c.maximumSurfaceWindMs=limit+0.01;
    assert.ok(codes(input).includes("APPENDIX_6_WIND_LIMIT"));
  }
  const input=fixture("BB60D"); const c=input.kubicekEvidence.configuration;
  c.basketModel="K32T"; c.frameModel="K50"; c.frameHasSnMark=false; c.maximumSurfaceWindMs=7;
  assert.ok(!codes(input).includes("APPENDIX_6_WIND_LIMIT"));
});

test("preuves invalides de charge, occupation, supplément et inversion n'exposent aucune marge", () => {
  const input=fixture();
  input.kubicekEvidence.supplements.requirementsVerified=false;
  input.kubicekEvidence.configuration.envelopeTemperatureLimitsVerified=false;
  input.kubicekEvidence.configuration.occupantCount=4;
  input.kubicekEvidence.flightMasses.maximumKg=700;
  const calculated=result(input);
  for (const code of ["SUPPLEMENTS_UNVERIFIED","ENVELOPE_TEMPERATURE_LIMIT_UNVERIFIED","BASKET_OCCUPANCY_UNVERIFIED","FLIGHT_EXCEEDS_MTOW","LIFT_EXCEEDED"]) assert.ok(calculated.reasons.includes(code),code);
  assert.equal("marginKg" in calculated,false);
});
