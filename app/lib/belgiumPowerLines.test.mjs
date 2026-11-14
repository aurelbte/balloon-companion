import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import manifest from './data/belgiumPowerLinesManifest.json' with { type: 'json' };
import { belgiumPowerLineCoverage } from './belgiumPowerLineCoverage.ts';
import { LFQOPowerLineTiles, PreparationPowerLineRuntime, BELGIUM_POWER_LINE_BASE, belgiumPowerLineSource, preparationPowerLineCoverage } from './preparationPowerLines.ts';
import { PowerLineMemoryStore } from './powerLinesRuntime.ts';
import { obstacleQueryBounds } from './obstacles.ts';
const brussels = { west: 4.34, east: 4.35, south: 50.84, north: 50.85 };
const lfqo = { west: 3.05, east: 3.1, south: 50.67, north: 50.71 };
const paris = { west: 2.3, east: 2.4, south: 48.8, north: 48.9 };
const whole = { west: 2.2, east: 6.5, south: 49.4, north: 51.7 };
function harness({ properties = {}, fail = () => false, gate } = {}) {
  const bodies = new Map(), requests = [], overpass = [], states = [], obstacles = [];
  const tiles = manifest.tiling.tiles.map(tile => {
    const [w,s,e,n] = tile.bbox;
    const features = tile.status === 'empty' ? [] : [{ type: 'Feature', id: 'way/42', properties: { power: 'line', voltage: '20000;63000', voltage_max_v: 63000, location: 'overhead', ...properties }, geometry: { type: 'LineString', coordinates: [[w,s],[e,n]] } }];
    const body = JSON.stringify({ type: 'FeatureCollection', features }); bodies.set(tile.key, body);
    return { ...tile, features: features.length, sha256: createHash('sha256').update(body).digest('hex') };
  });
  const source = { ...belgiumPowerLineSource, manifest: { ...manifest, tiling: { ...manifest.tiling, tiles } } };
  const country = new LFQOPowerLineTiles(async (url, options) => {
    assert.ok(url.startsWith(BELGIUM_POWER_LINE_BASE)); requests.push({ url, cache: options.cache });
    if (gate) await gate;
    const key = url.slice(BELGIUM_POWER_LINE_BASE.length);
    return fail(key) ? new Response(null, { status: 404 }) : new Response(bodies.get(key));
  }, source);
  const store = new PowerLineMemoryStore(async url => {
    overpass.push(url);
    const params = new URL(url, 'https://test.invalid').searchParams;
    const bounds = Object.fromEntries(['west','south','east','north'].map(k => [k, Number(params.get(k))]));
    const base = { type: 'FeatureCollection', features: [], fetchedAt: new Date().toISOString(), complete: true, rejectedElements: 0, emptyConfirmed: true };
    return Response.json(params.get('lines') === '0' ? { obstacles: { ...base, bounds: obstacleQueryBounds(bounds) } } : { ...base, bounds });
  });
  const local = new LFQOPowerLineTiles(async url => new Response(await readFile(new URL('../../public' + url, import.meta.url))));
  const runtime = new PreparationPowerLineRuntime(state => states.push(state), store, state => obstacles.push(state), local, country, null);
  return { runtime, country, requests, overpass, states, obstacles, store, get state() { return states.at(-1); } };
}
test('Belgian manifest pins published XYZ hashes, exact footprint and explicit empty cells', () => {
  assert.equal(manifest.version, '20261108-db4ecb06f9ec03a1'); assert.equal(manifest.filter.min_voltage_v, 63000);
  assert.equal(manifest.tiling.tiles.length, 268); assert.equal(manifest.tiling.tiles.filter(t => t.status === 'empty').length, 73);
  assert.equal(belgiumPowerLineCoverage(brussels), 'FULL'); assert.equal(belgiumPowerLineCoverage(whole), 'PARTIAL');
  assert.equal(belgiumPowerLineCoverage(paris), 'OUTSIDE');
  assert.equal(belgiumPowerLineCoverage({west:2.35,east:2.36,south:49.50,north:49.51}), 'OUTSIDE'); // Inside bbox, outside polygon.
  assert.equal(preparationPowerLineCoverage(brussels), 'FULL');
});
test('Belgian tiles load only when enabled, by viewport; share pending/cache and merge OSM fragments without Overpass', async () => {
  const h = harness();
  await h.runtime.update(brussels, true, false, false); assert.equal(h.requests.length, 0); assert.equal(h.overpass.length, 0);
  await Promise.all([h.runtime.update(brussels, true), h.runtime.update(brussels, true)]);
  assert.equal(h.overpass.length, 0); assert.equal(h.requests.length, h.country.tiles(brussels).length);
  assert.equal(new Set(h.requests.map(r => r.url)).size, h.requests.length);
  assert.equal(h.state.status, 'AVAILABLE'); assert.equal(h.state.data.features.length, 1);
  assert.ok(h.state.data.features.every(f => f.properties.power === 'line' && f.properties.voltage_max_v >= 63000));
  assert.match(h.state.coverageLabel, /Belgique R2.*vue couverte.*2026-11-08/);
  const count = h.requests.length;
  await h.runtime.update(brussels, false); assert.equal(h.requests.length, count); assert.equal(h.state.offline, true);
  await h.runtime.update(brussels, true, false, false); assert.equal(h.requests.length, count);
  await h.runtime.update(paris, true); assert.equal(h.overpass.length, 1); assert.equal(h.state.data.features.length, 0);
});
test('Belgian failures, empty tiles and uncovered borders are explicit; retries never use electric Overpass', async () => {
  let broken = true;
  const key = harness().country.tiles(brussels)[0].key;
  const h = harness({ fail: k => broken && k === key });
  await h.runtime.update(brussels, true);
  assert.equal(h.overpass.length, 0); assert.equal(h.state.covered, false); assert.equal(h.state.status, 'INCOMPLETE');
  assert.match(h.state.coverageLabel, /HTTP 404/);
  broken = false; await h.runtime.update(brussels, true);
  assert.equal(h.state.covered, true); assert.ok(h.requests.some(r => r.cache === 'reload'));
  await h.runtime.update(whole, true);
  assert.equal(h.overpass.length, 0); assert.equal(h.state.covered, false); assert.match(h.state.coverageLabel, /zones hors extraits non chargées/);
  assert.ok(h.state.tileDiagnostics.some(t => t.status === 'EMPTY'));
  assert.equal(new Set(h.state.data.features.map(f => f.id)).size, h.state.data.features.length);
  const local = harness(); await local.runtime.update(lfqo, true);
  assert.equal(local.requests.length, 0); assert.match(local.state.coverageLabel, /Extrait local LFQO/);
});
test('verified SHA does not allow minor_line, missing/low voltage or underground lines into the Belgian source', async () => {
  for (const properties of [{power:'minor_line'}, {voltage:'unknown'}, {voltage:'60000',voltage_max_v:60000}, {location:'underground'}]) {
    const h = harness({ properties }); await h.runtime.update(brussels, true);
    assert.equal(h.state.status, 'UNAVAILABLE'); assert.ok(h.state.tileDiagnostics.every(t => t.status === 'INVALID_DATA'));
    assert.equal(h.state.data.features.length, 0); assert.equal(h.overpass.length, 0);
  }
});
test('Belgian obstacles retain their data but never request electric lines; disabling suppresses late tile callbacks', async () => {
  const h = harness(); await h.runtime.update(brussels, true, true, false);
  assert.equal(h.requests.length, 0); assert.equal(h.overpass.length, 1);
  assert.equal(new URL(h.overpass[0], 'https://test.invalid').searchParams.get('lines'), '0');
  assert.equal(h.store.results.size, 0); assert.equal(h.obstacles.at(-1).status, 'EMPTY_CONFIRMED');
  await h.runtime.update(brussels, true, true, true); assert.equal(h.overpass.length, 1); assert.equal(h.state.status, 'AVAILABLE');
  let release; const gate = new Promise(resolve => { release = resolve; }); const slow = harness({ gate });
  const pending = slow.runtime.update(brussels, true); await slow.runtime.update(brussels, true, false, false);
  const count = slow.states.length; release(); await pending; assert.equal(slow.states.length, count);
});
