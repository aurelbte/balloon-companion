import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogModels } from './balloonCatalog.ts';
import { ultramagicModelParameters } from './loadPerformance/modelParameters/ultramagicModels.ts';
import { calculateManufacturerLoad } from './loadPerformance/manufacturerDispatcher.ts';
import { calculateOfficialLoad } from './loadPerformance/engine.ts';
import { estimateUltramagicRemainingCapacity, estimateT150RemainingCapacity } from './t150CapacityEstimate.ts';
const catalog = catalogModels('Ultramagic');
const conflicts = new Set(['M70Z','N500']);
function fixture(row) {
  const parameters=ultramagicModelParameters.find(p=>p.model===row.model);
  const weights={envelopeKg:40,basketKg:40,burnerKg:20,fullCylinders:[{id:'a',fullWeightKg:25},{id:'b',fullWeightKg:25}]};
  const input={manufacturer:'Ultramagic',model:row.model,volumeM3:row.volumeM3,applicableMtowKg:parameters.standardMtomKg,balloonEquipmentWeightKg:150,occupantsWeightKg:20,launchElevationMslM:0,plannedMaximumAltitudeMslM:1000,groundTemperature:{temperatureC:20,sourceModel:'SYNTHETIC TEST',forecastRun:'TEST',validTime:'2026-11-09T10:00:00Z'}};
  return {input,weights};
}
for(const row of catalog) test(`${row.model}: catalogue ${row.volumeM3} m³ uses existing FM04 candidate or reports the exact volume conflict`,()=>{
  const {input,weights}=fixture(row);const before=JSON.stringify({input,weights});
  const r=estimateUltramagicRemainingCapacity(input,weights);
  assert.equal(r.status,'ESTIMATION_NON_VALIDEE');assert.equal(r.methodReason,'METHOD_NOT_VALIDATED');
  assert.equal(r.model,row.model);assert.equal(calculateOfficialLoad(input).status,'UNAVAILABLE');
  if(conflicts.has(row.model)) {assert.equal(r.remainingKg,null);assert.ok(r.issues.some(i=>i.includes('volume enregistré')&&i.includes(String(row.volumeM3))));}
  else {
    const engine=calculateManufacturerLoad(input.manufacturer,input.model,input);
    assert.equal(r.theoreticalLiftKg,engine.theoretical.performanceLimitedMassKg);
    assert.equal(r.remainingKg,Math.min(r.theoreticalLiftKg,input.applicableMtowKg)-170);
    assert.ok(Number.isFinite(r.remainingKg));
  }
  assert.equal(JSON.stringify({input,weights}),before);
});

test('catalogue coverage: fifty models, only two conflicting volumes, no missing volume or MTOM inferred',()=>{
  assert.equal(catalog.length,50);
  assert.deepEqual(catalog.filter(row=>row.volumeM3!==ultramagicModelParameters.find(p=>p.model===row.model)?.volumeM3).map(r=>r.model),[...conflicts]);
});

test('per-model numeric minima, non-applicability and undocumented minima never borrow T150 values',()=>{
  for(const [model,kg] of [['T150',679],['N550',2500],['M56Z',297],['H31',null],['H65',null]]) {
    const {input,weights}=fixture(catalog.find(r=>r.model===model));const r=estimateUltramagicRemainingCapacity(input,weights);
    assert.equal(r.minimumTomKg,kg);
    if(model==='H65') assert.ok(r.warnings.some(w=>w.includes('minimum TOM non documenté')));
    if(model==='H31') assert.ok(r.warnings.some(w=>w.includes('minimum TOM non applicable')));
    if(model==='M56Z') assert.ok(!r.warnings.some(w=>w.includes('Minimum TOM à l’atterrissage')));
    if(model==='T150') assert.deepEqual(r,estimateT150RemainingCapacity(input,weights));
  }
});

test('temperature and maximum altitude changes recalculate immediately through the same engine',()=>{
  const {input,weights}=fixture(catalog.find(r=>r.model==='S105'));
  const first=estimateUltramagicRemainingCapacity(input,weights);
  input.groundTemperature={...input.groundTemperature,temperatureC:30,provider:'MANUAL'};
  const warmer=estimateUltramagicRemainingCapacity(input,weights);assert.ok(warmer.theoreticalLiftKg<first.theoreticalLiftKg);
  input.plannedMaximumAltitudeMslM=2000;
  const higher=estimateUltramagicRemainingCapacity(input,weights);assert.notEqual(higher.remainingKg,warmer.remainingKg);
  input.occupantsWeightKg=2000;assert.ok(estimateUltramagicRemainingCapacity(input,weights).remainingKg<0);
});

test('missing numeric inputs and unknown model stay unavailable; other manufacturers stay untouched',()=>{
  for(const key of ['volumeM3','applicableMtowKg','balloonEquipmentWeightKg','occupantsWeightKg','groundTemperature','launchElevationMslM','plannedMaximumAltitudeMslM']) {
    const {input,weights}=fixture(catalog[0]);delete input[key];const r=estimateUltramagicRemainingCapacity(input,weights);assert.equal(r.remainingKg,null,key);assert.ok(r.issues.length);
  }
  const {input,weights}=fixture(catalog[0]);input.model='UNKNOWN';const r=estimateUltramagicRemainingCapacity(input,weights);assert.equal(r.remainingKg,null);assert.ok(r.issues.some(i=>i.includes('paramètres FM04')));
  for(const manufacturer of ['Cameron','Kubicek']) assert.equal(estimateUltramagicRemainingCapacity({...input,manufacturer},weights),null);
});
