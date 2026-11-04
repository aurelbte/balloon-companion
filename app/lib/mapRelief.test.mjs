import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { syncMapRelief, RELIEF_SOURCE_ID } from './mapRelief.ts';

const baseIds = ['plan-base', 'satellite-base'];
function setup(loaded = true, ids = baseIds) {
  const sources = new Map(), calls = [], listeners = new Set();
  const initial = [
    { id: ids[0], type: 'raster', layout: { visibility: 'visible' } },
    { id: ids[1], type: 'raster', layout: { visibility: 'none' } },
    { id: 'airspaces', type: 'fill' }, { id: 'power-lines', type: 'line' },
    { id: 'bourrous-flight-zone-fill', type: 'fill' }, { id: 'trajectory', type: 'line' },
  ];
  const layers = loaded ? structuredClone(initial) : [];
  const map = {
    getSource: id => sources.get(id), getLayer: id => layers.find(l => l.id === id),
    getStyle: () => ({ layers }),
    addSource(id, value) { calls.push(['source', id]); sources.set(id, value); },
    addLayer(layer, before) { const index = layers.findIndex(l => l.id === before); layers.splice(index < 0 ? layers.length : index, 0, layer); },
    removeLayer(id) { layers.splice(layers.findIndex(l => l.id === id), 1); calls.push(['removeLayer', id]); },
    removeSource(id) { assert.ok(!layers.some(l => l.source === id)); sources.delete(id); calls.push(['removeSource', id]); },
    once(event, fn) { assert.equal(event, 'load'); listeners.add(fn); },
    off(event, fn) { listeners.delete(fn); },
  };
  return { map, sources, layers, calls, initial, load() { layers.push(...structuredClone(initial)); for (const fn of [...listeners]) { listeners.delete(fn); fn(); } } };
}
test('OFF, missing or blank key creates no DEM source or layer', () => {
  for (const [enabled, key] of [[false, 'key'], [true, undefined], [true, '  ']]) {
    const h = setup(); syncMapRelief(h.map, enabled, key, baseIds);
    assert.equal(h.calls.length, 0);
    assert.deepEqual(h.layers, h.initial);
  }
});
test('ON lazily creates Terrain RGB hillshade beneath every existing overlay, without 3D or interaction changes', () => {
  const h = setup(); syncMapRelief(h.map, true, ' key+test ', baseIds);
  assert.equal(h.sources.get(RELIEF_SOURCE_ID).type, 'raster-dem');
  assert.equal(h.sources.get(RELIEF_SOURCE_ID).encoding, 'mapbox');
  assert.equal(h.sources.get(RELIEF_SOURCE_ID).url, 'https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=key%2Btest');
  assert.deepEqual(h.layers.map(l => l.id), ['plan-base', 'satellite-base', 'bc-relief-hillshade', ...h.initial.slice(2).map(l => l.id)]);
  assert.deepEqual(h.layers.filter(l => l.id !== 'bc-relief-hillshade'), h.initial);
  syncMapRelief(h.map, true, 'key+test', baseIds);
  assert.equal(h.calls.length, 1);
});
test('ON to OFF removes layer before source; repeated OFF and movement cannot retain DEM loading', () => {
  const h = setup(); syncMapRelief(h.map, true, 'key', baseIds);
  syncMapRelief(h.map, false, 'key', baseIds);
  assert.equal(h.sources.size, 0);
  assert.deepEqual(h.layers, h.initial);
  assert.deepEqual(h.calls.slice(1).map(c => c[0]), ['removeLayer', 'removeSource']);
  syncMapRelief(h.map, false, 'key', baseIds);
  assert.equal(h.calls.length, 3);
  syncMapRelief(h.map, true, 'key', baseIds);
  assert.equal(h.sources.size, 1);
  assert.equal(h.layers.filter(l => l.type === 'hillshade').length, 1);
});
test('background switching preserves relief and overlay visibility', () => {
  const h = setup(); syncMapRelief(h.map, true, 'key', baseIds);
  const dem = h.sources.get(RELIEF_SOURCE_ID);
  for (const satellite of [true, false, true]) {
    h.map.getLayer('plan-base').layout.visibility = satellite ? 'none' : 'visible';
    h.map.getLayer('satellite-base').layout.visibility = satellite ? 'visible' : 'none';
    syncMapRelief(h.map, true, 'key', baseIds);
    assert.equal(h.sources.get(RELIEF_SOURCE_ID), dem);
    assert.equal(h.layers[2].type, 'hillshade');
    assert.deepEqual(h.layers.slice(3), h.initial.slice(2));
  }
  assert.equal(h.calls.length, 1);
});

