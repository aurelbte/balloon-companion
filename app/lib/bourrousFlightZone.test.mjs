import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function setup() {
  const sources = new Map(), layers = [], markers = [], events = new Map();
  const map = { getSource: id => sources.get(id), addSource: (id, source) => sources.set(id, source), addLayer: layer => layers.push(layer), once: (name, handler) => events.set(name, handler) };
  class Marker {
    constructor(options) { this.options = options; markers.push(this); }
    setLngLat(position) { this.position = position; return this; }
    addTo(target) { this.map = target; return this; }
    remove() { this.removed = true; }
  }
  const source = readFileSync(new URL('./bourrousFlightZone.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  new Function('require', 'exports', 'document', code)(() => ({ Marker }), exports, { createElement: () => ({ style: {} }) });
  return { ...exports, sources, layers, markers, events, map };
}
test('Bourrous polygon and outline are visible independently, without remote glyphs or click handlers', () => {
  const h = setup();
  h.addBourrousFlightZone(h.map);
  assert.equal(h.sources.get('bourrous-flight-zone').data, '/geo/zone-vol-bourrous.geojson');
  assert.deepEqual(h.layers.map(l => l.type), ['fill', 'line']);
  assert.ok(h.layers.every(l => l.layout.visibility === 'visible' && l.minzoom === undefined));
  assert.equal(h.layers[0].paint['fill-color'], '#a855f7');
  assert.ok(h.layers[0].paint['fill-opacity'] > 0 && h.layers[0].paint['fill-opacity'] < 1);
  assert.equal(h.layers[1].paint['line-width'], 4);
  assert.equal(h.markers.length, 0);
  assert.ok(!h.events.has('click'));
  h.addBourrousFlightZone(h.map);
  assert.equal(h.layers.length, 2);
  assert.equal(h.markers.length, 0);
});
test('only Preparation and Flight install the shared overlay on map load', () => {
  for (const file of ['../components/PreparationMap.tsx', '../components/flight/FlightMap.tsx']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.equal((source.match(/addBourrousFlightZone\(/g) ?? []).length, 1);
    assert.ok(source.indexOf('addBourrousFlightZone(') > source.indexOf('.on("load"'));
  }
  const journal = readFileSync(new URL('../components/journal/JournalFlightMap.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(journal, /addBourrousFlightZone/);
});
