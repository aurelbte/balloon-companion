import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LFQOPowerLineTiles, PreparationPowerLineRuntime, ukPowerLineSource, UK_POWER_LINE_BASE, preparationPowerLineCoverage } from './preparationPowerLines.ts';
import { ukPowerLineCoverage } from './ukPowerLineCoverage.ts';
import { FlightPowerLineRuntime } from './flightPowerLines.ts';
import { PowerLineMemoryStore } from './powerLinesRuntime.ts';
const london={west:-.15,east:-.10,south:51.5,north:51.52};
const belfast={west:-5.95,east:-5.9,south:54.58,north:54.62};
const edge={west:-8,east:-4,south:54,north:56};
function harness({fail=false,lazy=false}={}) {
 const requests=[],states=[],overpass=[];
 // Deterministic bodies exercise the real published index without requiring local large files or network.
 const bodies=new Map();
 const tiles=ukPowerLineSource.manifest.tiling.tiles.map(t=>{
  const data=JSON.stringify({type:'FeatureCollection',features:t.features?[{type:'Feature',id:'way/42',properties:{power:'line',voltage:'20000;225000',voltage_max_v:225000},geometry:{type:'LineString',coordinates:[[-.13,51.51],[-.12,51.515]]}}]:[]});
  bodies.set(t.key,data);return {...t,features:t.features?1:0,sha256:createHash('sha256').update(data).digest('hex')};
 });
 const source={...ukPowerLineSource,manifest:{...ukPowerLineSource.manifest,tiling:{...ukPowerLineSource.manifest.tiling,tiles}}};
 const reader=new LFQOPowerLineTiles(async url=>{requests.push(url);return fail?new Response(null,{status:503}):new Response(bodies.get(url.slice(source.base.length)));},source);
 const store=new PowerLineMemoryStore(async url=>{overpass.push(url);throw Error('No Overpass in UK');});
 class Shared extends PreparationPowerLineRuntime {constructor(p){super(p,store,undefined,undefined,undefined,undefined,{allowOverpassFallback:false,ukTiles:reader});}}
 const runtime=lazy?new FlightPowerLineRuntime(s=>states.push(s),undefined,{store,load:async()=>({PreparationPowerLineRuntime:Shared})}):new Shared(s=>states.push(s));
 return {runtime,requests,states,overpass,get state(){return states.at(-1);}};
}
test('UK exact published version, full extraction footprint and prefetch protection including all four nations',()=>{
 assert.match(UK_POWER_LINE_BASE,/united-kingdom\/20261114-ef6fe7f1963aeca9\/$/);
 assert.equal(ukPowerLineSource.manifest.tiling.tiles.length,5864);
 assert.equal(ukPowerLineSource.manifest.country_profile.code,'GB');
 assert.equal(ukPowerLineSource.manifest.sources[0].snapshot_at_utc,'2026-11-14T21:20:41Z');
 for(const view of [london,belfast,{west:-3.2,east:-3.18,south:55.95,north:55.96},{west:-3.19,east:-3.17,south:51.48,north:51.49}]){assert.equal(ukPowerLineCoverage(view),'FULL');assert.equal(preparationPowerLineCoverage(view),'FULL');}
 assert.equal(ukPowerLineCoverage({west:15,east:16,south:30,north:31}),'OUTSIDE');
 assert.equal(ukPowerLineCoverage(edge),'PARTIAL');
});
for(const lazy of [false,true]) test(`UK shared ${lazy?'flight/journal/picker lazy adapter':'preparation reader'}: filter, viewport, cache, dedup and no Overpass`,async()=>{
 const h=harness({lazy});await h.runtime.update(london,true,false,false);assert.equal(h.requests.length,0);
 await h.runtime.update(london,true);assert.ok(h.requests.length>0);assert.match(h.state.coverageLabel,/Royaume-Uni R2.*non exhaustif/);
 assert.equal(h.state.covered,true);assert.equal(h.state.data.features.length,1);
 const count=h.requests.length;await h.runtime.update(london,true);assert.equal(h.requests.length,count);
 await h.runtime.update(belfast,true);assert.ok(h.requests.length>count);
 assert.ok(h.requests.every(url=>url.startsWith(UK_POWER_LINE_BASE)));
 assert.equal(h.overpass.length,0);h.runtime.stop();
});
test('UK partial and failed tiles stay explicit, offline does not fetch or claim safety',async()=>{
 const h=harness({fail:true});await h.runtime.update(london,true);assert.equal(h.state.covered,false);assert.match(h.state.coverageLabel,/HTTP 503/);
 await h.runtime.update(edge,false);assert.equal(h.state.covered,false);assert.match(h.state.coverageLabel,/couverture partielle/);
 assert.equal(h.state.offline,true);assert.equal(h.overpass.length,0);
});
test('all four maps retain the shared loader path',async()=>{
 for(const file of ['../components/flight/FlightMap.tsx','../components/journal/JournalFlightMap.tsx','../components/prepare/LaunchPointMapDialog.tsx']){
  const s=await readFile(new URL(file,import.meta.url),'utf8');assert.match(s,/new FlightPowerLineRuntime\(/);assert.doesNotMatch(s,/new PowerLineRuntime\(/);
 }
 const s=await readFile(new URL('../components/PreparationMap.tsx',import.meta.url),'utf8');assert.match(s,/new PreparationPowerLineRuntime\(/);
});
