import test from 'node:test';
import assert from 'node:assert/strict';
import {studySourceSpec,buildZone} from './build.mjs';
import {normalizeSia,canonical,sha256} from './normalize.ts';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
const source={artifact:'sia-20261126.xlsx',referenceDate:'2026-11-26',airacCycle:'2026-11-26',license:'SIA Licence ouverte'};
test('legacy study edition stays explicit and current AIRAC cannot inherit the old filename/date',()=>{
 assert.equal(studySourceSpec({}).sia.referenceDate,'2026-10-29');
 assert.deepEqual(studySourceSpec({sourceFiles:{sia:source}}).sia,source);
 for(const bad of [{...source,artifact:'sia-20261029.xlsx'},{...source,referenceDate:'2026-02-30'},{...source,airacCycle:'invalid'},{...source,artifact:'../sia-20261126.xlsx'}])assert.throws(()=>studySourceSpec({sourceFiles:{sia:bad}}),/INVALID_STUDY_SIA_EDITION/);
 for(const scripts of [['../fetch.py'],['/tmp/fetch.py'],['fetch.py','fetch.py'],[]])assert.throws(()=>studySourceSpec({extractionScripts:scripts}),/INVALID_EXTRACTION_SCRIPT_PATH/);
});
test('fresh source metadata, extraction code and real acquisition UTC survive normalization; mismatched edition fails',async t=>{
 const root=await mkdtemp('/tmp/bc-obstacle-current-source-test-');t.after(()=>rm(root,{recursive:true,force:true}));
 const study=join(root,'study');await mkdir(study);
 // Explicitly synthetic UNIT TEST bytes, never a real study or publication dataset.
 const raw={IDENTIFICATEUR:'synthetic-unit-test',TYPE:'Mât',NOMBRE:'1','LONGITUDE DECIMALE':'1.5047','LATITUDE DECIMALE':'49.8804','SYSTEME DE REFERENCE HORIZONTALE':'WGS84'};
 const values={'sia-20261126.xlsx':'synthetic-source','georisques-turbine.csv':'synthetic-csv','haute-normandie.osm.pbf':'synthetic-pbf','sia-local-raw.json':JSON.stringify([raw]),'georisques-local-raw.json':'[]','extract-current.py':'# synthetic unit-test extraction fixture'};
 const stamp='2026-11-27T09:00:00Z';
 const unresolved={id:'relation/123',tags:{aerialway:'cable_car'},members:[{type:'w',ref:42,role:''}],extracts:['haute-normandie'],unresolved_native_geometry:true};
 values['osm-local-raw.json']=JSON.stringify({sources:[{region:'haute-normandie',sha256:sha256(values['haute-normandie.osm.pbf']),snapshot_utc:'2026-11-26T21:21:01Z',retrieved_at_utc:stamp}],elements:[unresolved]});
 values['sources.json']=JSON.stringify({sourceFiles:{sia:source},extractionScripts:['extract-current.py'],acquisition:{nativeTracesByIntersection:true},raw_files:Object.entries(values).map(([file,bytes])=>({file,sha256:sha256(bytes)}))});
 for(const file of ['sia-20261126.xlsx','georisques-turbine.csv'])values[file+'.metadata.json']=JSON.stringify({status:200,url:'https://example.invalid/synthetic-test',sha256:sha256(values[file]),requested_at_utc:stamp,completed_at_utc:'2026-11-27T09:01:00Z',...(file.startsWith('sia')?{referenceDate:source.referenceDate,airacCycle:source.airacCycle}:{})});
 await Promise.all(Object.entries(values).map(([name,bytes])=>writeFile(join(study,name),bytes)));
 const out=await buildZone('preuseville',study,join(root,'normalized'));
 const m=JSON.parse(await readFile(join(out.output,'manifest.json'))),records=JSON.parse(await readFile(join(out.output,'records.json')));
 assert.equal(m.sources[0].referenceDate,'2026-11-26');assert.equal(m.sources[0].artifact,'sia-20261126.xlsx');assert.equal(m.sources[0].license,source.license);
 assert.equal(m.sources[0].retrievedAtUtc,'2026-11-27T09:01:00Z');assert.equal(m.sources[1].retrievedAtUtc,'2026-11-27T09:01:00Z');assert.equal(m.sources[0].snapshotAtUtc,null);
 assert.equal(m.sources[2].retrievedAtUtc,stamp);assert.equal(m.sources[2].snapshotAtUtc,'2026-11-26T21:21:01Z');
 assert.deepEqual(records[0].measurements,normalizeSia(raw,[]).measurements);assert.equal(m.version,sha256(canonical(m.identity)));
 assert.ok(m.identity.metadata.some(x=>x.file==='extract-current.py'));assert.ok(m.limitations.some(x=>x.includes('traces selected by 2D intersection')));
 const excluded=JSON.parse(await readFile(join(out.output,'excluded.json')));
 assert.deepEqual(excluded[0].original,unresolved);assert.equal(excluded[0].reason,'native_relation_geometry_unresolved_requires_review');
 assert.equal(records.length,1);assert.ok(m.limitations.some(x=>x.includes('no point or route invented')));
 const meta=JSON.parse(values['sia-20261126.xlsx.metadata.json']);meta.referenceDate='2026-10-29';await writeFile(join(study,'sia-20261126.xlsx.metadata.json'),JSON.stringify(meta));
 await assert.rejects(buildZone('preuseville',study,join(root,'refused')),/SIA_EDITION_METADATA_MISMATCH/);
});
