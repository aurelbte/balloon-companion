import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('default browser fetch stays unbound during LFQO refreshes and loaded GeoJSON reaches the actual MapLibre source callback', async t => {
 const original=globalThis.fetch,urls=[];
 t.after(()=>{globalThis.fetch=original;});
 // Emulate the native browser receiver check, absent from the arrow fetch mocks of earlier tests.
 globalThis.fetch=async function(url,options){
  assert.ok(this===undefined||this===globalThis,'native fetch called with an illegal receiver');
  assert.match(url,/^\/osm-power\/lfqo\/6b46a77294ac1b41\/tiles\/11\/\d+\/\d+\.geojson$/);
  assert.equal(options.signal.aborted,false);urls.push(url);
  return new Response(await readFile(new URL('../../public'+url,import.meta.url)));
 };
 const {PreparationPowerLineRuntime:Runtime,LFQOPowerLineTiles}=await import('./preparationPowerLines.ts');
 const PreparationPowerLineRuntime=class extends Runtime { constructor(...args){super(...args,new LFQOPowerLineTiles(),null,null);} };
 const source=await readFile(new URL('../components/PreparationMap.tsx',import.meta.url),'utf8');
 const start=source.indexOf('  useEffect(() => {\n    const runtime = new PreparationPowerLineRuntime(');
 assert.ok(start>=0);
 const end=source.indexOf('  }, []);',start)+'  }, []);'.length;
 const js=ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const data=[],states=[],powerLineStateRef={current:null},powerLineRuntimeRef={current:null};
 const mapRef={current:{getSource(id){assert.equal(id,'analysis-power-lines');return{setData:geojson=>data.push(geojson)};}}};
 let cleanup;
 new Function('useEffect','PreparationPowerLineRuntime','mapRef','powerLineStateRef','setPowerLineState','powerLineRuntimeRef','setObstacleState','POWER_LINES_SOURCE','OBSTACLE_SOURCE',js)(fn=>{cleanup=fn();},PreparationPowerLineRuntime,mapRef,powerLineStateRef,state=>states.push(state),powerLineRuntimeRef,()=>{},'analysis-power-lines','analysis-obstacles');
 t.after(()=>cleanup?.());
 const runtime=powerLineRuntimeRef.current;
 const first={west:3.00,east:3.15,south:50.64,north:50.74};
 const moved={west:3.01,east:3.16,south:50.64,north:50.74};
 await Promise.all([runtime.update(first,true),runtime.update(moved,true),runtime.update(moved,true)]);
 assert.equal(new Set(urls).size,urls.length); // movements share pending requests, no abort/restart loop
 assert.ok(urls.length>0);
 const state=states.at(-1);
 assert.equal(state.status,'AVAILABLE');assert.equal(state.covered,true);
 assert.ok(state.tileDiagnostics.filter(t=>t.url).every(t=>t.status==='AVAILABLE'));
 assert.equal(state.tileDiagnostics.some(t=>['NETWORK_ERROR','TIMEOUT'].includes(t.status)),false);
 assert.equal(data.at(-1),state.data);assert.ok(data.at(-1).features.length>0);
 assert.ok(data.at(-1).features.every(f=>f.properties.power==='line'&&f.properties.voltage_max_v>=63000));
 const count=urls.length;await runtime.update(moved,true);assert.equal(urls.length,count);
});
