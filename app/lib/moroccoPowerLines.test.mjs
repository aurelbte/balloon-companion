import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { LFQOPowerLineTiles, PreparationPowerLineRuntime, moroccoPowerLineSource, MOROCCO_POWER_LINE_BASE, preparationPowerLineCoverage } from './preparationPowerLines.ts';
import { moroccoPowerLineCoverage } from './moroccoPowerLineCoverage.ts';
import { FlightPowerLineRuntime } from './flightPowerLines.ts';
import { PowerLineMemoryStore } from './powerLinesRuntime.ts';
const marrakech={west:-8.05,east:-7.95,south:31.58,north:31.68};
const rabat={west:-6.9,east:-6.8,south:33.9,north:34};
const edge={west:-13,east:-9,south:30,north:32};
function harness({fail=false,lazy=false}={}) {
 const requests=[],states=[],overpass=[];
 // Deterministic bodies exercise the real published index without requiring local large files or network.
 const bodies=new Map();
 const tiles=moroccoPowerLineSource.manifest.tiling.tiles.map(t=>{
  const data=JSON.stringify({type:'FeatureCollection',features:t.features?[{type:'Feature',id:'way/42',properties:{power:'line',voltage:'20000;225000',voltage_max_v:225000},geometry:{type:'LineString',coordinates:[[-8,31.6],[-7.99,31.61]]}}]:[]});
  bodies.set(t.key,data);return {...t,features:t.features?1:0,sha256:createHash('sha256').update(data).digest('hex')};
 });
 const source={...moroccoPowerLineSource,manifest:{...moroccoPowerLineSource.manifest,tiling:{...moroccoPowerLineSource.manifest.tiling,tiles}}};
 const reader=new LFQOPowerLineTiles(async url=>{requests.push(url);return fail?new Response(null,{status:503}):new Response(bodies.get(url.slice(source.base.length)));},source);
 const store=new PowerLineMemoryStore(async url=>{overpass.push(url);throw Error('No Overpass in Morocco');});
 class Shared extends PreparationPowerLineRuntime {constructor(p){super(p,store,undefined,undefined,undefined,undefined,{allowOverpassFallback:false,moroccoTiles:reader});}}
 const runtime=lazy?new FlightPowerLineRuntime(s=>states.push(s),undefined,{store,load:async()=>({PreparationPowerLineRuntime:Shared})}):new Shared(s=>states.push(s));
 return {runtime,requests,states,overpass,get state(){return states.at(-1);}};
}
test('Morocco exact published version, full extraction footprint and prefetch protection beyond Marrakech',()=>{
 assert.match(MOROCCO_POWER_LINE_BASE,/morocco\/20261113-ce974015b19780e1\/$/);
 assert.equal(moroccoPowerLineSource.manifest.tiling.tiles.length,3455);
 assert.equal(moroccoPowerLineSource.manifest.sources[0].snapshot_at_utc,'2026-11-13T21:22:20Z');
 for(const view of [marrakech,rabat]){assert.equal(moroccoPowerLineCoverage(view),'FULL');assert.equal(preparationPowerLineCoverage(view),'FULL');}
 assert.equal(moroccoPowerLineCoverage({west:2,east:3,south:48,north:49}),'OUTSIDE');
 assert.equal(moroccoPowerLineCoverage(edge),'PARTIAL');
});
for(const lazy of [false,true]) test(`Morocco shared ${lazy?'flight/journal/picker lazy adapter':'preparation reader'}: filter, viewport, cache, dedup and no Overpass`,async()=>{
 const h=harness({lazy});await h.runtime.update(marrakech,true,false,false);assert.equal(h.requests.length,0);
 await h.runtime.update(marrakech,true);assert.ok(h.requests.length>0);assert.match(h.state.coverageLabel,/Maroc R2.*non exhaustif/);
 assert.equal(h.state.covered,true);assert.equal(h.state.data.features.length,1);
 const count=h.requests.length;await h.runtime.update(marrakech,true);assert.equal(h.requests.length,count);
 await h.runtime.update(rabat,true);assert.ok(h.requests.length>count);
 assert.ok(h.requests.every(url=>url.startsWith(MOROCCO_POWER_LINE_BASE)));
 assert.equal(h.overpass.length,0);h.runtime.stop();
});
test('Morocco partial and failed tiles stay explicit, offline does not fetch or claim safety',async()=>{
 const h=harness({fail:true});await h.runtime.update(marrakech,true);assert.equal(h.state.covered,false);assert.match(h.state.coverageLabel,/HTTP 503/);
 await h.runtime.update(edge,false);assert.equal(h.state.covered,false);assert.match(h.state.coverageLabel,/couverture partielle/);
 assert.equal(h.state.offline,true);assert.equal(h.overpass.length,0);
});
test('all four maps retain the shared loader path',async()=>{
 for(const file of ['../components/flight/FlightMap.tsx','../components/journal/JournalFlightMap.tsx','../components/prepare/LaunchPointMapDialog.tsx']){
  const s=await readFile(new URL(file,import.meta.url),'utf8');assert.match(s,/new FlightPowerLineRuntime\(/);assert.doesNotMatch(s,/new PowerLineRuntime\(/);
 }
 const s=await readFile(new URL('../components/PreparationMap.tsx',import.meta.url),'utf8');assert.match(s,/new PreparationPowerLineRuntime\(/);
});
