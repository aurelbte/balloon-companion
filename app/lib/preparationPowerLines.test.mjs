import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import manifest from '../../public/osm-power/lfqo/6b46a77294ac1b41/manifest.json' with { type: 'json' };
import { LFQOPowerLineTiles, PreparationPowerLineRuntime, lfqoCoverage, mergeLocalPowerLines, preparationPowerLineStatusLabel } from './preparationPowerLines.ts';
import { PowerLineMemoryStore } from './powerLinesRuntime.ts';
import { obstacleQueryBounds } from './obstacles.ts';
const inside = { west: 3.05, east: 3.10, south: 50.67, north: 50.71 };
const all = { west: 2.75, east: 3.4, south: 50.45, north: 50.92 };
const outside = { west: 2.3, east: 2.4, south: 48.8, north: 48.9 };
const asset = async url => new Response(await readFile(new URL('../../public'+url, import.meta.url)));
function harness(fetchLocal = asset) {
  const requests = [], overpass = [], states = [], obstacles = [];
  const tiles = new LFQOPowerLineTiles(async url => { requests.push(url); return fetchLocal(url); });
  const store = new PowerLineMemoryStore(async url => {
    overpass.push(url);
    const params = new URL(url, 'https://bc.test').searchParams;
    const bounds = Object.fromEntries(['west','east','south','north'].map(k => [k,Number(params.get(k))]));
    const fetchedAt = new Date().toISOString();
    return Response.json({ type: 'FeatureCollection', features: [], bounds, fetchedAt, complete: true, rejectedElements: 0, emptyConfirmed: true,
      obstacles: { type: 'FeatureCollection', features: [], bounds: obstacleQueryBounds(bounds), fetchedAt, complete: true, rejectedElements: 0, emptyConfirmed: true } });
  });
  const runtime = new PreparationPowerLineRuntime(state => states.push(state), store, state => obstacles.push(state), tiles, null);
  return { runtime, requests, overpass, states, obstacles, tiles, get state() { return states.at(-1); } };
}
test('circle coverage is independent of the surrounding XYZ rectangles; crossing views are explicit partial coverage', () => {
  assert.equal(lfqoCoverage(inside), 'FULL');
  assert.equal(lfqoCoverage(all), 'PARTIAL');
  assert.equal(lfqoCoverage(outside), 'OUTSIDE');
  assert.equal(lfqoCoverage({ west: 3.33, east: 3.35, south: 50.85, north: 50.86 }), 'OUTSIDE');
});
test('LFQO loads only intersecting local XYZ tiles, no Overpass; requests deduplicate and subsequent views use immutable cache', async () => {
  const h = harness();
  await Promise.all([h.runtime.update(inside,true), h.runtime.update(inside,true)]);
  assert.equal(h.overpass.length,0);
  assert.equal(h.requests.length,h.tiles.tiles(inside).length);
  assert.equal(new Set(h.requests).size,h.requests.length);
  assert.ok(h.requests.every(url => url.startsWith('/osm-power/lfqo/6b46a77294ac1b41/tiles/11/')));
  assert.equal(h.state.covered,true);
  assert.equal(h.state.status,'AVAILABLE');
  assert.match(preparationPowerLineStatusLabel(h.state),/vue couverte/);
  assert.match(preparationPowerLineStatusLabel(h.state),/2026-11-08/);
  assert.match(preparationPowerLineStatusLabel(h.state),/non exhaustif/);
  const count=h.requests.length;
  await h.runtime.update(inside,true);await h.runtime.update(inside,false);
  assert.equal(h.requests.length,count);assert.equal(h.state.offline,true);
  assert.ok(h.state.data.features.length>0);
});
test('filtered actual tiles merge into unique overhead ways at >= 63000 V, without Overpass', async () => {
  const h=harness();await h.runtime.update(all,true);
  assert.equal(h.requests.length,manifest.statistics.tiles);
  assert.equal(h.state.data.features.length,manifest.statistics.features);
  assert.equal(new Set(h.state.data.features.map(f=>f.id)).size,h.state.data.features.length);
  assert.equal(h.state.data.features.filter(f=>f.properties.power==='minor_line').length,0);
  assert.ok(h.state.data.features.every(f=>f.properties.power==='line' && f.properties.voltage_max_v>=63000));
  assert.equal(h.state.data.features.filter(f=>f.properties.voltage===null).length,0);
  assert.equal(h.state.covered,false);
  assert.match(h.state.coverageLabel,/couverture partielle.*extérieur du disque non chargé/);
  assert.equal(h.overpass.length,0);
});
test('tile boundaries merge continuations, reversed duplicates and repeated edge geometry without dropping fragments', () => {
  const f=coords=>({type:'Feature',id:'way/42',properties:{power:'line',voltage:'225000'},geometry:{type:'LineString',coordinates:coords}});
  const result=mergeLocalPowerLines([f([[3,50],[3.1,50]]),f([[3.1,50],[3.2,50]]),f([[3.1,50],[3,50]])]);
  assert.equal(result.features.length,1);
  assert.equal(result.features[0].geometry.type,'LineString');
  assert.deepEqual(result.features[0].geometry.coordinates,[[3,50],[3.1,50],[3.2,50]]);
  assert.equal(result.features[0].properties.voltage,'225000');
});
test('entirely outside LFQO preserves the existing Overpass runtime and does not request local tiles', async () => {
  const h=harness();await h.runtime.update(outside,true);
  assert.equal(h.requests.length,0);assert.equal(h.overpass.length,1);
  assert.equal(h.state.status,'EMPTY_CONFIRMED');
  assert.match(h.state.coverageLabel,/Hors extrait local LFQO.*Overpass/);
});
test('failed or wrong-version local tiles are explicit missing data, never an Overpass fallback, and can be retried', async () => {
  let fail=true;
  const h=harness(async url=>fail?new Response('wrong asset'):asset(url));
  await h.runtime.update(inside,true);
  assert.equal(h.state.status,'UNAVAILABLE');assert.equal(h.state.covered,false);
  assert.match(h.state.coverageLabel,/empreinte.*SHA-256/);
  assert.equal(h.overpass.length,0);
  fail=false;await h.runtime.update(inside,true);
  assert.equal(h.state.status,'AVAILABLE');assert.equal(h.overpass.length,0);
});
test('partial tile failure retains successfully loaded fragments and exposes incomplete coverage', async () => {
  let broken;
  const h=harness(async url=>{broken??=url;return url===broken?new Response(null,{status:404}):asset(url);});
  await h.runtime.update(all,true);
  assert.equal(h.state.status,'INCOMPLETE');assert.ok(h.state.data.features.length>0);
  assert.equal(h.state.covered,false);assert.equal(h.overpass.length,0);
  const count=h.requests.length;await h.runtime.update(all,false);
  assert.equal(h.requests.length,count);assert.ok(h.state.data.features.length>0);
});
test('late local responses cannot overwrite a viewport outside LFQO or a stopped runtime', async () => {
  let release;const gate=new Promise(resolve=>release=resolve);
  const h=harness(async url=>{await gate;return asset(url);});
  const pending=h.runtime.update(inside,true);
  await h.runtime.update(outside,true);
  const accepted=h.state;release();await pending;
  assert.equal(h.state,accepted);assert.match(h.state.coverageLabel,/Overpass/);
  const offline=harness();await offline.runtime.update(inside,false);
  assert.equal(offline.requests.length,0);assert.equal(offline.state.status,'UNAVAILABLE');
});
test('obstacles keep their existing acquisition while the electric line collection stays local', async () => {
  const h=harness();await h.runtime.update(inside,true,true);
  assert.equal(h.overpass.length,1);
  assert.equal(new URL(h.overpass[0],'https://bc.test').searchParams.get('obstacles'),'1');
  assert.equal(h.obstacles.at(-1).status,'EMPTY_CONFIRMED');
  assert.equal(h.state.status,'AVAILABLE');assert.match(h.state.coverageLabel,/Extrait local LFQO/);
  assert.ok(h.state.data.features.every(f=>String(f.id).startsWith('way/')));
});

