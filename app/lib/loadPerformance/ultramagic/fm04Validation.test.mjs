import test from 'node:test';
import assert from 'node:assert/strict';
import { ultramagicModelParameters } from '../modelParameters/ultramagicModels.ts';
import { calculateUltramagicLoadCandidate } from './officialCalculation.ts';
import { fm04Compatibility, fm04BasketDefault } from './fm04Rules.ts';

// Synthetic documentary inputs test the gates; they are not evidence for a real aircraft.
function fixture(model='T150', takeoffKg=830) {
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
function run(f) {
  const result=calculateUltramagicLoadCandidate(f.input,f.parameters);
  assert.equal(result.status,'NON_VALIDÉ');
  for(const key of ['marginKg','permittedTotalMassKg','availableOccupantsCapacityKg']) assert.equal(key in result,false,key);
  assert.ok(result.reasons.includes('METHOD_NOT_VALIDATED'));
  return result;
}

test('complete documentary input still cannot validate or activate the common lift method', () => {
  const f=fixture();
  const result=run(f);
  assert.deepEqual(result.reasons,['METHOD_NOT_VALIDATED']);
  assert.equal(result.theoretical.actualTotalMassKg,830); // Includes baggage and accessories.
});

for (const [model,minimum] of [['M56Z',297],['M60Z',299],['M65Z',303],['M70Z',306],['M74Z',312],['T150',679]]) {
  test(`${model}: exact numeric takeoff minimum, no rounding or alias`,()=>{
    const below=run(fixture(model,minimum-1));
    assert.ok(below.reasons.includes('TAKEOFF_BELOW_MINIMUM_TOM'));
    const boundary=run(fixture(model,minimum));
    assert.ok(!boundary.reasons.includes('TAKEOFF_BELOW_MINIMUM_TOM'));
    assert.ok(!boundary.reasons.includes('MINIMUM_TOM_UNVERIFIED'));
    if(model.endsWith('Z')) {
      assert.ok(boundary.reasons.includes('ENVELOPE_BASKET_COMPATIBILITY_UNVERIFIED'));
      assert.ok(boundary.reasons.includes('BURNER_COMPATIBILITY_UNVERIFIED'));
    }
  });
}

test('n/a does not invent a numeric minimum; missing value remains explicitly unverified',()=>{
  const na=fixture('H31',250); delete na.e.landing;
  const result=run(na);
  assert.ok(!result.reasons.includes('MINIMUM_TOM_UNVERIFIED'));
  assert.ok(!result.reasons.includes('TAKEOFF_BELOW_MINIMUM_TOM'));
  assert.ok(!result.reasons.includes('LANDING_MASS_UNVERIFIED'));
  assert.ok(run(fixture('H65')).reasons.includes('MINIMUM_TOM_UNVERIFIED'));
});

for (const landing of [undefined,{reference:'TEST',complete:true,totalMassKg:NaN},{reference:'',complete:true,totalMassKg:750}]) {
  test(`unknown/invalid landing mass blocks a documented landing minimum: ${JSON.stringify(landing)}`,()=>{
    const f=fixture(); f.e.landing=landing;
    assert.ok(run(f).reasons.includes('LANDING_MASS_UNVERIFIED'));
  });
}

test('T150 checks landing minimum as well as takeoff; equality is allowed by the documented bound',()=>{
  const f=fixture(); f.e.landing.totalMassKg=678;
  assert.ok(run(f).reasons.includes('LANDING_BELOW_MINIMUM_TOM'));
  f.e.landing.totalMassKg=679;
  assert.ok(!run(f).reasons.includes('LANDING_BELOW_MINIMUM_TOM'));
});

test('the plate is compared only with carried load, not gross TOM or empty basket mass',()=>{
  const f=fixture(); f.e.basketPlate.maximumCarriedKg=800;
  assert.ok(f.e.masses.basketCarriedKg<800 && 830>800);
  assert.ok(!run(f).reasons.includes('BASKET_LOAD_EXCEEDED'));
  f.e.basketPlate.maximumCarriedKg=729;
  assert.ok(run(f).reasons.includes('BASKET_LOAD_EXCEEDED'));
  f.e.basketPlate.maximumCarriedKg=730;
  assert.ok(!run(f).reasons.includes('BASKET_LOAD_EXCEEDED'));
});

test('plate has priority over the default in both directions, and no plate means no fallback',()=>{
  const f=fixture(); f.e.basketPlate.maximumCarriedKg=700;
  assert.ok(run(f).reasons.includes('BASKET_LOAD_EXCEEDED')); // Default C3 is higher.
  const g=fixture('T150',1150);g.e.buildStandard.basketType='C10';g.e.basketPlate.basketType='C10';g.e.basketPlate.maximumCarriedKg=1100;
  assert.ok(g.e.masses.basketCarriedKg>fm04BasketDefault('C10').kg);
  assert.ok(!run(g).reasons.includes('BASKET_LOAD_EXCEEDED'));
  delete f.e.basketPlate;
  assert.ok(run(f).reasons.includes('BASKET_PLATE_UNVERIFIED'));
});

test('wrong plate identity and undocumented C13 remain blocked',()=>{
  const f=fixture(); f.e.basketPlate.basketSerialNumber='OTHER';
  assert.ok(run(f).reasons.includes('BASKET_PLATE_UNVERIFIED'));
  f.e.buildStandard.basketType='C13';
  assert.ok(run(f).reasons.includes('BASKET_TYPE_UNDOCUMENTED'));
});

test('empty basket included in carried load or incomplete mass inventory is rejected',()=>{
  const f=fixture();f.e.masses.basketCarriedKg+=60;
  assert.ok(run(f).reasons.includes('BASKET_CARRIED_MASS_UNVERIFIED'));
  f.e.masses.basketCarriedKg-=60;delete f.e.masses.baggageKg;
  assert.ok(run(f).reasons.includes('COMPLETE_MASSES_UNVERIFIED'));
});

test('compatible basket does not establish compatibility with an unknown burner or array',()=>{
  for (const burner of ['', 'UNKNOWN', 'MK-21']) {
    const f=fixture();f.e.buildStandard.burnerModel=burner;
    assert.ok(run(f).reasons.includes('BURNER_COMPATIBILITY_UNVERIFIED'),burner);
  }
  const f=fixture(); f.e.buildStandard.burnerModel='MK-2 Triple';
  assert.ok(run(f).reasons.includes('BURNER_INCOMPATIBLE')); // White on T150, shaded on M145.
  f.e.buildStandard.burnerModel='MK-21 Double';
  assert.ok(!run(f).reasons.includes('BURNER_INCOMPATIBLE'));
});

test('white basket cell and absent G90 row cannot be confirmed by a generic checkbox',()=>{
  const f=fixture();f.e.buildStandard.basketType='C0';
  assert.ok(run(f).reasons.includes('BASKET_INCOMPATIBLE'));
  const g=fixture('G90');
  assert.ok(run(g).reasons.includes('ENVELOPE_BASKET_COMPATIBILITY_UNVERIFIED'));
});

test('Build Standard and supplement proofs must exist and belong to the exact aircraft/revision',()=>{
  for(const field of ['buildStandard','supplements','masses']) {
    const f=fixture();delete f.e[field];
    const expected={buildStandard:'BUILD_STANDARD_UNVERIFIED',supplements:'APPLICABLE_SUPPLEMENTS_UNVERIFIED',masses:'COMPLETE_MASSES_UNVERIFIED'}[field];
    assert.ok(run(f).reasons.includes(expected));
  }
  for(const [field,value] of [['balloonId','OTHER'],['model','T180'],['manualRevision','FM04_REVISION_29']]) {
    const f=fixture(); f.e[field]=value;
    const result=run(f);assert.ok(result.reasons.includes('EVIDENCE_IDENTITY_MISMATCH'));
    assert.ok(result.reasons.includes('BUILD_STANDARD_UNVERIFIED'));
  }
});

test('Build Standard limits, equipment requirements and reduced MTOM approval remain enforced',()=>{
  const f=fixture();f.e.buildStandard.maximumTakeoffMassKg=f.input.applicableMtowKg-1;
  assert.ok(run(f).reasons.includes('BUILD_STANDARD_MTOM_EXCEEDED'));
  f.e.buildStandard.maximumLiftKg=800;
  assert.ok(run(f).reasons.includes('BUILD_STANDARD_LMAX_EXCEEDED'));
  assert.equal(run(f).theoretical.candidateMassCeilingKg,800);
  f.e.buildStandard.otherEquipmentRequirementsVerified=false;
  assert.ok(run(f).reasons.includes('EQUIPMENT_REQUIREMENTS_UNVERIFIED'));
  const g=fixture();g.input.applicableMtowKg=g.parameters.reducedMtomKg;
  assert.ok(run(g).reasons.includes('REDUCED_MTOM_DOCUMENTATION_UNVERIFIED'));
  g.e.reducedMtomApproval={logbookReference:'SYNTHETIC LOGBOOK APPROVAL',mtomKg:g.input.applicableMtowKg};
  assert.ok(!run(g).reasons.includes('REDUCED_MTOM_DOCUMENTATION_UNVERIFIED'));
});


test('complete takeoff mass is checked against the selected MTOM, including a reduced limit',()=>{
  const f=fixture('T150',1430);f.input.applicableMtowKg=f.parameters.reducedMtomKg;
  assert.ok(run(f).reasons.includes('TAKEOFF_EXCEEDS_APPLICABLE_MTOM'));
});

test('a plate for another basket type cannot establish the actual limit',()=>{
  const f=fixture();f.e.basketPlate.basketType='C10';
  assert.ok(run(f).reasons.includes('BASKET_PLATE_UNVERIFIED'));
});
