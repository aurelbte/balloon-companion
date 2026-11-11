import test from 'node:test';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the real activation effect independently of WebGL and unrelated map layers.
const source = readFileSync(new URL('./PreparationMap.tsx', import.meta.url), 'utf8');
const start = source.indexOf('  useEffect(() => {\n    const map = mapRef.current;\n    if (!map) return;\n    const sync = () => {\n      for (const layerId of [POWER_LINES_CASING_LAYER');
assert.ok(start >= 0);
const end = source.indexOf('  }, [showPowerLines]);', start) + '  }, [showPowerLines]);'.length;
const run = new Function('useEffect', 'mapRef', 'powerLineRuntimeRef', 'showPowerLines', 'showObstaclesRef', 'navigator', 'POWER_LINES_CASING_LAYER', 'POWER_LINES_LAYER', 'POWER_LINES_SOURCE', 'OBSTACLE_MIN_ZOOM', source.slice(start, end));
function harness() {
 let loaded = true, zoom = 12, listener, cleanup;
 const layouts = [], updates = [];
 const map = {
  getSource: () => loaded ? {} : undefined,
  getLayer: () => loaded ? {} : undefined,
  setLayoutProperty: (...args) => layouts.push(args),
  getBounds: () => ({ getWest: () => 2, getSouth: () => 50, getEast: () => 2.1, getNorth: () => 50.1 }),
  getZoom: () => zoom,
  once(event, fn) { assert.equal(event, 'load'); listener = fn; },
  off(event, fn) { if (listener === fn) listener = undefined; },
 };
 return { updates, layouts,
  loaded(value) { loaded = value; }, zoom(value) { zoom = value; },
  render(enabled, obstacles = false, online = true) {
   cleanup?.();
   run(fn => { cleanup = fn(); }, { current: map }, { current: { update: (...args) => updates.push(args) } }, enabled, { current: obstacles }, { onLine: online }, 'casing', 'line', 'source', 11);
  },
  load() { loaded = true; const fn = listener; listener = undefined; fn?.(); },
 };
}
test('enabling lines after an initial failed load retries immediately without movement or changing the rendering', () => {
 const h = harness(); h.render(false); assert.equal(h.updates.length, 0);
 h.render(true); assert.equal(h.updates.length, 1);
 assert.deepEqual(h.updates[0], [{ west: 2, south: 50, east: 2.1, north: 50.1 }, true, false]);
 assert.deepEqual(h.layouts.slice(-2), [['casing', 'visibility', 'visible'], ['line', 'visibility', 'visible']]);
 h.render(false); assert.equal(h.updates.length, 1);
 assert.deepEqual(h.layouts.slice(-2), [['casing', 'visibility', 'none'], ['line', 'visibility', 'none']]);
});
test('activation before map load requests once sources exist; cancellation removes the pending handler', () => {
 const h = harness(); h.loaded(false); h.render(true); assert.equal(h.updates.length, 0);
 h.load(); assert.equal(h.updates.length, 1);
 const cancelled = harness(); cancelled.loaded(false); cancelled.render(true); cancelled.render(false); cancelled.load();
 assert.equal(cancelled.updates.length, 0);
});
test('activation preserves obstacle zoom gating and uses offline cache when disconnected', () => {
 const h = harness(); h.render(true, true, true); assert.equal(h.updates[0][2], true);
 h.zoom(10); h.render(true, true, false); assert.deepEqual(h.updates[1].slice(1), [false, false]);
});

test('arrival prefetch cannot trigger Overpass outside an LFQO viewport, while outside views keep their legacy prefetch', async () => {
 const { lfqoCoverage } = await import('../lib/preparationPowerLines.ts');
 const start=source.indexOf('  useEffect(() => {\n    const runtime = powerLineRuntimeRef.current;\n    const map = mapRef.current;\n    if (!runtime || !map || !navigator.onLine) return;');
 assert.ok(start>=0);
 const end=source.indexOf('  }, [traces, visibleTraceIds]);',start)+'  }, [traces, visibleTraceIds]);'.length;
 const effect=new Function('useEffect','powerLineRuntimeRef','mapRef','navigator','traces','visibleTraceIds','powerLineStateRef','showObstaclesRef','OBSTACLE_MIN_ZOOM','lfqoCoverage',ts.transpileModule(source.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText);
 const inside={west:3.05,east:3.1,south:50.67,north:50.71},outside={west:2.3,east:2.4,south:48.8,north:48.9};
 for(const view of [inside,outside]){
  const calls=[];
  const map={getZoom:()=>12,getBounds:()=>({getWest:()=>view.west,getEast:()=>view.east,getSouth:()=>view.south,getNorth:()=>view.north})};
  const traces=[{traceId:'local',projection:{points:[{latitude:50.68722,longitude:3.07556}]}},{traceId:'outside',projection:{points:[{latitude:48.85,longitude:2.35}]}}];
  let cleanup;
  effect(fn=>{cleanup=fn();},{current:{update:async bounds=>calls.push(bounds),stop(){}}},{current:map},{onLine:true},traces,['local','outside'],{current:{covered:true}},{current:false},11,lfqoCoverage);
  await new Promise(resolve=>setImmediate(resolve));
  if(view===inside)assert.equal(calls.length,1); // only the visible local view, no arrival viewport
  else {assert.equal(calls.length,3);assert.ok(calls.every(b=>lfqoCoverage(b)==='OUTSIDE'));}
  cleanup();
 }
});
