import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { preparationPowerLineStatusLabel } from '../lib/tiledPowerLineStatus.ts';
const require=createRequire(import.meta.url);
const source=readFileSync(new URL('./PowerLineInformation.tsx',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function harness(t){
 let cursor=0,pending=[];const slots=[],timers=new Map();let timerId=0;
 const previous=globalThis.window;globalThis.window={setTimeout:(fn,ms)=>{assert.equal(ms,8000);timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
 const react={useState(initial){const i=cursor++;slots[i]??={value:initial};return [slots[i].value,v=>{slots[i].value=v;}];},useEffect(fn,deps){const i=cursor++;const old=slots[i];if(!old||deps.some((d,j)=>d!==old.deps[j])){slots[i]={deps};pending.push(()=>{old?.cleanup?.();slots[i].cleanup=fn();});}}};
 const exports={};new Function('require','exports',js)(id=>id==='react'?react:id==='../lib/tiledPowerLineStatus'?{preparationPowerLineStatusLabel}:require(id),exports);
 t.after(()=>{slots.forEach(s=>s.cleanup?.());globalThis.window=previous;});
 return {...exports,timers,render(props){cursor=0;let tree=exports.PowerLineWarning(props);const effects=pending;pending=[];effects.forEach(fn=>fn());cursor=0;tree=exports.PowerLineWarning(props);return tree;},expire(){for(const [id,fn]of timers){timers.delete(id);fn();}}};
}
function text(node){if(typeof node==='string')return node;if(Array.isArray(node))return node.map(text).join('');return node?.props?text(node.props.children):'';}
const full={status:'AVAILABLE',covered:true,loading:false,offline:false,localCoverage:'FULL',coverageLabel:'Royaume-Uni R2 · OSM du 2026-11-14 · non exhaustif',data:{type:'FeatureCollection',features:[]}};
const failed={...full,status:'UNAVAILABLE',covered:false,tileDiagnostics:[{key:'x',status:'HTTP_ERROR',httpStatus:503}],coverageLabel:'Royaume-Uni R2 · OSM du 2026-11-14 · non exhaustif · HTTP 503'};
test('available coverage has no permanent notification; source/date/safety remain behind information control',t=>{
 const h=harness(t);assert.equal(h.render({enabled:true,state:full}),null);assert.equal(h.timers.size,0);
 const info=h.PowerLineInformation({state:full});assert.equal(info.type,'details');assert.equal(info.props.open,undefined);
 assert.match(text(info),/OSM du 2026-11-14/);assert.match(text(info),/OpenStreetMap.*Geofabrik/);assert.match(text(info),/non exhaustives/);assert.match(text(info),/ne garantit jamais/);
});
test('error warning expires after 8 seconds, same persistent error does not restart it, complete diagnostic stays accessible',t=>{
 const h=harness(t);assert.equal(h.render({enabled:true,state:failed}).props.role,'status');assert.equal(h.timers.size,1);
 h.expire();assert.equal(h.render({enabled:true,state:failed}),null);
 assert.equal(h.render({enabled:true,state:{...failed,coverageLabel:failed.coverageLabel+' · 3 fichiers'}}),null);assert.equal(h.timers.size,0);
 const info=h.PowerLineInformation({state:failed});assert.match(text(info),/HTTP 503/);assert.match(info.props.children[0].props['aria-label'],/avertissement/);
 assert.equal(h.render({enabled:true,state:full}),null);
 assert.ok(h.render({enabled:true,state:failed}));assert.equal(h.timers.size,1);
});
test('loading is quiet; partial, outside and offline warn; disabling cancels the timer',t=>{
 const h=harness(t);assert.equal(h.render({enabled:true,state:{...failed,loading:true}}),null);
 for(const state of [{...full,covered:false,localCoverage:'PARTIAL'},{...full,covered:false,status:'UNKNOWN_COVERAGE'},{...full,offline:true}]){
  assert.ok(h.render({enabled:true,state}));
  assert.equal(h.render({enabled:false,state}),null);assert.equal(h.timers.size,0);
 }
 assert.match(text(h.PowerLineInformation({state:null})),/Couverture non vérifiée/);
});
test('four filters expose information and four maps use transient warnings instead of permanent labels',()=>{
 for(const path of ['../map/page.tsx','./flight/MapOptionsPopover.tsx','./journal/JournalFlightMap.tsx','./prepare/LaunchPointMapDialog.tsx'])assert.match(readFileSync(new URL(path,import.meta.url),'utf8'),/<PowerLineInformation state=/);
 for(const path of ['./PreparationMap.tsx','./flight/FlightMap.tsx','./journal/JournalFlightMap.tsx','./prepare/LaunchPointMapDialog.tsx']){
  const map=readFileSync(new URL(path,import.meta.url),'utf8');assert.match(map,/<PowerLineWarning enabled=/);assert.doesNotMatch(map,/\{preparationPowerLineStatusLabel\(/);
 }
});
