import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateT150RemainingCapacity } from './t150CapacityEstimate.ts';
import { calculateOfficialLoad } from './loadPerformance/engine.ts';
import { buildLoadCalculationInput } from './loadPerformance/balloonInput.ts';

// Synthetic profile, with free cylinder labels: no compatibility or aircraft proof.
function fixture() {
  const weights = { envelopeKg:150, basketKg:150, burnerKg:30, fullCylinders:[{id:'a',label:'Autre marque A',fullWeightKg:100},{id:'b',label:'Autre marque B',fullWeightKg:100}] };
  const balloon = { id:'test', manufacturer:'Ultramagic',model:'T150',volumeM3:4245,applicableMtowKg:1465,configurationLimitsConfirmed:false,weights };
  const input = buildLoadCalculationInput({balloon, occupantsWeightKg:300,launchElevationMslM:0,plannedMaximumAltitudeMslM:0,groundTemperature:{temperatureC:10,sourceModel:'TEST',forecastRun:'TEST',validTime:'2026-11-09T10:00:00Z'}});
  return {weights,input,config:{baggageKg:10,accessoriesKg:5,landingMassKg:750}};
}
const run = f => estimateT150RemainingCapacity(f.input,f.weights,f.config);

test('existing profile masses reused once, no material selection; multibrand estimation is not compatibility approval',()=>{
  const f=fixture(); const before=JSON.stringify(f); const r=run(f);
  assert.deepEqual(r.issues,[]); assert.equal(f.input.balloonEquipmentWeightKg,530); assert.equal(r.actualTotalMassKg,845);
  assert.equal(r.remainingKg,Math.min(r.theoreticalLiftKg,1465)-845);
  assert.equal(r.status,'ESTIMATION_NON_VALIDEE'); assert.equal(r.methodReason,'METHOD_NOT_VALIDATED');
  assert.ok(r.warnings.some(w=>w.includes('Compatibilité réglementaire non justifiée')));
  for(const label of ['Plaque nacelle','MTOM Build Standard','Lmax Build Standard']) assert.ok(r.warnings.some(w=>w.includes(label)),label);
  assert.equal(calculateOfficialLoad(f.input).status,'UNAVAILABLE');assert.equal(JSON.stringify(f),before);
});

test('available limits remain enforced, including signed overload and conservatively derived basket mass',()=>{
  const f=fixture(); f.input.basketMaximumLoadKg=550; const r=run(f);
  // 845 minus envelope 150 minus empty basket 150 = 545, never counted twice.
  assert.equal(r.remainingKg,5);assert.match(r.limitingConstraint,/Plaque nacelle/);
  assert.ok(r.warnings.some(w=>w.includes('hypothèse conservatrice')));
  f.input.basketMaximumLoadKg=500;assert.equal(run(f).remainingKg,-45);
  delete f.input.basketMaximumLoadKg; f.config.buildLmaxKg=850;assert.equal(run(f).remainingKg,5);
  f.config.buildMtomKg=1400;assert.equal(run(f).remainingKg,null);
});

test('explicit documentary carried mass and plate override remain usable without approving compatibility',()=>{
  const f=fixture();Object.assign(f.config,{basketPlateKg:540,basketCarriedKg:530,buildMtomKg:1465,buildLmaxKg:1465});
  assert.equal(run(f).remainingKg,10);assert.ok(run(f).warnings.some(w=>w.includes('Compatibilité')));
  f.config.basketCarriedKg=100;assert.equal(run(f).remainingKg,null);
});

test('missing flight masses are not zero; explicit absence of extra baggage/accessories is accepted',()=>{
  for(const key of ['baggageKg','accessoriesKg','landingMassKg']) {const f=fixture();delete f.config[key];assert.equal(run(f).remainingKg,null,key);}
  for(const value of [NaN,Infinity,-1]) {const f=fixture();f.config.baggageKg=value;assert.equal(run(f).remainingKg,null);}
  const f=fixture();f.config.baggageKg=0;f.config.accessoriesKg=0;assert.equal(run(f).actualTotalMassKg,830);assert.notEqual(run(f).remainingKg,null);
});

test('minimum TOM, required cylinders and invalid profile data still block',()=>{
  const f=fixture();f.config.landingMassKg=678;assert.equal(run(f).remainingKg,null);
  f.config.landingMassKg=679;assert.notEqual(run(f).remainingKg,null);
  f.input.occupantsWeightKg=100;assert.equal(run(f).remainingKg,null);
  const missing=fixture(); missing.weights.fullCylinders.pop();missing.input.balloonEquipmentWeightKg=430;assert.equal(run(missing).remainingKg,null);
  const mismatch=fixture();mismatch.input.balloonEquipmentWeightKg=529;assert.equal(run(mismatch).remainingKg,null);
});

test('reduced MTOM applies as entered with unverified approval warning; hot-day lift still limits',()=>{
  const f=fixture();f.input.applicableMtowKg=900;const r=run(f);assert.equal(r.remainingKg,55);
  assert.ok(r.warnings.some(w=>w.includes('approbation au carnet non justifiée')));
  f.input.applicableMtowKg=1465; f.input.groundTemperature.temperatureC=40;const hot=run(f);
  assert.equal(hot.limitingConstraint,'Portance théorique');assert.equal(hot.remainingKg,hot.theoreticalLiftKg-845);
  f.input.applicableMtowKg=1466;assert.equal(run(f).remainingKg,null);
});

test('invalid provided limits and missing weather cannot be silently ignored',()=>{
  for(const key of ['basketPlateKg','buildMtomKg','buildLmaxKg']) {const f=fixture();f.config[key]=NaN;assert.equal(run(f).remainingKg,null);}
  const f=fixture();delete f.input.groundTemperature;assert.equal(run(f).remainingKg,null);
});

test('other Ultramagic, Cameron and Kubicek stay outside scope',()=>{
  for(const [manufacturer,model] of [['Ultramagic','H65'],['Cameron','T150'],['Kubicek','T150']]) {const f=fixture();Object.assign(f.input,{manufacturer,model});assert.equal(run(f),null);}
});
