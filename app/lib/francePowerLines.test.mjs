import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LFQOPowerLineTiles, PreparationPowerLineRuntime, preparationPowerLineCoverage, belgiumPowerLineSource, francePowerLineSource, FRANCE_POWER_LINE_BASE } from './preparationPowerLines.ts';
import { belgiumPowerLineCountryCoverage } from './belgiumPowerLineCoverage.ts';
import { francePowerLineCoverage } from './francePowerLineCoverage.ts';
import { PowerLineMemoryStore } from './powerLinesRuntime.ts';
import { obstacleQueryBounds } from './obstacles.ts';
const paris = { west: 2.34, east: 2.35, south: 48.85, north: 48.86 };
const bondues = { west: 3.07, east: 3.08, south: 50.68, north: 50.69 };
const brussels = { west: 4.34, east: 4.35, south: 50.84, north: 50.85 };
const border = { west: 2.8, east: 4.6, south: 50.3, north: 51.1 };
const madrid = { west: -3.75, east: -3.65, south: 40.4, north: 40.5 };
function harness({ fail = () => false, gate } = {}) {
  const requests = [], local = [], overpass = [], states = [], obstacles = [];
  let running = 0, peak = 0;
  const provider = (config, name) => {
    const bodies = new Map();
    const tiles = config.manifest.tiling.tiles.map(tile => {
      const [z,x,y] = tile.key.match(/\d+/g).map(Number), n = 2 ** z;
      const lat = row => Math.atan(Math.sinh(Math.PI * (1 - 2 * row / n))) * 180 / Math.PI;
      const features = tile.features ? [{ type: 'Feature', id: 'way/42', properties: { power: 'line', voltage: '20000;63000', voltage_max_v: 63000, location: 'overhead', source: name },
        geometry: { type: 'LineString', coordinates: [[x/n*360-180,lat(y)],[(x+1)/n*360-180,lat(y+1)]] } }] : [];
      const body = JSON.stringify({ type: 'FeatureCollection', features }); bodies.set(tile.key, body);
      return { ...tile, features: features.length, sha256: createHash('sha256').update(body).digest('hex') };
    });
    const source = { ...config, manifest: { ...config.manifest, tiling: { ...config.manifest.tiling, tiles } } };
    return new LFQOPowerLineTiles(async (url, options) => {
      requests.push({ name, url, cache: options.cache }); running++; peak = Math.max(peak, running);
      try { if (gate) await gate; return fail(name, url) ? new Response(null, { status: 503 }) : new Response(bodies.get(url.slice(source.base.length))); }
      finally { running--; }
    }, source);
  };
  const fr = provider(francePowerLineSource, 'France'), be = provider(belgiumPowerLineSource, 'Belgique');
  const store = new PowerLineMemoryStore(async url => {
    overpass.push(url); const p = new URL(url, 'https://test.invalid').searchParams;
    const bounds = Object.fromEntries(['west','south','east','north'].map(k => [k, Number(p.get(k))]));
    const base = { type: 'FeatureCollection', features: [], complete: true, rejectedElements: 0, emptyConfirmed: true, fetchedAt: new Date().toISOString() };
    return Response.json(p.get('lines') === '0' ? { obstacles: { ...base, bounds: obstacleQueryBounds(bounds) } } : { ...base, bounds });
  });
  const lfqo = new LFQOPowerLineTiles(async url => { local.push(url); throw new Error('LFQO must not duplicate national data'); });
  const runtime = new PreparationPowerLineRuntime(s => states.push(s), store, s => obstacles.push(s), lfqo, be, fr);
  return { runtime, fr, be, requests, local, overpass, states, obstacles, get state() { return states.at(-1); }, get peak() { return peak; } };
}
test('France published manifest, Corsica and preparation prefetch use the exact existing coverage mechanism', () => {
  assert.match(FRANCE_POWER_LINE_BASE, /france\/20261112-7d80f1b5392852da\/$/);
  assert.equal(francePowerLineSource.manifest.tiling.tiles.length, 4573);
  assert.equal(francePowerLineCoverage(paris), 'FULL'); assert.equal(francePowerLineCoverage(bondues), 'FULL');
  assert.equal(francePowerLineCoverage({west:9.14,east:9.16,south:42.30,north:42.32}), 'FULL');
  assert.equal(francePowerLineCoverage(brussels), 'OUTSIDE'); assert.equal(francePowerLineCoverage(madrid), 'OUTSIDE');
  assert.equal(preparationPowerLineCoverage(paris), 'FULL');
});
test('France wins in Paris and LFQO, Belgium in Brussels; layer off requests nothing and source changes never mix cached ways', async () => {
  const h = harness(); await h.runtime.update(paris, true, false, false);
  assert.equal(h.requests.length, 0); assert.equal(h.overpass.length, 0);
  for (const [view, name] of [[paris,'France'],[bondues,'France'],[brussels,'Belgique']]) {
    const start = h.requests.length; await h.runtime.update(view, true);
    assert.ok(h.requests.length > start); assert.ok(h.requests.slice(start).every(r => r.name === name));
    assert.match(h.state.coverageLabel, new RegExp(name + ' R2.*vue couverte'));
    assert.ok(h.state.data.features.length > 0); assert.ok(h.state.data.features.every(f => f.properties.source === name));
    assert.ok(h.state.data.features.every(f => f.properties.power === 'line' && f.properties.voltage_max_v >= 63000));
  }
  assert.equal(h.local.length, 0); assert.equal(h.overpass.length, 0);
  await h.runtime.update(madrid, true); assert.equal(h.overpass.length, 1); assert.equal(h.state.data.features.length, 0);
});
test('frontier views merge national OSM fragments once, show partial coverage and never mix LFQO or electric Overpass', async () => {
  const h = harness(); await h.runtime.update(border, true);
  assert.ok(h.requests.some(r => r.name === 'France')); assert.ok(h.requests.some(r => r.name === 'Belgique'));
  assert.equal(h.local.length, 0); assert.equal(h.overpass.length, 0);
  assert.equal(h.state.covered, false); assert.match(h.state.coverageLabel, /zones hors extraits non chargées/);
  assert.equal(h.state.data.features.length, 1); assert.equal(h.state.data.features[0].id, 'way/42');
});
test('France errors and offline gaps remain explicit, without hidden LFQO/Overpass fallback; retry verifies the same source', async () => {
  let fail = true; const h = harness({ fail: name => name === 'France' && fail });
  await h.runtime.update(bondues, true);
  assert.equal(h.state.status, 'UNAVAILABLE'); assert.match(h.state.coverageLabel, /France R2.*HTTP 503/);
  assert.equal(h.local.length, 0); assert.equal(h.overpass.length, 0);
  const count = h.requests.length; await h.runtime.update(bondues, false); assert.equal(h.requests.length, count);
  fail = false; await h.runtime.update(bondues, true);
  assert.equal(h.state.status, 'AVAILABLE'); assert.ok(h.requests.some(r => r.cache === 'reload'));
});
test('wide France view uses batches of at most six and discards queued requests and callbacks after deactivation', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); const h = harness({ gate });
  const wide = { west: 1.9, east: 2.8, south: 48.5, north: 49.1 };
  assert.ok(h.fr.tiles(wide).length > 6);
  const pending = h.runtime.update(wide, true); assert.equal(h.requests.length, 6);
  await h.runtime.update(wide, true, false, false);
  const count = h.states.length; release(); await pending;
  assert.equal(h.requests.length, 6); assert.equal(h.peak, 6); assert.equal(h.states.length, count);
  await h.runtime.update(paris, true);
  assert.equal(h.state.status, 'AVAILABLE'); assert.equal(h.overpass.length, 0);
  const after = h.requests.length; await h.runtime.update(paris, false); assert.equal(h.requests.length, after);
});
test('France obstacles preserve their acquisition without electric queries', async () => {
  const h = harness(); await h.runtime.update(paris, true, true);
  assert.ok(h.overpass.length > 0); assert.ok(h.overpass.every(url => new URL(url,'https://test.invalid').searchParams.get('lines') === '0'));
  assert.equal(h.obstacles.at(-1).status, 'EMPTY_CONFIRMED'); assert.equal(h.state.status, 'AVAILABLE');
});


test('overlapping Geofabrik masks use the OSM country boundary rather than guessing country from extract bounds', async () => {
  const h = harness();
  for (const [lon, lat, name, territory] of [[3.6698604285010012,50.4166709,'France','OUTSIDE'],[3.67544203546868,50.38930045,'Belgique','FULL']]) {
    const view = {west:lon-0.000001,east:lon+0.000001,south:lat-0.000001,north:lat+0.000001};
    assert.equal(francePowerLineSource.coverage(view), 'FULL'); assert.equal(belgiumPowerLineSource.coverage(view), 'FULL');
    assert.equal(belgiumPowerLineCountryCoverage(view), territory);
    const start = h.requests.length; await h.runtime.update(view, true);
    assert.ok(h.requests.length > start); assert.ok(h.requests.slice(start).every(r => r.name === name));
    assert.match(h.state.coverageLabel, new RegExp(name + ' R2'));
  }
  assert.equal(h.local.length, 0); assert.equal(h.overpass.length, 0);
});
