import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cameronDocumentedCatalogModels } from './cameronCatalog.ts';
import { catalogModels, catalogVolume, catalogModelDisplayName, balloonUiDisplayName } from './balloonCatalog.ts';
import { REGISTERED_BALLOONS, balloonDisplayName, balloonSnapshot, officialFieldsForBalloon } from './balloons.ts';
import { resolveCameronModelParameters } from './loadPerformance/modelParameters/cameronModels.ts';
import { mtomAfterModelChange } from './balloonFormPolicy.ts';

test('all 104 exact Table 5 types have individually sourced Table 2 characteristics', () => {
  assert.equal(cameronDocumentedCatalogModels.length,104);
  assert.equal(new Set(cameronDocumentedCatalogModels.map(row=>row.model)).size,104);
  const expected={A:24,C:6,N:15,O:12,Sport:6,TR:5,Z:36};
  for(const [family,count] of Object.entries(expected)) assert.equal(cameronDocumentedCatalogModels.filter(row=>row.documentation.manufacturerDesignation.startsWith(family+'-')).length,count);
  for(const row of cameronDocumentedCatalogModels){
    assert.ok(row.volumeM3>0);
    assert.ok(row.documentation.volumeCuFt>0);
    assert.ok(row.documentation.standardMtomKg>=row.documentation.reducedMtomKg);
    assert.ok(row.documentation.minimumLandingMassKg===null || row.documentation.minimumLandingMassKg>0);
    assert.match(row.documentation.limitsPage,/^2-[67]$/);
    assert.match(row.documentation.equipmentPage,/^9-[123]$/);
    assert.equal(row.documentation.verificationStatus,'VERIFIED_FROM_OFFICIAL_MANUAL');
  }
});

for(const [model,volume,cuft,standard,reduced,mlm,drawing] of [
  ['Z105',2974,105000,952,952,476,'CB1345'],
  ['Z275',7788,275000,2494,1999,1247,'CB1467'],
]) test(`${model}: verified characteristics and display label never change its model key or engine mapping`,()=>{
  const row=catalogModels('Cameron').find(row=>row.model===model), before=structuredClone(row);
  assert.equal(row.volumeM3,volume);
  assert.deepEqual([row.documentation.volumeCuFt,row.documentation.standardMtomKg,row.documentation.reducedMtomKg,row.documentation.minimumLandingMassKg,row.documentation.drawingNumber],[cuft,standard,reduced,mlm,drawing]);
  assert.equal(catalogModelDisplayName('Cameron',model),model.slice(1));
  assert.equal(catalogModelDisplayName('Cameron',model.replace('Z','Z-')),model.slice(1));
  assert.equal(resolveCameronModelParameters(model).model,'Z-'+model.slice(1));
  assert.deepEqual(row,before);
});

test('legacy references remain selectable without silently becoming a different documented variant',()=>{
  for(const [model,volume] of [['Z300',8495],['Z425',12035]]){
    const row=catalogModels('Cameron').find(row=>row.model===model);
    assert.equal(row.legacyUndocumented,true);
    assert.equal(row.documentation,undefined);
    assert.equal(catalogVolume('Cameron',model),volume);
  }
  assert.equal(catalogVolume('Cameron','Z425LW'),12036);
  assert.equal(catalogVolume('Cameron','Z240'),null);
  assert.equal(catalogVolume('Cameron','A260'),null);
});

test('registered profiles, snapshots, stored/export labels, and MTOM transitions remain unchanged',()=>{
  const balloon=REGISTERED_BALLOONS[0],before=structuredClone(balloon);
  assert.equal(balloon.model,'Z105');
  assert.equal(balloon.volumeM3,2973); // Existing aircraft data is not overwritten by new catalogue volumes.
  assert.match(balloonUiDisplayName(balloon),/Cameron 105$/);
  assert.match(balloonDisplayName(balloon),/Cameron Z105$/); // Persistence/cloud helper stays untouched.
  assert.equal(balloonSnapshot(balloon).model,'Z105');
  assert.equal(officialFieldsForBalloon(balloon).balloonModel,'Cameron Z105');
  assert.deepEqual(mtomAfterModelChange('',false,'Cameron','Z105'),{value:'952',fromCatalog:true,configurationLimitsConfirmed:false});
  assert.deepEqual(mtomAfterModelChange('2400',false,'Cameron','Z275'),{value:'2400',fromCatalog:false,configurationLimitsConfirmed:false});
  assert.deepEqual(balloon,before);
  assert.equal(catalogModelDisplayName('Ultramagic','Z90'),'Z90');
  assert.equal(catalogModelDisplayName('Kubíček','BB26Z'),'BB26Z');
  const source=readFileSync(new URL('../components/balloons/BalloonForm.tsx',import.meta.url),'utf8');
  assert.match(source, /value=\{item.model\}/);
  assert.match(source, /setVolume\(String\(balloon.volumeM3\)\)/);
  assert.match(source, /setModelChoice\(knownModel \? balloon.model : OTHER\)/);
});