for (const [file, mapRefName, plan, satellite] of [
  ['../components/PreparationMap.tsx', 'mapRef', 'plan-base', 'satellite-base'],
  ['../components/flight/FlightMap.tsx', 'map', 'osm-tiles', 'maptiler-satellite-layer'],
]) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const middle = source.indexOf('const sync = () => syncMapRelief(');
  const start = source.lastIndexOf('useEffect(() => {', middle) + 'useEffect(() => {'.length;
  const end = source.indexOf('}, [showRelief,', middle);
  const effect = new Function(mapRefName, 'showRelief', 'mapTilerKey', 'syncMapRelief', 'PLAN_LAYER_ID', 'SATELLITE_LAYER_ID', source.slice(start, end));
  test(`${file}: pending ON cancelled before load produces zero DEM requests when OFF`, () => {
    const h = setup(false, [plan, satellite]);
    const cleanup = effect({ current: h.map }, true, 'key', syncMapRelief, plan, satellite);
    cleanup();
    effect({ current: h.map }, false, 'key', syncMapRelief, plan, satellite);
    h.load();
    assert.equal(h.calls.length, 0);
  });
  test(`${file}: ON is applied after load and removed on OFF`, () => {
    const h = setup(false, [plan, satellite]);
    const cleanup = effect({ current: h.map }, true, 'key', syncMapRelief, plan, satellite);
    h.load();
    assert.equal(h.sources.size, 1);
    cleanup();
    effect({ current: h.map }, false, 'key', syncMapRelief, plan, satellite);
    assert.equal(h.sources.size, 0);
  });
}

test('Flight relief errors do not trigger the existing satellite fallback', () => {
  const source = readFileSync(new URL('../components/flight/FlightMap.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('map.current.on("error", (event) => {') + 'map.current.on("error", (event) => {'.length;
  const end = source.indexOf('\n    });', start);
  let called = false;
  const handler = new Function('event', 'RELIEF_SOURCE_ID', 'baseMapRef', source.slice(start, end));
  handler({ sourceId: RELIEF_SOURCE_ID }, RELIEF_SOURCE_ID, { get current() { called = true; throw new Error('satellite handling'); } });
  assert.equal(called, false);
});

test('Flight toggle changes only relief and remains available after satellite failure', () => {
  const raw = readFileSync(new URL('../components/flight/MapOptionsPopover.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const jsx = (type, props) => ({ type, props });
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name === 'react') return { useEffect() {}, useRef: () => ({ current: null }) };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
    if (name.endsWith('flightMapPresentation')) return { FLIGHT_BOTTOM_LAYOUT: {}, MAP_OPTIONS_POPOVER_LAYOUT: {}, toggleMapLayerSetting: (s, k) => ({ ...s, [k]: !s[k] }) };
    return { Chip: 'Chip', FloatingPanel: 'Panel', SegmentedControl: 'Segmented' };
  }, exports);
  const settings = { relief: false, airspaces: true, powerLines: true };
  let next;
  const tree = exports.default({ isOpen: true, settings, satelliteAvailable: false, reliefAvailable: true, onSettingsChange: s => { next = s; } });
  function find(node) {
    if (!node || typeof node !== 'object') return;
    const children = [node.props?.children].flat(Infinity);
    if (node.type === 'Chip' && children.some(c => c?.props?.children === 'Relief')) return node;
    for (const child of children) { const result = find(child); if (result) return result; }
  }
  const toggle = find(tree);
  assert.ok(toggle);
  assert.equal(toggle.props['aria-checked'], false);
  assert.equal(toggle.props.disabled, false);
  toggle.props.onClick();
  assert.deepEqual(next, { ...settings, relief: true });
});
