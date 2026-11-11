import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import manifest from '../../public/osm-power/lfqo/6b46a77294ac1b41/manifest.json' with { type:'json' };
import { LFQOPowerLineTiles, PreparationPowerLineRuntime, lfqoCoverage, preparationPowerLineStatusLabel } from './preparationPowerLines.ts';
import { PowerLineMemoryStore } from './powerLinesRuntime.ts';
const whole={west:2.75,east:3.4,south:50.45,north:50.92};
const point={west:3.07555,east:3.07557,south:50.68721,north:50.68723};
const outside={west:2.3,east:2.4,south:48.8,north:48.9};
const root='/osm-power/lfqo/'+manifest.dataset_sha256.slice(0,16)+'/';
const asset=async url=>new Response(await readFile(new URL('../../public'+url,import.meta.url)));
function bounds(key){
 const [,z,x,y]=key.match(/^tiles\/(\d+)\/(\d+)\/(\d+)\.geojson$/).map(Number);
 const n=2**z,lat=row=>Math.atan(Math.sinh(Math.PI*(1-2*row/n)))*180/Math.PI;
 return [x/n*360-180,lat(y+1),(x+1)/n*360-180,lat(y)];
}

test('LFQO sparse XYZ manifest distinguishes outside/empty/unloaded cells from HTTP, network and verification failures',async()=>{
 // Real active files: correct fixed zoom, XYZ (not TMS), count, hashes and unchanged >=63kV filter.
 assert.equal(manifest.tiling.scheme,'XYZ');assert.equal(manifest.tiling.empty_tiles,'omitted_within_coverage');
 assert.equal(manifest.statistics.tiles,manifest.tiling.tiles.length);
 assert.equal(new Set(manifest.tiling.tiles.map(t=>t.key)).size,manifest.tiling.tiles.length);
 for(const tile of manifest.tiling.tiles){
  assert.match(tile.key,/^tiles\/11\/\d+\/\d+\.geojson$/);
  const bytes=await readFile(new URL('../../public'+root+tile.key,import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),tile.sha256);
  bounds(tile.key).forEach((value,i)=>assert.ok(Math.abs(value-tile.bbox[i])<1e-9));
  const data=JSON.parse(bytes);assert.equal(data.features.length,tile.features);
  assert.ok(data.features.every(f=>f.properties.power==='line'&&f.properties.voltage_max_v>=63000));
 }
 let requests=0;
 const catalog=new LFQOPowerLineTiles(async()=>{requests++;throw new Error('must not fetch empty/outside');});
 const edge=manifest.tiling.tiles.find(t=>t.key==='tiles/11/1041/688.geojson');
 const touching={west:edge.bbox[0],east:edge.bbox[2],south:Math.max(edge.bbox[1],point.south),north:Math.min(edge.bbox[3],point.north)};
 assert.ok(catalog.tiles(touching).every(t=>t.key===edge.key)); // no adjacent file for a zero-area overlap
 assert.deepEqual(catalog.diagnostics(outside),[]);await catalog.load(outside);assert.equal(requests,0);
 const empty=catalog.diagnostics(whole).find(t=>t.status==='EMPTY');assert.ok(empty);
 const [west,south,east,north]=bounds(empty.key);
 let emptyView;
 for(let i=1;i<30&&!emptyView;i++)for(let j=1;j<30&&!emptyView;j++){
  const lon=west+(east-west)*i/30,lat=south+(north-south)*j/30;
  const view={west:lon-1e-6,east:lon+1e-6,south:lat-1e-6,north:lat+1e-6};
  if(lfqoCoverage(view)==='FULL'&&catalog.diagnostics(view).every(t=>t.status==='EMPTY'))emptyView=view;
 }
 assert.ok(emptyView);await catalog.load(emptyView);assert.equal(requests,0);assert.equal(catalog.missing(emptyView),0);
 let state;
 const noOverpass=new PowerLineMemoryStore(async()=>{throw new Error('no Overpass');});
 const emptyRuntime=new PreparationPowerLineRuntime(s=>state=s,noOverpass,undefined,catalog);
 await emptyRuntime.update(emptyView,true);
 assert.equal(state.status,'EMPTY_CONFIRMED');assert.match(state.coverageLabel,/extrait vide pour ce filtre/);
 assert.doesNotMatch(state.coverageLabel,/introuvable|erreur|manquante/);
 const unloaded=new PreparationPowerLineRuntime(s=>state=s,noOverpass,undefined,new LFQOPowerLineTiles(asset));
 await unloaded.update(point,false);
 assert.equal(state.tileDiagnostics[0].status,'NOT_LOADED');assert.match(preparationPowerLineStatusLabel(state),/non chargée.*Hors ligne/);
 assert.doesNotMatch(state.coverageLabel,/introuvable|HTTP/);
 for(const [status,expected] of [[404,'NOT_FOUND'],[410,'NOT_FOUND'],[503,'HTTP_ERROR']]){
  const tiles=new LFQOPowerLineTiles(async()=>new Response(null,{status}));
  const runtime=new PreparationPowerLineRuntime(s=>state=s,noOverpass,undefined,tiles);
  await runtime.update(point,true);
  assert.equal(state.tileDiagnostics[0].status,expected);assert.equal(state.tileDiagnostics[0].httpStatus,status);
  assert.equal(state.tileDiagnostics[0].url,root+state.tileDiagnostics[0].key);
  assert.match(state.coverageLabel,new RegExp('HTTP '+status));assert.equal(state.covered,false);
 }
 for(const [error,expected] of [[new TypeError('network'),'NETWORK_ERROR'],[new DOMException('timeout','TimeoutError'),'TIMEOUT']]){
  const tiles=new LFQOPowerLineTiles(async()=>{throw error;});await tiles.load(point);
  assert.equal(tiles.diagnostics(point)[0].status,expected);
 }
 const corrupted=new LFQOPowerLineTiles(async()=>new Response('wrong body'));
 await corrupted.load(point);assert.equal(corrupted.diagnostics(point)[0].status,'HASH_MISMATCH');
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
 try{
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:undefined});
  const tiles=new LFQOPowerLineTiles(asset);
  const runtime=new PreparationPowerLineRuntime(s=>state=s,noOverpass,undefined,tiles);
  await runtime.update(point,true);
  assert.equal(state.tileDiagnostics[0].status,'VERIFICATION_UNAVAILABLE');
  assert.match(state.coverageLabel,/HTTPS requis/);assert.doesNotMatch(state.coverageLabel,/introuvable/);
 }finally{if(descriptor)Object.defineProperty(globalThis,'crypto',descriptor);else delete globalThis.crypto;}
 let fail=true;const modes=[];
 const retry=new LFQOPowerLineTiles(async(url,options)=>{modes.push(options.cache);return fail?new Response(null,{status:404}):asset(url);});
 await retry.load(point);fail=false;await retry.load(point);
 assert.deepEqual(modes,['force-cache','reload']);assert.equal(retry.diagnostics(point)[0].status,'AVAILABLE');
 const retained=retry.data(point);await retry.load(point);assert.equal(modes.length,2);assert.deepEqual(retry.data(point),retained);
});
