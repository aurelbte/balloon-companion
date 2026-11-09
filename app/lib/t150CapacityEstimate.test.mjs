import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateT150RemainingCapacity } from './t150CapacityEstimate.ts';
import { calculateOfficialLoad } from './loadPerformance/engine.ts';

// Synthetic masses only: these are not aircraft records or method validation.
function fixture() {
  const weights = { envelopeKg:150, basketKg:150, burnerKg:30, fullCylinders:[{id:'a',fullWeightKg:100},{id:'b',fullWeightKg:100}] };
  const input = { manufacturer:'Ultramagic',model:'T150',volumeM3:4245,applicableMtowKg:1465,balloonEquipmentWeightKg:530,occupantsWeightKg:300,launchElevationMslM:0,plannedMaximumAltitudeMslM:0,groundTemperature:{temperatureC:10,sourceModel:'TEST',forecastRun:'TEST',validTime:'2026-11-09T10:00:00Z'} };
  const config = { basketType:'C3',burnerModel:'MK21DOUBLE',basketPlateKg:1365,basketCarriedKg:530,buildMtomKg:1465,buildLmaxKg:1465,baggageKg:10,accessoriesKg:5,landingMassKg:750,equipmentRequirementsReviewed:true };
  return { weights,input,config };
}
const run = f => estimateT150RemainingCapacity(f.input,f.weights,f.config);

test('complete T150: actual masses include fuel once, remaining is minimum signed headroom, method remains locked',()=>{
  const f=fixture(); const before=JSON.stringify(f); const r=run(f);
  assert.deepEqual(r.issues,[]); assert.equal(r.actualTotalMassKg,845);
  assert.equal(r.remainingKg,Math.min(...r.headrooms.map(h=>h.remainingKg)));
  assert.equal(r.status,'ESTIMATION_NON_VALIDEE'); assert.equal(r.methodReason,'METHOD_NOT_VALIDATED');
  assert.equal(calculateOfficialLoad(f.input).status,'UNAVAILABLE'); assert.equal(JSON.stringify(f),before);
});

test('each limiting constraint participates, including negative basket overload',()=>{
  for(const [key,value,label] of [['basketPlateKg',540,'Plaque nacelle (hors nacelle vide)'],['buildLmaxKg',850,'Lmax Build Standard']]) {
    const f=fixture();f.config[key]=value;const r=run(f);assert.equal(r.limitingConstraint,label); assert.equal(r.remainingKg,key==='basketPlateKg'?10:5);
  }
  const f=fixture();f.config.basketPlateKg=500;assert.equal(run(f).remainingKg,-30);
  f.config.basketPlateKg=1365;f.input.applicableMtowKg=900;f.config.reducedMtomDocumented=true;assert.equal(run(f).remainingKg,55);
  f.input.applicableMtowKg=1465;f.input.groundTemperature.temperatureC=40;
  const hot=run(f); assert.equal(hot.limitingConstraint,'Portance théorique');
  assert.equal(hot.remainingKg,hot.theoreticalLiftKg-845);
});

test('missing or invalid actual masses and configuration never become zero',()=>{
  for(const key of ['basketPlateKg','basketCarriedKg','buildMtomKg','buildLmaxKg','baggageKg','accessoriesKg','landingMassKg','basketType','burnerModel','equipmentRequirementsReviewed']) {
    const f=fixture();delete f.config[key];assert.equal(run(f).remainingKg,null,key);
  }
  for(const value of [NaN,Infinity,-1]) {const f=fixture();f.config.baggageKg=value;assert.equal(run(f).remainingKg,null);}
  const f=fixture();f.weights.fullCylinders.pop();f.input.balloonEquipmentWeightKg=430;assert.equal(run(f).remainingKg,null);
});

test('minimum TOM 679 applies at departure and landing, reduced MTOM needs logbook, incompatible assemblies rejected',()=>{
  const f=fixture();f.config.landingMassKg=678;assert.equal(run(f).remainingKg,null);
  f.config.landingMassKg=679;assert.notEqual(run(f).remainingKg,null);
  f.input.occupantsWeightKg=100;assert.equal(run(f).remainingKg,null);
  const reduced=fixture();reduced.input.applicableMtowKg=1425;assert.equal(run(reduced).remainingKg,null);
  reduced.config.reducedMtomDocumented=true;assert.notEqual(run(reduced).remainingKg,null);
  for(const [key,value] of [['basketType','C0'],['burnerModel','MK21SINGLE']]) { const bad=fixture();bad.config[key]=value;assert.equal(run(bad).remainingKg,null); }
});

test('scope excludes other Ultramagic, Cameron and Kubicek; inconsistent profile masses block',()=>{
  for(const [manufacturer,model] of [['Ultramagic','H65'],['Cameron','T150'],['Kubicek','T150']]) {const f=fixture();Object.assign(f.input,{manufacturer,model});assert.equal(run(f),null);}
  const f=fixture();f.input.balloonEquipmentWeightKg=529;assert.equal(run(f).remainingKg,null);
});