test('outside fallback still shares one combined request with obstacles, and snapshot labels never claim browser retrieval dates', async () => {
  const h=harness();await h.runtime.update(outside,true,true);
  assert.equal(h.overpass.length,1);
  assert.equal(new URL(h.overpass[0],'https://bc.test').searchParams.get('obstacles'),'1');
  const local=harness();await local.runtime.update(inside,true);
  const label=preparationPowerLineStatusLabel(local.state);
  assert.match(label,/OSM du 2026-11-08/);assert.doesNotMatch(label,/Récupérées le/);
});

test('switching between local LFQO and outside coverage never mixes both collections', async () => {
  const h=harness();await h.runtime.update(inside,true);
  assert.ok(h.state.data.features.length>0);
  await h.runtime.update(outside,true);
  assert.equal(h.state.data.features.length,0);assert.equal(h.state.localCoverage,undefined);
  await h.runtime.update(inside,true);
  assert.ok(h.state.data.features.length>0);assert.equal(h.state.localCoverage,'FULL');
});

test('stopping an in-flight local load suppresses late callbacks', async () => {
  let release;const gate=new Promise(resolve=>release=resolve);
  const h=harness(async url=>{await gate;return asset(url);});
  const pending=h.runtime.update(inside,true);
  h.runtime.stop();const count=h.states.length;release();await pending;
  assert.equal(h.states.length,count);
});
