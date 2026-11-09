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
  return {weights,input,config:{}};
}
const run = f => estimateT150RemainingCapacity(f.input,f.weights,f.config);

test('existing profile masses reused once, no material selection; multibrand estimation is not compatibility approval',()=>{
  const f=fixture(); const before=JSON.stringify(f); const r=run(f);
  assert.deepEqual(r.issues,[]); assert.equal(f.input.balloonEquipmentWeightKg,530); assert.equal(r.actualTotalMassKg,830);
  assert.equal(r.remainingKg,Math.min(r.theoreticalLiftKg,1465)-830);
  assert.equal(r.status,'ESTIMATION_NON_VALIDEE'); assert.equal(r.methodReason,'METHOD_NOT_VALIDATED');
  assert.ok(r.warnings.some(w=>w.includes('Compatibilité réglementaire non justifiée')));
  for(const label of ['Plaque nacelle','MTOM Build Standard','Lmax Build Standard']) assert.ok(r.warnings.some(w=>w.includes(label)),label);
  assert.equal(calculateOfficialLoad(f.input).status,'UNAVAILABLE');assert.equal(JSON.stringify(f),before);
});

test('available limits remain enforced, including signed overload and conservatively derived basket mass',()=>{
  const f=fixture(); f.input.basketMaximumLoadKg=550; const r=run(f);
  // 845 minus envelope 150 minus empty basket 150 = 545, never counted twice.
  assert.equal(r.remainingKg,Math.min(r.theoreticalLiftKg,1465)-830);assert.equal(r.headrooms.find(h=>h.label.includes('Plaque')).remainingKg,20);
  assert.ok(r.warnings.some(w=>w.includes('hypothèse conservatrice')));
  f.input.basketMaximumLoadKg=500;assert.ok(run(f).warnings.some(w=>w.includes("Limite dépassée")));
  delete f.input.basketMaximumLoadKg; f.config.buildLmaxKg=800;assert.ok(run(f).warnings.some(w=>w.includes("Lmax Build Standard")));
  f.config.buildMtomKg=1400;assert.equal(run(f).remainingKg,null);
});

test('explicit documentary carried mass and plate override remain usable without approving compatibility',()=>{
  const f=fixture();Object.assign(f.config,{basketPlateKg:540,basketCarriedKg:530,buildMtomKg:1465,buildLmaxKg:1465});
  assert.equal(run(f).remainingKg,Math.min(run(f).theoreticalLiftKg,1465)-830);assert.ok(run(f).warnings.some(w=>w.includes('Compatibilité')));
  f.config.basketCarriedKg=100;assert.equal(run(f).remainingKg,null);
});

test('margin needs no additional input, landing minimum stays explicitly unverified',()=>{
  const f=fixture();const r=estimateT150RemainingCapacity(f.input,f.weights);
  assert.notEqual(r.remainingKg,null);
  assert.ok(r.warnings.some(w=>w.includes('Minimum TOM à l’atterrissage non vérifié (679 kg)')));
  const noOccupants=fixture();delete noOccupants.input.occupantsWeightKg;assert.equal(run(noOccupants).remainingKg,null);
  for(const value of [NaN,Infinity,-1]) {const invalid=fixture();invalid.input.occupantsWeightKg=value;assert.equal(run(invalid).remainingKg,null);}
});

test('minimum TOM, required cylinders and invalid profile data still block',()=>{
  const f=fixture();f.config.landingMassKg=678;assert.equal(run(f).remainingKg,null);
  f.config.landingMassKg=679;assert.notEqual(run(f).remainingKg,null);
  f.input.occupantsWeightKg=100;assert.equal(run(f).remainingKg,null);
  const missing=fixture(); missing.weights.fullCylinders.pop();missing.input.balloonEquipmentWeightKg=430;assert.equal(run(missing).remainingKg,null);
  const mismatch=fixture();mismatch.input.balloonEquipmentWeightKg=529;assert.equal(run(mismatch).remainingKg,null);
});

test('reduced MTOM applies as entered with unverified approval warning; hot-day lift still limits',()=>{
  const f=fixture();f.input.applicableMtowKg=900;const r=run(f);assert.equal(r.remainingKg,70);
  assert.ok(r.warnings.some(w=>w.includes('approbation au carnet non justifiée')));
  f.input.applicableMtowKg=1465; f.input.groundTemperature.temperatureC=40;const hot=run(f);
  assert.equal(hot.limitingConstraint,'Portance théorique');assert.equal(hot.remainingKg,hot.theoreticalLiftKg-830);
  f.input.applicableMtowKg=1466;assert.equal(run(f).remainingKg,null);
});

test('invalid provided limits and missing weather cannot be silently ignored',()=>{
  for(const key of ['basketPlateKg','buildMtomKg','buildLmaxKg']) {const f=fixture();f.config[key]=NaN;assert.equal(run(f).remainingKg,null);}
  const f=fixture();delete f.input.groundTemperature;assert.equal(run(f).remainingKg,null);
});

test('other Ultramagic, Cameron and Kubicek stay outside scope',()=>{
  for(const [manufacturer,model] of [['Ultramagic','H65'],['Cameron','T150'],['Kubicek','T150']]) {const f=fixture();Object.assign(f.input,{manufacturer,model});assert.equal(run(f),null);}
});

test('negative margin is preserved rather than clamped to zero',()=>{
  const f=fixture();f.input.occupantsWeightKg=1000;const r=run(f);
  assert.ok(r.remainingKg<0);assert.equal(r.remainingKg,Math.min(r.theoreticalLiftKg,1465)-1530);
});
